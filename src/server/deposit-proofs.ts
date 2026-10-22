import "server-only";
import { createHash } from "node:crypto";
import { UploadDepositProofSchema } from "@/lib/validation";
import type { DepositProofUploadData } from "@/types/contracts";
import type { LifecycleError } from "@/types/catalog-contracts";
import { prisma } from "./db";
import { BookingFailure, bookingError, lifecycleHttpStatus, unavailable } from "./bookings-errors";
import { createLoginLimiter } from "./auth/rate-limit";
import { createSemaphore } from "./auth/semaphore";
import { enterBooking, withBookingDb } from "./bookings-admission";
import { trustedClientKey } from "./auth/client-identity";
import { bookingDbNow, lockBookingShop } from "./bookings-locks";
import { parseBookingConfiguration } from "./bookings-credentials";
import { checkBookingOrigin } from "./bookings-create";
import { bookingJson } from "./bookings-http";
import { sha256 } from "./bookings-hash";
import {
  managedBookingView,
  managementSessionClaims,
  requireManagementBooking,
  MAX_PROOFS_PER_BOOKING,
  type ManagementCommit,
  type ManagementOptions,
} from "./bookings-management";
import { inspectDepositImage, MAX_PROOF_BYTES } from "./deposit-image";
import { drainDepositNotices } from "./notifications/bookings";

// P1-18 customer deposit proof upload, behind the P1-04 management session. Order: origin and
// CSRF header, per-client admission, the stateless session check, per-booking admission, then
// (and only then) the body is read, capped, decoded and inspected by content. The write binds
// the session to the booking in the DB, replays an exact retry, enforces 3 files per booking
// and moves the deposit status to PROOF_SENT with a new revision, all under the booking row lock.
// The shop email goes after commit. Customers can send files but never read them back.
export { MAX_PROOFS_PER_BOOKING };
export const DEPOSIT_UPLOAD_POLICIES = {
  client: { perKeyPerMinute: 10, perKeyPerDay: 30, maxConcurrentPerKey: 1 },
  booking: { perKeyPerMinute: 6, perKeyPerDay: 20, maxConcurrentPerKey: 1 },
} as const;
const MAX_IMAGE_BASE64 = Math.ceil(MAX_PROOF_BYTES / 3) * 4;
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BASE64 + 1024;
const clientLimit = createLoginLimiter(DEPOSIT_UPLOAD_POLICIES.client),
  bookingLimit = createLoginLimiter(DEPOSIT_UPLOAD_POLICIES.booking);
// At most two upload bodies are held in memory at once (about 7 MB of JSON and 5 MB decoded each).
const bodies = createSemaphore({ maxActive: 2, maxQueued: 4, maxWaitMs: 2000 });
// P1-12 F2: an admitted body must arrive within this time, or a slow or stalled client would keep
// one of the two body permits. Past it, or once the client has gone, reading stops and the permit
// is released before any database work. Tests pass their own timer.
export const UPLOAD_BODY_DEADLINE_MS = 15_000;
export type UploadTimer = (ms: number, onTimeout: () => void) => () => void;
const realTimer: UploadTimer = (ms, onTimeout) => {
  const t = setTimeout(onTimeout, ms);
  return () => clearTimeout(t);
};
export type UploadOptions = ManagementOptions & { bodyTimer?: UploadTimer };
const OPEN = ["PENDING", "CONFIRMED", "IN_PROGRESS"];

const failure = (code: LifecycleError["code"], message: string, commitState: LifecycleError["commitState"], fieldErrors: Record<string, string[]> = {}) =>
  new BookingFailure(bookingError(code, message, { commitState, fieldErrors }));
