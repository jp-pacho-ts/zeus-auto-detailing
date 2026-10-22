// Pure rules for the private booking page (P1-04 management API, ADR-002 code handling) and the
// optional deposit screenshot (P1-18). Customers see status only: no bay, worker, position or
// per-line progress, and never a staff-entered reason.
import type { LifecycleError, LifecycleErrorCode, LifecycleResult } from "@/types/catalog-contracts";
import type {
  BookingStatus,
  DepositProofUploadData,
  ManagedDayAvailabilityData,
  ManagedDayBookingView,
  ManagedDepositView,
  ManagementMutationData,
} from "@/types/contracts";

export const MANAGE_HEADERS = { "content-type": "application/json", "x-zeus-booking": "1" };
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CONTACT_SHOP = "Please contact the shop.";
const SIGNED_OUT = "Your booking page closed. Enter your booking code again.";

// An unsafe request is frozen once (path and exact body, including its idempotency key), so a retry
// after an unconfirmed outcome sends the same bytes and the server replays instead of acting twice.
export interface FrozenRequest { path: string; body: string }
export const freezeRequest = (path: string, body: unknown): FrozenRequest => ({ path, body: JSON.stringify(body) });

const unconfirmed = (): LifecycleError => ({
  code: "RETRYABLE_ERROR",
  message: "The result could not be confirmed.",
  fieldErrors: {},
  retryable: true,
  commitState: "UNKNOWN",
  currentQuote: null,
  currentBooking: null,
  retryAfterSeconds: null,
});

// Only a well-formed reply is trusted (review F2): a success whose data passes the caller's check, or
// a known error code with a message and a valid commit state. Anything else (a proxy's 502 body, a
// missing error, unusable data) is an unconfirmed outcome, so the caller keeps its frozen request.
type Check<T> = (data: unknown) => data is T;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min;
// A real calendar day (review F2): the shape, then a round trip through UTC, so month 13, Feb 30,
// Apr 31 or a non-leap Feb 29 is refused rather than crashing a date label or rolling into another day.
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const time = Date.parse(v + "T00:00:00Z");
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === v;
};
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => typeof v === "string" && (values as readonly string[]).includes(v);
const CODES: Record<LifecycleErrorCode, true> = {
  VALIDATION_ERROR: true, NOT_FOUND: true, SLOT_UNAVAILABLE: true, SCHEDULE_CONFLICT: true, VERSION_CONFLICT: true,
  IDEMPOTENCY_CONFLICT: true, UNAUTHENTICATED: true, FORBIDDEN: true, RATE_LIMITED: true, RETRYABLE_ERROR: true,
  INTERNAL_ERROR: true, CLIENT_UPGRADE_REQUIRED: true, CATALOG_UPDATED: true, QUOTE_EXPIRED: true, OPERATION_CLOSED: true,
  RECOVERY_EXPIRED: true, RECOVERY_UNAVAILABLE: true, BOOKING_NOT_MANAGEABLE: true, CUTOFF_PASSED: true,
  CHALLENGE_FAILED: true, ONLINE_BOOKING_UNAVAILABLE: true, BOOKING_LIMIT_REACHED: true, SERVICE_NOT_OFFERED: true,
  QUOTE_REQUIRED: true, FULLY_BOOKED: true, DAY_CLOSED: true, UNSUPPORTED_FILE: true, FILE_TOO_LARGE: true,
  DEPOSIT_PROOF_LIMIT: true,
};
const isCode = (v: unknown): v is LifecycleErrorCode => typeof v === "string" && Object.prototype.hasOwnProperty.call(CODES, v);
const isCommitState = oneOf(["NOT_COMMITTED", "UNKNOWN", "NOT_APPLICABLE"] as const);
const isStatus = oneOf(["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const);
const isDepositStatus = oneOf(["NONE", "PROOF_SENT", "RECEIVED", "REJECTED"] as const);
const isDayState = oneOf(["AVAILABLE", "FULLY_BOOKED", "CLOSED"] as const);

// Every field the customer screens read from a booking view.
export function isManagedView(v: unknown): v is ManagedDayBookingView {
  if (!isObject(v) || !isObject(v.deposit) || !Array.isArray(v.lines)) return false;
  const d = v.deposit;
  return (
    typeof v.id === "string" &&
    typeof v.referenceCode === "string" &&
    isStatus(v.status) &&
    isInt(v.revision, 1) &&
    isDay(v.bookingDate) &&
    typeof v.timezone === "string" &&
    typeof v.vehicleCategoryName === "string" &&
    isInt(v.totalPriceCentavos) &&
    (v.estimatedTotalCentavos === null || isInt(v.estimatedTotalCentavos)) &&
    typeof v.selfServiceAllowed === "boolean" &&
    typeof v.selfServiceCutoff === "string" &&
    !Number.isNaN(Date.parse(v.selfServiceCutoff)) &&
    v.lines.every(
      (l) =>
        isObject(l) &&
        typeof l.serviceId === "string" &&
        typeof l.name === "string" &&
        isInt(l.quantity, 1) &&
        (l.priceStatus === "PRICED" || l.priceStatus === "FOR_QUOTE") &&
        (l.subtotalCentavos === null || isInt(l.subtotalCentavos)) &&
        (l.referenceSubtotalCentavos === null || isInt(l.referenceSubtotalCentavos)),
    ) &&
    isDepositStatus(d.status) &&
    isInt(d.proofsSent) &&
    isInt(d.proofsAllowed) &&
    (d.message === null || typeof d.message === "string")
  );
}
export const isUploadData = (v: unknown): v is DepositProofUploadData =>
  isObject(v) && isManagedView(v.booking) && typeof v.replayed === "boolean";
export const isMutationData = (v: unknown): v is ManagementMutationData =>
  isObject(v) && (v.operationKind === "CANCEL" || v.operationKind === "RESCHEDULE") && isManagedView(v.booking) && typeof v.replayed === "boolean" && typeof v.noChange === "boolean";
export const isAvailabilityData = (v: unknown): v is ManagedDayAvailabilityData =>
  isObject(v) && Array.isArray(v.days) && v.days.every((d) => isObject(d) && isDay(d.date) && isDayState(d.state)) && (v.nextAvailableDay === null || isDay(v.nextAvailableDay));
export const isSessionData = (v: unknown): v is { booking: ManagedDayBookingView; sessionExpiresAt: string } =>
  isObject(v) && isManagedView(v.booking) && typeof v.sessionExpiresAt === "string";

export function parseLifecycle<T>(value: unknown, isData: Check<T>): LifecycleResult<T> {
  if (isObject(value) && value.ok === true && isData(value.data)) return { ok: true, data: value.data };
  if (isObject(value) && value.ok === false && isObject(value.error)) {
    const e = value.error;
    if (isCode(e.code) && typeof e.message === "string" && isCommitState(e.commitState))
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          fieldErrors: isObject(e.fieldErrors) ? (e.fieldErrors as Record<string, string[]>) : {},
          retryable: e.retryable === true,
          commitState: e.commitState,
          currentQuote: null, // never read by these screens
          currentBooking: isManagedView(e.currentBooking) ? e.currentBooking : null,
          retryAfterSeconds: isInt(e.retryAfterSeconds, 1) ? (e.retryAfterSeconds as number) : null,
        },
      };
  }
  return { ok: false, error: unconfirmed() };
}

