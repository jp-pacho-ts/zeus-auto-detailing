import "server-only";
import { Prisma, type BookingOperation } from "@prisma/client";
import { z } from "zod";
import {
  CancelManagedBookingSchema,
  RescheduleManagedBookingSchema,
  RecoverBookingOperationSchema,
  ExchangeManagementAccessSchema,
  ManagedDayAvailabilitySchema,
} from "@/lib/validation";
import type {
  ManagedDayBookingView,
  ManagementMutationData,
  RecoveredBookingOperation,
  ManagedDayAvailabilityData,
} from "@/types/contracts";
import type {
  LifecycleError,
  LifecycleResult,
} from "@/types/catalog-contracts";
import { prisma } from "./db";
import { BookingFailure, bookingError, unavailable } from "./bookings-errors";
import { createLoginLimiter } from "./auth/rate-limit";
import { enterBooking, withBookingDb } from "./bookings-admission";
import { trustedClientKey } from "./auth/client-identity";
import {
  bookingDbNow,
  lockBookingShop,
  lockBookingDates,
} from "./bookings-locks";
import {
  parseBookingConfiguration,
  verifyManagementToken,
  signManagementToken,
  type ManagementClaims,
  type BookingConfiguration,
} from "./bookings-credentials";
import {
  checkBookingOrigin,
  publicDayBooking,
  issueBookingCredentials,
  type CreateDayBookingOptions,
} from "./bookings-create";
import {
  addDays,
  dayWindow,
  readDayStates,
  validDay,
} from "./availability-days";
import { dateCarrier, manilaToday } from "./availability-core";
import { sha256 } from "./bookings-hash";
import {
  customerCutoff,
  beforeCustomerCutoff,
  recoveryAuthority,
} from "./bookings-management-policy";
import { admitManagementReceipt } from "./bookings-management-ledger";

export interface ManagementCommit<T> {
  result: LifecycleResult<T>;
  session?: { token: string; expiresAt: string };
}
export type ManagementOptions = CreateDayBookingOptions;
type Tx = Prisma.TransactionClient;
const include = { lineItems: true, occupancy: true } as const;
type Booking = Prisma.BookingGetPayload<{ include: typeof include }>;
const clientLimit = (minute: number, day: number | null = null) =>
  createLoginLimiter({
    perKeyPerMinute: minute,
    perKeyPerDay: day,
    maxConcurrentPerKey: 2,
  });
const exchangeLimit = clientLimit(10),
  recoveryLimit = clientLimit(10, 100),
  readClientLimit = clientLimit(60),
  mutationClientLimit = clientLimit(15),
  readBookingLimit = clientLimit(30),
  mutationBookingLimit = clientLimit(5);
function ok<T>(data: T): ManagementCommit<T> {
  return { result: { ok: true, data } };
}
function fail<T>(error: LifecycleError): ManagementCommit<T> {
  return { result: { ok: false, error } };
}
const auth = () =>
  new BookingFailure(
    bookingError(
      "UNAUTHENTICATED",
      "Open your saved management code or contact the shop.",
      { commitState: "NOT_APPLICABLE" },
    ),
  );
