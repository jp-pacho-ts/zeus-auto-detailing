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
  ManagedDepositView,
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
  MANAGEMENT_ADMISSION_POLICIES,
} from "./bookings-management-policy";
import { admitManagementReceipt } from "./bookings-management-ledger";
import { timingSafeEqual } from "node:crypto";
import { lastNameFallback, maskEmail, maskPhone, normalizeLastName, normalizeReference, progressFor } from "@/lib/booking-lookup";
import { TurnstileTokenSchema } from "@/lib/validation";
import { verifyTurnstile, turnstileRemoteIp } from "./bookings-turnstile";
import { LOOKUP_CEILING, LOOKUP_POLICIES } from "./bookings-management-policy";
import type { ManagedLookupData } from "@/types/contracts";

export interface ManagementCommit<T> {
  result: LifecycleResult<T>;
  session?: { token: string; expiresAt: string };
}
// P1-32 test seams for the public lookup; never set from a request.
export interface LookupSeams {
  ceiling?: { failedPerHour: number; delayMs: number };
  sleep?: (ms: number) => Promise<void>;
}
export type ManagementOptions = CreateDayBookingOptions & { lookup?: LookupSeams };
type Tx = Prisma.TransactionClient;
const include = {
  lineItems: true,
  occupancy: true,
  _count: { select: { depositProofs: true } },
} as const;
export type ManagedBooking = Prisma.BookingGetPayload<{ include: typeof include }>;
type Booking = ManagedBooking;
const exchangeLimit = createLoginLimiter(
    MANAGEMENT_ADMISSION_POLICIES.exchange,
  ),
  recoveryLimit = createLoginLimiter(MANAGEMENT_ADMISSION_POLICIES.recovery),
  readClientLimit = createLoginLimiter(
    MANAGEMENT_ADMISSION_POLICIES.readClient,
  ),
  mutationClientLimit = createLoginLimiter(
    MANAGEMENT_ADMISSION_POLICIES.mutationClient,
  ),
  readBookingLimit = createLoginLimiter(
    MANAGEMENT_ADMISSION_POLICIES.readBooking,
  ),
  mutationBookingLimit = createLoginLimiter(
    MANAGEMENT_ADMISSION_POLICIES.mutationBooking,
  );
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
// Stateless cookie MAC/purpose/expiry check (no DB); P1-18 runs it before reading an upload body.
export function managementSessionClaims(c: BookingConfiguration, h: Headers): ManagementClaims {
  return claims(c, h);
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
// P1-18: proof count and status only; a rejection shows fixed wording, never the staff reason.
export const MAX_PROOFS_PER_BOOKING = 3;
function depositView(b: Booking): ManagedDepositView {
  return {
    status: b.depositStatus,
    proofsSent: b._count.depositProofs,
    proofsAllowed: MAX_PROOFS_PER_BOOKING,
    message: b.depositStatus === "REJECTED" ? "Please contact the shop." : null,
  };
}
export function managedBookingView(b: Booking, now: Date): ManagedDayBookingView {
  return view(b, now);
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
    deposit: depositView(b),
  };
}
async function run<T>(
  options: ManagementOptions,
  scope: "exchange" | "read" | "mutation" | "recovery" | "lookup",
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
    leave =
      scope === "lookup"
        ? enterLookup(lookupClientLimit, client)
        : enterBooking(
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
        scope === "read" || scope === "exchange" || scope === "lookup"
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
              now,
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
            await readDayStates(tx, b.queueCode!, v.fromDate, through, now, b.id)
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

// ---------------------------------------------------------------------------------------------
// P1-32: the public "reference code + last name" lookup (airline style). Every failure is one answer.
// ---------------------------------------------------------------------------------------------
const GENERIC_NOT_FOUND = "We couldn't find that booking. Check the reference code and last name.";
const TOO_MANY = "Too many tries. Use the link in your confirmation email, or call the shop.";
const notFound = () => new BookingFailure(bookingError("NOT_FOUND", GENERIC_NOT_FOUND, { commitState: "NOT_APPLICABLE" }));
const lookupClientLimit = createLoginLimiter(LOOKUP_POLICIES.client);
const lookupReferenceLimit = createLoginLimiter(LOOKUP_POLICIES.reference);
function enterLookup(limiter: ReturnType<typeof createLoginLimiter>, key: string): () => void {
  const ticket = limiter.enter(key);
  if (!ticket.ok)
    throw new BookingFailure(bookingError("RATE_LIMITED", TOO_MANY, { retryable: true, retryAfterSeconds: ticket.retryAfterSeconds, commitState: "NOT_APPLICABLE" }));
  return ticket.leave;
}
// One line per lookup: the outcome class only (no reference, name, phone, email, IP or token).
type LookupOutcome = "found" | "legacy_match" | "not_found" | "rate_limited" | "turnstile_failed";
const logLookup = (outcome: LookupOutcome) => (outcome === "found" || outcome === "legacy_match" ? console.info : console.warn)(JSON.stringify({ event: "booking.lookup", outcome }));
// Failed lookups across the whole shop in the current hour. Past the ceiling every answer is slowed and
// one alert line is logged per hour (the count only, no detail).
interface Ceiling { start: number; failed: number; alerted: boolean }
const defaultCeiling: Ceiling = { start: 0, failed: 0, alerted: false };
const seamCeilings = new WeakMap<object, Ceiling>();
const ceilingFor = (seams?: LookupSeams): [Ceiling, { failedPerHour: number; delayMs: number }] => {
  if (!seams?.ceiling) return [defaultCeiling, LOOKUP_CEILING];
  let state = seamCeilings.get(seams);
  if (!state) seamCeilings.set(seams, (state = { start: 0, failed: 0, alerted: false }));
  return [state, seams.ceiling];
};
const roll = (state: Ceiling, now: number) => {
  if (now - state.start >= 3600000) {
    state.start = now;
    state.failed = 0;
    state.alerted = false;
  }
};

const digest = (s: string) => Buffer.from(sha256(s), "hex");
// Same work for a found and an unknown booking: the digests are always computed and compared.
const DUMMY = digest("no-such-booking");
function nameMatches(supplied: string, b: Booking | null): boolean {
  const want = normalizeLastName(supplied);
  const have = b ? normalizeLastName(b.customerLastName ?? lastNameFallback(b.customerName) ?? "") : "";
  const same = timingSafeEqual(digest(want), b ? digest(have) : DUMMY);
  return b !== null && same && want.length > 0 && have.length > 0;
}

export async function lookupManagedBooking(
  input: unknown,
  options: ManagementOptions = {},
): Promise<ManagementCommit<ManagedLookupData>> {
  return run(options, "lookup", async (c, _h, client) => {
    const [ceiling, limits] = ceilingFor(options.lookup);
    roll(ceiling, Date.now());
    if (ceiling.failed >= limits.failedPerHour) {
      if (!ceiling.alerted) {
        ceiling.alerted = true;
        console.warn(JSON.stringify({ event: "booking.lookup_alert", failedLastHour: ceiling.failed }));
      }
      await (options.lookup?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(limits.delayMs);
    }
    const fail = (outcome: LookupOutcome, error: BookingFailure): never => {
      if (outcome === "not_found") ceiling.failed++;
      logLookup(outcome);
      throw error;
    };
    const body = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
    // The security check is mandatory on every attempt and runs before anything about the booking is touched.
    const token = TurnstileTokenSchema.safeParse(body.turnstileToken);
    const challengeFailed = () =>
      new BookingFailure(
        bookingError("CHALLENGE_FAILED", "Complete the security check again.", {
          retryable: true,
          commitState: "NOT_APPLICABLE",
          fieldErrors: { turnstileToken: ["Complete the security check again."] },
        }),
      );
    if (!token.success) return fail("turnstile_failed", challengeFailed());
    const verification = await verifyTurnstile(token.data, c.challenge, {
      endpoint: options.turnstileEndpoint,
      remoteip: turnstileRemoteIp(client),
      signal: options.signal,
      action: "booking_lookup",
    });
    if (verification === "UNAVAILABLE") throw unavailable();
    if (verification !== "VERIFIED") return fail("turnstile_failed", challengeFailed());
    // Per reference, from every IP, found or not: a stranger cannot grind through surnames on one code.
    const reference = normalizeReference(body.referenceCode);
    const supplied = typeof body.lastName === "string" && body.lastName.length <= 100 ? body.lastName : "";
    let leaveReference: (() => void) | undefined;
    try {
      leaveReference = enterLookup(lookupReferenceLimit, sha256("ref:" + (reference ?? "invalid:" + client)));
    } catch (e) {
      logLookup("rate_limited");
      throw e;
    }
    try {
      if (!reference) return fail("not_found", notFound());
      return await withBookingDb(
        options.db ?? prisma,
        "MANAGEMENT_EXCHANGE",
        async (tx) => {
          const at = await bookingDbNow(tx),
            b = await tx.booking.findUnique({ where: { referenceCode: reference }, include });
          const legacy = b !== null && b.customerLastName === null;
          if (!b || !nameMatches(supplied, b)) return fail("not_found", notFound());
          let shown: ManagedDayBookingView;
          try {
            shown = view(b, at);
          } catch {
            return fail("not_found", notFound());
          }
          const expiresAt = new Date(at.getTime() + 30 * 60000);
          const grant = await tx.bookingManagementGrant.create({
            data: { bookingId: b.id, credentialVersion: b.managementTokenVersion, kid: c.grant.activeKid, issuedAt: at, expiresAt },
          });
          const session = await tx.bookingManagementSession.create({
            data: { bookingId: b.id, grantId: grant.id, credentialVersion: b.managementTokenVersion, kid: c.session.activeKid, grantKid: grant.kid, issuedAt: at, expiresAt },
          });
          logLookup(legacy ? "legacy_match" : "found");
          return {
            ...ok<ManagedLookupData>({
              booking: shown,
              progress: progressFor(b.status),
              contact: { phone: maskPhone(b.customerPhone), email: maskEmail(b.customerEmail) },
              sessionExpiresAt: expiresAt.toISOString(),
            }),
            session: {
              token: signManagementToken(
                "BOOKING_MANAGEMENT_SESSION",
                { bookingId: b.id, credentialVersion: b.managementTokenVersion, issuedAt: session.issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), grantKid: grant.kid },
                c.session,
              ),
              expiresAt: expiresAt.toISOString(),
            },
          };
        },
        options.signal,
      );
    } finally {
      leaveReference?.();
    }
  });
}
