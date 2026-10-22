// P1-05 second pass + P1-18 customer UI: the private booking page's pure rules (P1-04 contract,
// ADR-002 management code, ADR-005 status-only view, P1-18 upload contract).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LifecycleError } from "@/types/catalog-contracts";
import type { ManagedDayBookingView } from "@/types/contracts";
import {
  MANAGE_HEADERS,
  MAX_PROOF_BYTES,
  bookingStatusWords,
  canSendProof,
  checkProofFile,
  codeFromText,
  depositWords,
  freezeRequest,
  isAvailabilityData,
  isManagedView,
  isMutationData,
  isSessionData,
  isUploadData,
  manageActionError,
  managementCodeFile,
  parseLifecycle,
  proofUploadError,
  selfServiceNotice,
  sendFrozen,
  toBase64,
} from "./manage-booking";

const TOKEN = "eyJ2IjoxLCJraWQiOiJnIiwicHVycG9zZSI6IkJPT0tJTkdfTUFOQUdFTUVOVCJ9.c2lnbmF0dXJlLWJ5dGVzLWZvci10aGUtdGVzdC1vbmx5";
const view = (o: Partial<ManagedDayBookingView> = {}): ManagedDayBookingView => ({
  id: "0c6a3b5e-6d1f-4c2a-9e1b-3f5d7a9c1e2b",
  referenceCode: "ZEUS-TEST01",
  status: "PENDING",
  revision: 1,
  bookingDate: "2026-11-03",
  timezone: "Asia/Manila",
  vehicleCategoryId: "11111111-1111-4111-8111-111111111111",
  vehicleCategoryName: "Small · Compact / Sedan",
  lines: [{ serviceId: "22222222-2222-4222-8222-222222222222", name: "Basic Wash", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 18000, referenceSubtotalCentavos: null }],
  totalPriceCentavos: 18000,
  estimatedTotalCentavos: 18000,
  currency: "PHP",
  selfServiceAllowed: true,
  selfServiceCutoff: "2026-11-02T10:00:00.000Z",
  deposit: { status: "NONE", proofsSent: 0, proofsAllowed: 3, message: null },
  ...o,
});
const error = (code: LifecycleError["code"], o: Partial<LifecycleError> = {}): LifecycleError => ({
  code, message: "Server text for " + code, fieldErrors: {}, retryable: false, commitState: "NOT_APPLICABLE",
  currentQuote: null, currentBooking: null, retryAfterSeconds: null, ...o,
});

test("unsafe calls use exact JSON and the booking header", () => {
  assert.deepEqual(MANAGE_HEADERS, { "content-type": "application/json", "x-zeus-booking": "1" });
});

test("a frozen request resends the same bytes and the same idempotency key", async () => {
  const frozen = freezeRequest("/api/bookings/manage/cancellation", { bookingId: "b", idempotencyKey: "k-1", expectedRevision: 2 });
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: false, error: error("RETRYABLE_ERROR", { commitState: "UNKNOWN" }) }), { status: 503 });
  };
  const first = await sendFrozen(fake as typeof fetch, frozen, isMutationData);
  const second = await sendFrozen(fake as typeof fetch, frozen, isMutationData);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.url, "/api/bookings/manage/cancellation");
    assert.equal(c.init.method, "POST");
    assert.deepEqual(c.init.headers, MANAGE_HEADERS);
    assert.equal(c.init.cache, "no-store");
    assert.equal(c.init.credentials, "same-origin");
  }
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(JSON.parse(String(calls[0].init.body)).idempotencyKey, "k-1");
  // The URL never carries anything: no query string, no fragment.
  assert.doesNotMatch(calls[0].url, /[?#]/);
});

test("a non-JSON reply reads as an unconfirmed outcome", async () => {
  const frozen = freezeRequest("/api/bookings/manage/rescheduling", { k: 1 });
  const result = await sendFrozen((async () => new Response("<html>", { status: 502 })) as typeof fetch, frozen, isMutationData);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "RETRYABLE_ERROR");
    assert.equal(result.error.commitState, "UNKNOWN");
  }
});

test("customer status words are status only", () => {
  assert.equal(bookingStatusWords("PENDING"), "Waiting for the shop to confirm");
  assert.equal(bookingStatusWords("CONFIRMED"), "Confirmed");
  assert.equal(bookingStatusWords("IN_PROGRESS"), "In progress at the shop");
  assert.equal(bookingStatusWords("COMPLETED"), "Done");
  assert.equal(bookingStatusWords("CANCELLED"), "Cancelled");
});