const invalid = () =>
  new BookingFailure(
    bookingError("VALIDATION_ERROR", "Check the management request details.", {
      commitState: "NOT_APPLICABLE",
    }),
  );
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw invalid();
  return r.data;
}
export function managementCookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Host-booking-management"
    : "booking-management";
}
function cookieToken(headers: Headers): string {
  const values = (headers.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith(managementCookieName() + "="));
  if (values.length !== 1) throw auth();
  return values[0].slice(managementCookieName().length + 1);
}
function claims(c: BookingConfiguration, h: Headers): ManagementClaims {
  const verified = verifyManagementToken(
    cookieToken(h),
    "BOOKING_MANAGEMENT_SESSION",
    c,
    new Date(),
  );
  if (!verified) throw auth();
  return verified;
}
async function load(tx: Tx, id: string): Promise<Booking> {
  const b = await tx.booking.findUnique({ where: { id }, include });
  if (!b) throw auth();
  return b;
}
// Stable authorization helper for P1-18: call only inside a customer DB permit/transaction.
export async function requireManagementBooking(
  tx: Tx,
  token: ManagementClaims,
  c: BookingConfiguration,
  now: Date,
  bookingId?: string,
): Promise<Booking> {
  if (
    !token.kid ||
    !c.session.keys.has(token.kid) ||
    !c.grant.keys.has(token.grantKid)
  )
    throw auth();
  if (bookingId && token.bookingId !== bookingId) throw auth();
  const b = await load(tx, token.bookingId);
  const session = await tx.bookingManagementSession.findFirst({
    where: {
      bookingId: b.id,
      credentialVersion: token.credentialVersion,
      kid: token.kid,
      grantKid: token.grantKid,
      issuedAt: new Date(token.issuedAt),
      expiresAt: new Date(token.expiresAt),
      revokedAt: null,
    },
    include: { grant: true },
  });
  if (
    b.managementTokenVersion !== token.credentialVersion ||
    !session ||
    session.expiresAt <= now ||
    session.issuedAt > now ||
    session.grant.revokedAt ||
    session.grant.expiresAt <= now ||
    session.grant.issuedAt > now ||
    !c.grant.keys.has(session.grantKid)
  )
    throw auth();
  return b;
}
function eligible(b: Booking, now: Date) {
  return (
    b.snapshotVersion === "QUEUE_V3" &&
    (b.status === "PENDING" || b.status === "CONFIRMED") &&
    !b.occupancy &&
    b.lineItems.every(
      (l) => l.removedAt !== null || l.workStatus === "WAITING",
    ) &&
    beforeCustomerCutoff(b.bookingDate.toISOString().slice(0, 10), now)
  );
}
function view(b: Booking, now: Date): ManagedDayBookingView {
  if (b.snapshotVersion !== "QUEUE_V3")
    throw new BookingFailure(
      bookingError(
        "BOOKING_NOT_MANAGEABLE",
        "Please contact the shop about this booking.",
        { commitState: "NOT_APPLICABLE" },
      ),
    );
  return {
    ...publicDayBooking(b),
    selfServiceAllowed: eligible(b, now),
    selfServiceCutoff: customerCutoff(
      b.bookingDate.toISOString().slice(0, 10),
    ).toISOString(),
  };
}
async function run<T>(
  options: ManagementOptions,
  scope: "exchange" | "read" | "mutation" | "recovery",
  work: (
    c: BookingConfiguration,
    h: Headers,
    client: string,
    token: ManagementClaims | null,
  ) => Promise<ManagementCommit<T>>,
): Promise<ManagementCommit<T>> {
  let leave: (() => void) | undefined, leaveBooking: (() => void) | undefined;
  try {
    const c = options.config ?? parseBookingConfiguration(),
      h = options.headers ?? new Headers();
    // Direct service callers share the HTTP adapter's origin check on unsafe operations.
    if (scope !== "read" && !checkBookingOrigin(h, c))
      throw new BookingFailure(
        bookingError(
          "FORBIDDEN",
          "This management request could not be accepted.",
          { commitState: scope === "exchange" ? "NOT_APPLICABLE" : "UNKNOWN" },
        ),
      );
    const client = sha256(trustedClientKey(h, c.identity));
    leave = enterBooking(
      scope === "exchange"
        ? exchangeLimit
        : scope === "recovery"
          ? recoveryLimit
          : scope === "read"
            ? readClientLimit
            : mutationClientLimit,
      client,
    );
    const token =
      scope === "read" || scope === "mutation" ? claims(c, h) : null;
    if (token)
      leaveBooking = enterBooking(
        scope === "read" ? readBookingLimit : mutationBookingLimit,
        token.bookingId,
      );
    return await work(c, h, client, token);
  } catch (cause) {
    const e = cause instanceof BookingFailure ? cause.error : unavailable();
    return fail({
      ...e,
      commitState:
        scope === "read" || scope === "exchange"
          ? "NOT_APPLICABLE"
          : e.commitState,
    });
  } finally {
    leaveBooking?.();
    leave?.();
  }
}