const tooLarge = () => failure("FILE_TOO_LARGE", "The image is too large. Send a screenshot of at most 5 MB.", "NOT_APPLICABLE", { image: ["Send an image of at most 5 MB."] });
const unsupported = () => failure("UNSUPPORTED_FILE", "Send a JPEG, PNG or WebP screenshot.", "NOT_APPLICABLE", { image: ["Send a JPEG, PNG or WebP image."] });
const invalid = () => failure("VALIDATION_ERROR", "Check the upload details.", "NOT_APPLICABLE");
const auth = () => failure("UNAUTHENTICATED", "Open your saved management code or contact the shop.", "NOT_APPLICABLE");
// Reading stopped (deadline or client gone): nothing was written, but as with any transport
// failure the client keeps its frozen request and retries the same key.
const bodyStopped = () => new BookingFailure(bookingError("RETRYABLE_ERROR", "The upload did not finish in time. Retry to send the same screenshot.", { retryable: true }));

// Reads the body under the deadline. Resolves only with the whole body; when the deadline passes
// or the request is aborted it rejects at once, even if `body` ignores the signal.
async function readBody(body: (signal: AbortSignal) => Promise<unknown>, options: UploadOptions): Promise<unknown> {
  const deadline = new AbortController();
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  const cancelTimer = (options.bodyTimer ?? realTimer)(UPLOAD_BODY_DEADLINE_MS, () => deadline.abort());
  let onStop: (() => void) | undefined;
  try {
    const reading = body(signal);
    reading.catch(() => {}); // settles later, after a stop; its outcome no longer matters
    return await new Promise((resolve, reject) => {
      onStop = () => {
        console.warn(JSON.stringify({ event: "booking.deposit_upload_body_stopped", reason: deadline.signal.aborted ? "DEADLINE" : "ABORTED" }));
        reject(bodyStopped());
      };
      if (signal.aborted) return onStop();
      signal.addEventListener("abort", onStop, { once: true });
      reading.then(resolve, reject);
    });
  } finally {
    if (onStop) signal.removeEventListener("abort", onStop);
    cancelTimer();
  }
}

export async function uploadDepositProof(
  body: (signal: AbortSignal) => Promise<unknown>,
  options: UploadOptions = {},
): Promise<ManagementCommit<DepositProofUploadData>> {
  let leaveClient: (() => void) | undefined, leaveBooking: (() => void) | undefined, releaseBody: (() => void) | undefined;
  let committed: DepositProofUploadData | null = null;
  try {
    const c = options.config ?? parseBookingConfiguration(), h = options.headers ?? new Headers();
    if (!checkBookingOrigin(h, c)) throw failure("FORBIDDEN", "This upload could not be accepted.", "NOT_APPLICABLE");
    const client = sha256(trustedClientKey(h, c.identity));
    leaveClient = enterBooking(clientLimit, client);
    const token = managementSessionClaims(c, h);
    leaveBooking = enterBooking(bookingLimit, token.bookingId);
    releaseBody = await bodies.acquire(options.signal);
    const input = await readBody(body, options);
    const image = input && typeof input === "object" ? (input as { image?: unknown }).image : undefined;
    if (typeof image === "string" && image.length > MAX_IMAGE_BASE64) throw tooLarge();
    const parsed = UploadDepositProofSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const v = parsed.data;
    if (v.bookingId !== token.bookingId) throw auth();
    const raw = Buffer.from(v.image, "base64");
    const inspected = inspectDepositImage(raw);
    if (!inspected.ok) throw inspected.reason === "SIZE" ? tooLarge() : unsupported();
    const keyHash = sha256(v.idempotencyKey), contentHash = createHash("sha256").update(raw).digest("hex");
    committed = await withBookingDb(options.db ?? prisma, "MANAGEMENT_MUTATION", async (tx) => {
      // Every booking writer takes the shop lock first (booking model rule), then the row.
      await lockBookingShop(tx);
      const now = await bookingDbNow(tx);
      await requireManagementBooking(tx, token, c, now, v.bookingId);
      await tx.$queryRaw`SELECT id FROM bookings WHERE id=${v.bookingId} FOR UPDATE`;
      const prior = await tx.bookingDepositProof.findUnique({ where: { keyHash }, select: { bookingId: true, contentHash: true } });
      if (prior) {
        if (prior.bookingId !== v.bookingId || prior.contentHash !== contentHash)
          throw failure("IDEMPOTENCY_CONFLICT", "This retry key belongs to another upload.", "NOT_COMMITTED");
        return { booking: managedBookingView(await requireManagementBooking(tx, token, c, now, v.bookingId), now), replayed: true };
      }
      const b = await requireManagementBooking(tx, token, c, now, v.bookingId);
      if (b.snapshotVersion !== "QUEUE_V3" || !OPEN.includes(b.status))
        throw failure("BOOKING_NOT_MANAGEABLE", "This booking can no longer take a deposit proof. Please contact the shop.", "NOT_COMMITTED");
      if (b._count.depositProofs >= MAX_PROOFS_PER_BOOKING)
        throw failure("DEPOSIT_PROOF_LIMIT", "This booking already has " + MAX_PROOFS_PER_BOOKING + " deposit proofs. Please contact the shop.", "NOT_COMMITTED");
      await tx.bookingDepositProof.create({
        data: { bookingId: b.id, keyHash, contentHash, clientHash: client, contentType: inspected.contentType, byteSize: inspected.data.length, width: inspected.width, height: inspected.height, data: inspected.data },
        select: { id: true },
      });
      await tx.booking.update({ where: { id: b.id }, data: { depositStatus: "PROOF_SENT", revision: b.revision + 1, updatedAt: now }, select: { id: true } });
      return { booking: managedBookingView(await requireManagementBooking(tx, token, c, now, v.bookingId), now), replayed: false };
    }, options.signal);
  } catch (cause) {
    if (cause instanceof BookingFailure) return { result: { ok: false, error: cause.error } };
    // Unexpected (pool admission, database, defect): retryable for the client, visible to the
    // operator. The error class only; never file contents, names or customer data.
    console.warn(JSON.stringify({ event: "booking.deposit_upload_failed", kind: cause instanceof Error ? cause.name : typeof cause }));
    return { result: { ok: false, error: unavailable() } };
  } finally {
    releaseBody?.();
    leaveBooking?.();
    leaveClient?.();
  }
  if (!committed.replayed) {
    // The transaction and its permit are finished before any mail-provider call.
    try {
      await drainDepositNotices({ db: options.db, notification: options.notification, bookingId: committed.booking.id });
    } catch {
      console.warn(JSON.stringify({ event: "booking.deposit_notice_deferred" }));
    }
  }
  return { result: { ok: true, data: committed } };
}