test("a booking already in a bay, started or past the cutoff sends the customer to the shop", () => {
  assert.equal(selfServiceNotice(view()), null);
  assert.equal(selfServiceNotice(view({ selfServiceAllowed: false })), "To change or cancel this booking, please contact the shop.");
  assert.equal(selfServiceNotice(view({ status: "IN_PROGRESS", selfServiceAllowed: false })), "To change or cancel this booking, please contact the shop.");
  assert.equal(selfServiceNotice(view({ status: "CANCELLED", selfServiceAllowed: false })), "This booking is cancelled.");
  assert.equal(selfServiceNotice(view({ status: "COMPLETED", selfServiceAllowed: false })), "This booking is done.");
});

test("deposit status reads in customer words; a rejected proof says only 'Please contact the shop.'", () => {
  assert.equal(depositWords(view().deposit), "No deposit screenshot sent.");
  assert.equal(depositWords({ status: "PROOF_SENT", proofsSent: 1, proofsAllowed: 3, message: null }), "Screenshot sent. The shop will check it.");
  assert.equal(depositWords({ status: "RECEIVED", proofsSent: 1, proofsAllowed: 3, message: null }), "Deposit received.");
  assert.equal(depositWords({ status: "REJECTED", proofsSent: 1, proofsAllowed: 3, message: "Please contact the shop." }), "Please contact the shop.");
  // Whatever else the server might send, the customer sees the fixed wording.
  assert.equal(depositWords({ status: "REJECTED", proofsSent: 1, proofsAllowed: 3, message: "staff note" }), "Please contact the shop.");
});

test("a screenshot can be sent while the booking is open, the deposit is not received and fewer than 3 were sent", () => {
  assert.equal(canSendProof(view()), true);
  assert.equal(canSendProof(view({ status: "IN_PROGRESS", selfServiceAllowed: false })), true);
  assert.equal(canSendProof(view({ deposit: { status: "REJECTED", proofsSent: 2, proofsAllowed: 3, message: "Please contact the shop." } })), true);
  assert.equal(canSendProof(view({ deposit: { status: "PROOF_SENT", proofsSent: 3, proofsAllowed: 3, message: null } })), false);
  assert.equal(canSendProof(view({ deposit: { status: "RECEIVED", proofsSent: 1, proofsAllowed: 3, message: null } })), false);
  assert.equal(canSendProof(view({ status: "CANCELLED" })), false);
  assert.equal(canSendProof(view({ status: "COMPLETED" })), false);
});

test("each refused file gets its own clear reason before anything is sent", () => {
  const d = view().deposit;
  assert.equal(MAX_PROOF_BYTES, 5 * 1024 * 1024);
  assert.equal(checkProofFile({ size: 1000, type: "image/png" }, d), null);
  assert.equal(checkProofFile({ size: 1000, type: "image/jpeg" }, d), null);
  assert.equal(checkProofFile({ size: 1000, type: "image/webp" }, d), null);
  assert.equal(checkProofFile({ size: 1000, type: "image/gif" }, d), "Choose a JPEG, PNG or WebP screenshot.");
  assert.equal(checkProofFile({ size: 1000, type: "application/pdf" }, d), "Choose a JPEG, PNG or WebP screenshot.");
  assert.equal(checkProofFile({ size: 0, type: "image/png" }, d), "This file is empty. Choose your payment screenshot.");
  assert.equal(checkProofFile({ size: MAX_PROOF_BYTES, type: "image/png" }, d), null);
  assert.equal(checkProofFile({ size: MAX_PROOF_BYTES + 1, type: "image/png" }, d), "This file is over 5 MB. Choose a smaller screenshot.");
  assert.equal(
    checkProofFile({ size: 1000, type: "image/png" }, { status: "PROOF_SENT", proofsSent: 3, proofsAllowed: 3, message: null }),
    "You have sent 3 screenshots, the most for one booking. Please contact the shop.",
  );
});