export async function exchangeManagementAccess(
  input: unknown,
  options: ManagementOptions = {},
): Promise<
  ManagementCommit<{ booking: ManagedDayBookingView; sessionExpiresAt: string }>
> {
  return run(options, "exchange", async (c) => {
    const v = parse(ExchangeManagementAccessSchema, input),
      token = verifyManagementToken(
        v.accessToken,
        "BOOKING_MANAGEMENT",
        c,
        new Date(),
      );
    if (!token) throw auth();
    return withBookingDb(
      options.db ?? prisma,
      "MANAGEMENT_EXCHANGE",
      async (tx) => {
        const now = await bookingDbNow(tx),
          b = await load(tx, token.bookingId);
        const grant = await tx.bookingManagementGrant.findFirst({
          where: {
            bookingId: b.id,
            credentialVersion: token.credentialVersion,
            kid: token.grantKid,
            issuedAt: new Date(token.issuedAt),
            expiresAt: new Date(token.expiresAt),
            revokedAt: null,
          },
        });
        if (
          b.managementTokenVersion !== token.credentialVersion ||
          !grant ||
          grant.expiresAt <= now ||
          grant.issuedAt > now
        )
          throw auth();
        let session = await tx.bookingManagementSession.findFirst({
          where: {
            grantId: grant.id,
            kid: c.session.activeKid,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: { issuedAt: "desc" },
        });
        if (!session)
          session = await tx.bookingManagementSession.create({
            data: {
              bookingId: b.id,
              grantId: grant.id,
              credentialVersion: b.managementTokenVersion,
              kid: c.session.activeKid,
              grantKid: grant.kid,
              issuedAt: now,
              expiresAt: new Date(
                Math.min(now.getTime() + 86400000, grant.expiresAt.getTime()),
              ),
            },
          });
        const expiresAt = session.expiresAt.toISOString();
        return {
          ...ok({ booking: view(b, now), sessionExpiresAt: expiresAt }),
          session: {
            token: signManagementToken(
              "BOOKING_MANAGEMENT_SESSION",
              {
                bookingId: b.id,
                credentialVersion: b.managementTokenVersion,
                issuedAt: session.issuedAt.toISOString(),
                expiresAt,
                grantKid: grant.kid,
              },
              c.session,
            ),
            expiresAt,
          },
        };
      },
      options.signal,
    );
  });
}
export async function readManagedBooking(
  options: ManagementOptions = {},
): Promise<ManagementCommit<ManagedDayBookingView>> {
  return run(options, "read", async (c, _h, _client, token) =>
    withBookingDb(
      options.db ?? prisma,
      "MANAGEMENT_READ",
      async (tx) => {
        const now = await bookingDbNow(tx);
        return ok(
          view(await requireManagementBooking(tx, token!, c, now), now),
        );
      },
      options.signal,
    ),
  );
}
// Forget only clears the client cookie (ADR-002); share exchange admission, no DB phase.
export async function forgetManagementSession(
  options: ManagementOptions = {},
): Promise<ManagementCommit<{ forgotten: true }>> {
  return run(options, "exchange", async () => ok({ forgotten: true as const }));
}

function receiptError(op: BookingOperation): LifecycleError {
  return bookingError(
    op.rejectionCode as LifecycleError["code"],
    (op.rejectionData as unknown as LifecycleError)?.message ??
      "This request could not be completed.",
    { commitState: "NOT_COMMITTED" },
  );
}
function match(
  op: BookingOperation,
  kind: string,
  bookingId: string | null,
  hash?: string,
) {
  if (
    op.kind !== kind ||
    (kind !== "CREATE" && op.bookingId !== bookingId) ||
    (hash && op.requestHash !== null && op.requestHash !== hash)
  )
    throw new BookingFailure(
      bookingError(
        "IDEMPOTENCY_CONFLICT",
        "This retry key belongs to another request.",
      ),
    );
}
export async function recoverBookingOperation(
  input: unknown,
  options: ManagementOptions = {},
): Promise<ManagementCommit<RecoveredBookingOperation>> {
  return run(options, "recovery", async (c, h, client) => {
    const v = parse(RecoverBookingOperationSchema, input),
      keyHash = sha256(v.idempotencyKey),
      token = v.operationKind === "CREATE" ? null : claims(c, h);
    const leave = token
      ? enterBooking(readBookingLimit, token.bookingId)
      : undefined;
    try {
      const phase = async (
        tx: Tx,
        write: boolean,
      ): Promise<ManagementCommit<RecoveredBookingOperation> | null> => {
        let now = await bookingDbNow(tx);
        if (token)
          await requireManagementBooking(tx, token, c, now, v.bookingId!);
        // F-03: the authority window and DB clock come from the very same ledger statement.
        const rows = await tx.$queryRaw<
          (BookingOperation & { dbNow: Date })[]
        >`SELECT o.*,statement_timestamp() AS "dbNow" FROM booking_operations o WHERE o."keyHash"=${keyHash}`;
        const op = rows[0];
        if (op) now = op.dbNow;
        if (op) {
          match(op, v.operationKind, v.bookingId);
          if (op.outcome !== "COMMITTED")
            return ok({
              state: "NOT_COMMITTED",
              operationKind: v.operationKind,
              reason: op.outcome as "REJECTED" | "CLOSED_WITHOUT_COMMIT",
              rejectionCode: op.rejectionCode as LifecycleError["code"] | null,
            });
          const b = await load(tx, op.bookingId!);
          if (v.operationKind !== "CREATE")
            return ok({
              state: "COMMITTED",
              operationKind: v.operationKind,
              booking: view(b, now),
              managementAccess: null,
            });
          const denied = recoveryAuthority(op, b.managementTokenVersion, now);
          if (denied)
            throw new BookingFailure(
              bookingError(
                denied,
                "We can no longer confirm this submission online. Use your saved code or contact the shop.",
              ),
            );
          const issued = await issueBookingCredentials(tx, b, now, c, write);
          if (!issued) return null;
          return {
            ...ok<RecoveredBookingOperation>({
              state: "COMMITTED",
              operationKind: "CREATE",
              booking: view(b, now),
              managementAccess: issued.managementAccess,
            }),
            ...(issued.session ? { session: issued.session } : {}),
          };
        }
        if (
          await tx.booking.findFirst({
            where: {
              idempotencyKey: { equals: v.idempotencyKey, mode: "insensitive" },
            },
          })
        )
          throw new BookingFailure(
            bookingError(
              "RECOVERY_UNAVAILABLE",
              "Use the original submission or contact the shop.",
            ),
          );
        await admitManagementReceipt(
          tx,
          v.operationKind,
          v.bookingId,
          client,
          now,
          true,
        );
        if (!write) return null;
        await tx.bookingOperation.create({
          data: {
            keyHash,
            kind: v.operationKind,
            bookingId: v.bookingId,
            credentialVersion: token?.credentialVersion ?? null,
            clientHash: client,
            outcome: "CLOSED_WITHOUT_COMMIT",
            recoveryExpiresAt: new Date(now.getTime() + 86400000),
          },
        });
        return ok({
          state: "NOT_COMMITTED",
          operationKind: v.operationKind,
          reason: "CLOSED_WITHOUT_COMMIT",
          rejectionCode: null,
        });
      };
      const answer = await withBookingDb(
        options.db ?? prisma,
        "RECOVERY_LOOKUP",
        (tx) => phase(tx, false),
        options.signal,
      );
      if (answer) return answer;
      return withBookingDb(
        options.db ?? prisma,
        "RECOVERY_FENCE",
        async (tx) => {
          await lockBookingShop(tx);
          return (await phase(tx, true))!;
        },
        options.signal,
      );
    } finally {
      leave?.();
    }
  });
}

async function mutation(
  kind: "CANCEL" | "RESCHEDULE",
  input: unknown,
  options: ManagementOptions,
): Promise<ManagementCommit<ManagementMutationData>> {
  return run(options, "mutation", async (c, _h, client, token) => {
    const v = parse(
        kind === "CANCEL"
          ? CancelManagedBookingSchema
          : RescheduleManagedBookingSchema,
        input,
      ),
      target = "bookingDate" in v ? (v.bookingDate as string) : null;
    if (token!.bookingId !== v.bookingId) throw auth();
    const hash = sha256(
        JSON.stringify([kind, v.bookingId, v.expectedRevision, target]),
      ),
      keyHash = sha256(v.idempotencyKey);
    return withBookingDb(
      options.db ?? prisma,
      "MANAGEMENT_MUTATION",
      async (tx) => {
        await lockBookingShop(tx);
        let now = await bookingDbNow(tx),
          b = await requireManagementBooking(tx, token!, c, now, v.bookingId);
        await lockBookingDates(tx, [
          b.bookingDate.toISOString().slice(0, 10),
          ...(target ? [target] : []),
        ]);
        now = await bookingDbNow(tx);
        b = await requireManagementBooking(tx, token!, c, now, v.bookingId);
        const op = await tx.bookingOperation.findUnique({ where: { keyHash } });
        if (op) {
          match(op, kind, b.id, hash);
          if (op.outcome === "REJECTED")
            return fail<ManagementMutationData>({
              ...receiptError(op),
              ...(op.rejectionCode === "VERSION_CONFLICT"
                ? { currentBooking: view(b, now) }
                : {}),
            });
          if (op.outcome === "CLOSED_WITHOUT_COMMIT")
            return fail<ManagementMutationData>(
              bookingError(
                "OPERATION_CLOSED",
                "This request is closed. Use a new request after checking the booking.",
                { commitState: "NOT_COMMITTED" },
              ),
            );
          return ok({
            operationKind: kind,
            booking: view(b, now),
            replayed: true,
            noChange: op.noChange ?? false,
          });
        }
        await admitManagementReceipt(tx, kind, b.id, client, now, false);
        const reject = async (
          code: LifecycleError["code"],
          message: string,
        ) => {
          const error = bookingError(code, message, {
            commitState: "NOT_COMMITTED",
          });
          await tx.bookingOperation.create({
            data: {
              keyHash,
              kind,
              bookingId: b.id,
              credentialVersion: b.managementTokenVersion,
              clientHash: client,
              requestHash: hash,
              outcome: "REJECTED",
              rejectionCode: code,
              rejectionData: error as unknown as Prisma.InputJsonValue,
              recoveryExpiresAt: new Date(now.getTime() + 86400000),
            },
          });
          return fail<ManagementMutationData>({
            ...error,
            ...(code === "VERSION_CONFLICT"
              ? { currentBooking: view(b, now) }
              : {}),
          });
        };
        const terminalNoOp = kind === "CANCEL" && b.status === "CANCELLED";
        if (!terminalNoOp) {
          if (v.expectedRevision !== b.revision)
            return reject(
              "VERSION_CONFLICT",
              "This booking changed. Refresh it before trying again.",
            );
          if (
            b.snapshotVersion !== "QUEUE_V3" ||
            !["PENDING", "CONFIRMED"].includes(b.status) ||
            b.occupancy ||
            b.lineItems.some((l) => !l.removedAt && l.workStatus !== "WAITING")
          )
            return reject(
              "BOOKING_NOT_MANAGEABLE",
              "Please contact the shop to change this booking.",
            );
          if (
            !beforeCustomerCutoff(
              b.bookingDate.toISOString().slice(0, 10),
              now,
            ) ||
            (target && !beforeCustomerCutoff(target, now))
          )
            return reject(
              "CUTOFF_PASSED",
              "Please contact the shop to change this booking.",
            );
          if (target && !validDay(target, now))
            return reject(
              "VALIDATION_ERROR",
              "Choose a day within the next 90 days.",
            );
          if (target) {
            const days = await readDayStates(
              tx,
              b.queueCode!,
              target,
              target,
              b.id,
            );
            if (days[0]?.state !== "AVAILABLE")
              return reject(
                days[0]?.state === "FULLY_BOOKED"
                  ? "FULLY_BOOKED"
                  : "DAY_CLOSED",
                "That day cannot accept this booking. Choose another day.",
              );
          }
        }
        const noChange =
          terminalNoOp ||
          (kind === "RESCHEDULE" &&
            target === b.bookingDate.toISOString().slice(0, 10));
        if (!noChange) {
          const data: Prisma.BookingUpdateInput = {
            revision: b.revision + 1,
            updatedAt: now,
          };
          if (kind === "CANCEL")
            Object.assign(data, {
              status: "CANCELLED",
              cancellationKind: "CUSTOMER",
              terminalAt: now,
            });
          else {
            const max = await tx.booking.aggregate({
              where: {
                queueCode: b.queueCode,
                bookingDate: dateCarrier(target!),
              },
              _max: { queuePosition: true },
            });
            Object.assign(data, {
              bookingDate: dateCarrier(target!),
              ...dayWindow(target!),
              queuePosition: (max._max.queuePosition ?? 0) + 1,
            });
          }
          await tx.booking.update({ where: { id: b.id }, data });
          // Occupancy is already a shop-only refusal above; remove obsolete dated reservations.
          await tx.bookingBayAssignment.deleteMany({
            where: { bookingId: b.id },
          });
        }
        const updated = await load(tx, b.id);
        await tx.bookingOperation.create({
          data: {
            keyHash,
            kind,
            bookingId: b.id,
            credentialVersion: b.managementTokenVersion,
            clientHash: client,
            requestHash: hash,
            outcome: "COMMITTED",
            resultingRevision: updated.revision,
            noChange,
            committedAt: now,
            recoveryExpiresAt: new Date(now.getTime() + 86400000),
          },
        });
        return ok({
          operationKind: kind,
          booking: view(updated, now),
          replayed: false,
          noChange,
        });
      },
      options.signal,
    );
  });
}
export const cancelManagedBooking = (
  input: unknown,
  options: ManagementOptions = {},
) => mutation("CANCEL", input, options);
export const rescheduleManagedBooking = (
  input: unknown,
  options: ManagementOptions = {},
) => mutation("RESCHEDULE", input, options);
export async function getManagedDayAvailability(
  input: unknown,
  options: ManagementOptions = {},
): Promise<ManagementCommit<ManagedDayAvailabilityData>> {
  return run(options, "read", async (c, h, _client, token) => {
    if (!checkBookingOrigin(h, c))
      throw new BookingFailure(
        bookingError(
          "FORBIDDEN",
          "This management request could not be accepted.",
          { commitState: "NOT_APPLICABLE" },
        ),
      );
    const v = parse(ManagedDayAvailabilitySchema, input);
    return withBookingDb(
      options.db ?? prisma,
      "MANAGEMENT_READ",
      async (tx) => {
        const now = await bookingDbNow(tx),
          b = await requireManagementBooking(tx, token!, c, now, v.bookingId);
        if (!eligible(b, now))
          throw new BookingFailure(
            bookingError(
              "BOOKING_NOT_MANAGEABLE",
              "Please contact the shop to change this booking.",
              { commitState: "NOT_APPLICABLE" },
            ),
          );
        if (!validDay(v.fromDate, now)) throw invalid();
        const through = addDays(manilaToday(now), 90),
          days = (
            await readDayStates(tx, b.queueCode!, v.fromDate, through, b.id)
          ).map((d) => ({
            ...d,
            state: beforeCustomerCutoff(d.date, now)
              ? d.state
              : ("CLOSED" as const),
          }));
        return ok<ManagedDayAvailabilityData>({
          bookingId: b.id,
          bookingRevision: b.revision,
          timezone: "Asia/Manila",
          days: days.slice(0, v.days),
          nextAvailableDay:
            days.find((d) => d.state === "AVAILABLE")?.date ?? null,
          searchedThrough: through,
          quote: null,
        });
      },
      options.signal,
    );
  });
}