// Streams the JSON body and stops reading at the cap, so a large body is refused without
// being buffered. The upload is the only customer write allowed past the usual 16 KiB. When the
// signal fires (deadline or client gone) the stream is cancelled without waiting on the client.
async function readUploadJson(request: Request, signal: AbortSignal): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const stop = () => void reader.cancel().catch(() => {});
  if (signal.aborted) stop();
  signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw invalid();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_UPLOAD_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof BookingFailure) throw error;
    throw invalid();
  } finally {
    signal.removeEventListener("abort", stop);
    try { reader.releaseLock(); } catch { /* a read still pending after a stop */ }
  }
}

export async function depositProofHttp(request: Request, options: UploadOptions = {}): Promise<Response> {
  const refuse = (e: LifecycleError) => bookingJson({ ok: false, error: e }, lifecycleHttpStatus(e), e.retryAfterSeconds);
  try {
    const config = options.config ?? parseBookingConfiguration();
    if (request.method !== "POST") return bookingJson({ ok: false, error: bookingError("VALIDATION_ERROR", "Use the expected request method.", { commitState: "NOT_APPLICABLE" }) }, 405);
    if (new URL(request.url).search) return refuse(bookingError("VALIDATION_ERROR", "Upload requests do not accept URL parameters.", { commitState: "NOT_APPLICABLE" }));
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return refuse(invalid().error);
    const result = await uploadDepositProof((signal) => readUploadJson(request, signal), { ...options, config, headers: request.headers, signal: request.signal });
    return result.result.ok ? bookingJson(result.result, 200) : refuse(result.result.error);
  } catch (cause) {
    console.warn(JSON.stringify({ event: "booking.deposit_upload_failed", kind: cause instanceof Error ? cause.name : typeof cause }));
    return refuse(unavailable());
  }
}