test("server refusals of an upload read clearly; only unconfirmed outcomes retry the same screenshot", () => {
  assert.deepEqual(proofUploadError(error("UNSUPPORTED_FILE", { fieldErrors: { image: ["x"] } })), {
    message: "This file is not a JPEG, PNG or WebP image. Send a screenshot of your payment.", retrySame: false, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("FILE_TOO_LARGE")), { message: "This file is over 5 MB. Send a smaller screenshot.", retrySame: false, signedOut: false });
  assert.deepEqual(proofUploadError(error("DEPOSIT_PROOF_LIMIT", { commitState: "NOT_COMMITTED" })), {
    message: "You have sent 3 screenshots, the most for one booking. Please contact the shop.", retrySame: false, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("BOOKING_NOT_MANAGEABLE", { commitState: "NOT_COMMITTED" })), {
    message: "This booking cannot take a screenshot now. Please contact the shop.", retrySame: false, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("UNAUTHENTICATED")), {
    message: "Your booking page closed. Enter your booking code again.", retrySame: false, signedOut: true,
  });
  assert.deepEqual(proofUploadError(error("RATE_LIMITED", { commitState: "UNKNOWN", retryAfterSeconds: 42 })), {
    message: "Too many tries. Wait 42 seconds, then retry the same screenshot.", retrySame: true, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("RETRYABLE_ERROR", { commitState: "UNKNOWN", retryAfterSeconds: 2 })), {
    message: "We could not confirm the upload. Retry to send the same screenshot safely.", retrySame: true, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("IDEMPOTENCY_CONFLICT", { commitState: "NOT_COMMITTED" })), {
    message: "Choose your screenshot again and send it.", retrySame: false, signedOut: false,
  });
  assert.deepEqual(proofUploadError(error("FORBIDDEN")), {
    message: "This upload could not be accepted. Reload the page and try again.", retrySame: false, signedOut: false,
  });
});

test("cancel and reschedule errors: unconfirmed retries the same key; a changed booking reloads; no staff text", () => {
  const unknown = manageActionError(error("RETRYABLE_ERROR", { commitState: "UNKNOWN" }));
  assert.equal(unknown.retrySame, true);
  assert.equal(unknown.message, "We could not confirm this change. Retry to finish it safely; it will not be done twice.");
  const limited = manageActionError(error("RATE_LIMITED", { commitState: "UNKNOWN", retryAfterSeconds: 30 }));
  assert.equal(limited.retrySame, true);
  assert.equal(limited.message, "Too many tries. Wait 30 seconds, then retry.");
  const current = view({ revision: 4 });
  const changed = manageActionError(error("VERSION_CONFLICT", { commitState: "NOT_COMMITTED", currentBooking: current }));
  assert.equal(changed.retrySame, false);
  assert.equal(changed.currentBooking, current);
  assert.equal(changed.message, "This booking changed. Check it below, then try again.");
  assert.equal(manageActionError(error("CUTOFF_PASSED", { commitState: "NOT_COMMITTED" })).message, "It is too late to change this booking online. Please contact the shop.");
  assert.equal(manageActionError(error("BOOKING_NOT_MANAGEABLE", { commitState: "NOT_COMMITTED" })).message, "Please contact the shop to change this booking.");
  assert.equal(manageActionError(error("FULLY_BOOKED", { commitState: "NOT_COMMITTED" })).message, "That day is no longer available. Choose another day.");
  assert.equal(manageActionError(error("DAY_CLOSED", { commitState: "NOT_COMMITTED" })).message, "That day is no longer available. Choose another day.");
  const out = manageActionError(error("UNAUTHENTICATED"));
  assert.equal(out.signedOut, true);
  assert.equal(out.message, "Your booking page closed. Enter your booking code again.");
});

test("the saved code file holds the code, reference, day and where to use it; no name or phone", () => {
  const file = managementCodeFile({ referenceCode: "ZEUS-TEST01", bookingDate: "2026-11-03", accessToken: TOKEN, expiresAt: "2026-11-04T16:00:00.000Z", origin: "https://zeus.example" });
  assert.equal(file.name, "zeus-booking-ZEUS-TEST01.txt");
  assert.match(file.text, /ZEUS-TEST01/);
  assert.match(file.text, /2026-11-03/);
  assert.ok(file.text.includes(TOKEN));
  assert.ok(file.text.includes("https://zeus.example/book/manage"));
  // The page link never carries the code.
  assert.ok(!file.text.includes("/book/manage?"));
  assert.ok(!file.text.includes("/book/manage#"));
  assert.match(file.text, /Keep this code private/);
});

test("the code is found in a pasted text or a saved code file; anything else is refused", () => {
  assert.equal(codeFromText(TOKEN), TOKEN);
  assert.equal(codeFromText("  " + TOKEN + "\n"), TOKEN);
  const file = managementCodeFile({ referenceCode: "ZEUS-TEST01", bookingDate: "2026-11-03", accessToken: TOKEN, expiresAt: "2026-11-04T16:00:00.000Z", origin: "https://zeus.example" });
  assert.equal(codeFromText(file.text), TOKEN);
  assert.equal(codeFromText("ZEUS-TEST01"), null);
  assert.equal(codeFromText(""), null);
  assert.equal(codeFromText("abc.def"), null);
});

test("file bytes become standard base64 with no data: prefix", () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 37) % 256);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"));
  assert.equal(toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "iVBORw==");
});