// Network failures and non-JSON or malformed replies are unconfirmed outcomes, never failures.
export async function sendFrozen<T>(fetchImpl: typeof fetch, request: FrozenRequest, isData: Check<T>): Promise<LifecycleResult<T>> {
  try {
    const response = await fetchImpl(request.path, {
      method: "POST",
      headers: MANAGE_HEADERS,
      body: request.body,
      cache: "no-store",
      credentials: "same-origin",
    });
    return parseLifecycle(await response.json(), isData);
  } catch {
    return { ok: false, error: unconfirmed() };
  }
}

const STATUS: Record<BookingStatus, string> = {
  PENDING: "Waiting for the shop to confirm",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress at the shop",
  COMPLETED: "Done",
  CANCELLED: "Cancelled",
};
export const bookingStatusWords = (status: BookingStatus) => STATUS[status];

// Self-service needs a waiting booking before the cutoff (P1-04 R2); the server decides.
export function selfServiceNotice(view: ManagedDayBookingView): string | null {
  if (view.selfServiceAllowed) return null;
  if (view.status === "CANCELLED") return "This booking is cancelled.";
  if (view.status === "COMPLETED") return "This booking is done.";
  return "To change or cancel this booking, please contact the shop.";
}

const DEPOSIT: Record<ManagedDepositView["status"], string> = {
  NONE: "No deposit screenshot sent.",
  PROOF_SENT: "Screenshot sent. The shop will check it.",
  RECEIVED: "Deposit received.",
  // Fixed wording whatever the server sends: a staff reason never reaches the customer.
  REJECTED: CONTACT_SHOP,
};
export const depositWords = (deposit: ManagedDepositView) => DEPOSIT[deposit.status];