// Review F2 (Codex, 87728c8): only a well-formed success or a known, well-formed error is trusted.
// Anything else is an unconfirmed outcome, so the frozen request (same bytes, same key) is retried.
test("F2: malformed envelopes and unusable success data read as unconfirmed; the handlers never throw", async () => {
  const frozen = freezeRequest("/api/bookings/manage/deposit-proofs", { bookingId: "b", idempotencyKey: "k-9", image: "iVBORw==" });
  const replies: [number, unknown][] = [
    [502, { ok: false }],
    [200, { ok: false, error: null }],
    [409, { ok: false, error: { code: "DEPOSIT_PROOF_LIMIT" } }],
    [409, { ok: false, error: { code: 42, message: "x", commitState: "NOT_COMMITTED" } }],
    [409, { ok: false, error: { code: "NOT_A_CODE", message: "x", commitState: "NOT_COMMITTED" } }],
    [409, { ok: false, error: { code: "DEPOSIT_PROOF_LIMIT", message: "x", commitState: "MAYBE" } }],
    [200, { ok: true }],
    [200, { ok: true, data: null }],
    [200, { ok: true, data: { replayed: false } }],
    [200, { ok: true, data: { booking: { id: "b" }, replayed: false } }],
    [200, { ok: "yes", data: {} }],
    [200, []],
    [200, null],
  ];
  const bodies: unknown[] = [];
  for (const [status, body] of replies) {
    const fake = async (_url: string, init: RequestInit) => {
      bodies.push(init.body);
      return new Response(JSON.stringify(body), { status });
    };
    const result = await sendFrozen(fake as typeof fetch, frozen, isUploadData);
    assert.equal(result.ok, false, JSON.stringify(body));
    if (result.ok) continue;
    assert.equal(result.error.code, "RETRYABLE_ERROR", JSON.stringify(body));
    assert.equal(result.error.commitState, "UNKNOWN", JSON.stringify(body));
    assert.equal(proofUploadError(result.error).retrySame, true);
    assert.equal(manageActionError(result.error).retrySame, true);
  }
  assert.equal(new Set(bodies).size, 1, "every attempt sends the identical body and key");
});

test("F2: a known error is trusted and normalized; a well-formed success passes its data check", async () => {
  const frozen = freezeRequest("/api/bookings/manage/deposit-proofs", { k: 1 });
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const known = await sendFrozen(reply(409, { ok: false, error: { code: "DEPOSIT_PROOF_LIMIT", message: "x", commitState: "NOT_COMMITTED", currentBooking: { id: "half" }, retryAfterSeconds: "soon" } }), frozen, isUploadData);
  assert.equal(known.ok, false);
  if (!known.ok) {
    assert.equal(known.error.code, "DEPOSIT_PROOF_LIMIT");
    assert.equal(known.error.commitState, "NOT_COMMITTED");
    assert.deepEqual(known.error.fieldErrors, {});
    assert.equal(known.error.currentBooking, null, "an unusable current booking is dropped");
    assert.equal(known.error.retryAfterSeconds, null);
    assert.equal(proofUploadError(known.error).retrySame, false);
  }
  const conflict = await sendFrozen(reply(409, { ok: false, error: { code: "VERSION_CONFLICT", message: "x", commitState: "NOT_COMMITTED", fieldErrors: {}, currentBooking: view({ revision: 3 }), retryAfterSeconds: null } }), frozen, isMutationData);
  assert.equal(!conflict.ok && conflict.error.currentBooking?.revision, 3);
  const good = await sendFrozen(reply(200, { ok: true, data: { booking: view(), replayed: true } }), frozen, isUploadData);
  assert.equal(good.ok && good.data.replayed, true);
  assert.equal(isManagedView(view()), true);
  assert.equal(isManagedView({ ...view(), deposit: null }), false);
  assert.equal(isManagedView({ ...view(), status: "LOST" }), false);
  assert.equal(isMutationData({ operationKind: "CANCEL", booking: view(), replayed: false, noChange: false }), true);
  assert.equal(isMutationData({ operationKind: "CANCEL", booking: view(), replayed: false }), false);
  assert.equal(isAvailabilityData({ days: [{ date: "2026-11-04", state: "AVAILABLE" }], nextAvailableDay: "2026-11-04" }), true);
  assert.equal(isAvailabilityData({ days: [{ date: "2026-11-04", state: "OPEN" }], nextAvailableDay: null }), false);
  assert.equal(isSessionData({ booking: view(), sessionExpiresAt: "2026-11-04T00:00:00.000Z" }), true);
  assert.equal(isSessionData({ booking: view() }), false);
  assert.equal(parseLifecycle({ ok: true, data: view() }, isManagedView).ok, true);
  assert.equal(parseLifecycle({ ok: true, data: {} }, isManagedView).ok, false);
});