const LIMIT_REACHED = "You have sent 3 screenshots, the most for one booking. Please contact the shop.";
export function canSendProof(view: ManagedDayBookingView): boolean {
  return (
    view.status !== "CANCELLED" &&
    view.status !== "COMPLETED" &&
    view.deposit.status !== "RECEIVED" &&
    view.deposit.proofsSent < view.deposit.proofsAllowed
  );
}

// A first check in the browser; the server still decides by the file's content.
export function checkProofFile(file: { size: number; type: string }, deposit: ManagedDepositView): string | null {
  if (deposit.proofsSent >= deposit.proofsAllowed) return LIMIT_REACHED;
  if (!PROOF_TYPES.includes(file.type)) return "Choose a JPEG, PNG or WebP screenshot.";
  if (file.size === 0) return "This file is empty. Choose your payment screenshot.";
  if (file.size > MAX_PROOF_BYTES) return "This file is over 5 MB. Choose a smaller screenshot.";
  return null;
}

const wait = (e: LifecycleError, then: string) =>
  "Too many tries. Wait " + (e.retryAfterSeconds ?? 60) + " seconds, then " + then + ".";

export function proofUploadError(e: LifecycleError): { message: string; retrySame: boolean; signedOut: boolean } {
  const result = (message: string, retrySame = false, signedOut = false) => ({ message, retrySame, signedOut });
  switch (e.code) {
    case "UNSUPPORTED_FILE":
      return result("This file is not a JPEG, PNG or WebP image. Send a screenshot of your payment.");
    case "FILE_TOO_LARGE":
      return result("This file is over 5 MB. Send a smaller screenshot.");
    case "DEPOSIT_PROOF_LIMIT":
      return result(LIMIT_REACHED);
    case "BOOKING_NOT_MANAGEABLE":
      return result("This booking cannot take a screenshot now. Please contact the shop.");
    case "UNAUTHENTICATED":
      return result(SIGNED_OUT, false, true);
    case "IDEMPOTENCY_CONFLICT":
      return result("Choose your screenshot again and send it.");
    case "RATE_LIMITED":
      return result(wait(e, "retry the same screenshot"), true);
    default:
      if (e.commitState === "UNKNOWN") return result("We could not confirm the upload. Retry to send the same screenshot safely.", true);
      return result("This upload could not be accepted. Reload the page and try again.");
  }
}

export function manageActionError(e: LifecycleError): {
  message: string;
  retrySame: boolean;
  signedOut: boolean;
  currentBooking: ManagedDayBookingView | null;
} {
  const result = (message: string, retrySame = false, signedOut = false) => ({ message, retrySame, signedOut, currentBooking: e.currentBooking });
  switch (e.code) {
    case "UNAUTHENTICATED":
      return result(SIGNED_OUT, false, true);
    case "VERSION_CONFLICT":
      return result("This booking changed. Check it below, then try again.");
    case "CUTOFF_PASSED":
      return result("It is too late to change this booking online. Please contact the shop.");
    case "BOOKING_NOT_MANAGEABLE":
      return result("Please contact the shop to change this booking.");
    case "FULLY_BOOKED":
    case "DAY_CLOSED":
      return result("That day is no longer available. Choose another day.");
    case "RATE_LIMITED":
      return result(wait(e, "retry"), true);
    default:
      if (e.commitState === "UNKNOWN") return result("We could not confirm this change. Retry to finish it safely; it will not be done twice.", true);
      return result(e.code === "VALIDATION_ERROR" ? "That change could not be made. Choose again." : CONTACT_SHOP);
  }
}

// The saved code file: the code and where to use it, never the customer's name or phone.
export function managementCodeFile(input: { referenceCode: string; bookingDate: string; accessToken: string; expiresAt: string; origin: string }) {
  return {
    name: "zeus-booking-" + input.referenceCode + ".txt",
    text: [
      "Zeus Auto Detailing booking code",
      "",
      "Reference: " + input.referenceCode,
      "Booking day: " + input.bookingDate,
      "Code valid until: " + input.expiresAt,
      "",
      "To see, change or cancel your booking, open " + input.origin + "/book/manage and enter this code:",
      "",
      input.accessToken,
      "",
      "Keep this code private. Anyone with it can change or cancel your booking.",
      "",
    ].join("\r\n"),
  };
}

// A signed management code is two base64url parts; accept it pasted alone or inside the saved file.
export function codeFromText(text: string): string | null {
  const match = text.match(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  return match ? match[0] : null;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
