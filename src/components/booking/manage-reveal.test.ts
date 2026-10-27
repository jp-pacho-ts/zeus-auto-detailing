// P1-19 (audit 2026-10-28) on the private booking page: opened panels and results come into view
// with focus (W7), one status vocabulary (W11), payment instructions before the upload (W12), the
// private-code wording (W6, Ruling R1) and the cancel button's contrast (L8).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ManagedDayBookingView } from "@/types/contracts";
import { mountHooks } from "./render-hooks.fixture";
import { ManageBooking } from "./manage-booking-page";
import { ManagedBookingDetails } from "./managed-booking-details";
import { DepositProofSection } from "./deposit-proof";
import { PaymentInstructions } from "./payment-instructions";
import { ManagementCode } from "./management-code";
import { bookingStatusWords } from "./manage-booking";

const view = (o: Partial<ManagedDayBookingView> = {}): ManagedDayBookingView => ({
  id: "0c6a3b5e-6d1f-4c2a-9e1b-3f5d7a9c1e2b", referenceCode: "ZEUS-TEST01", status: "PENDING", revision: 1, bookingDate: "2026-11-03",
  timezone: "Asia/Manila", vehicleCategoryId: "11111111-1111-4111-8111-111111111111", vehicleCategoryName: "Small · Compact / Sedan",
  lines: [{ serviceId: "22222222-2222-4222-8222-222222222222", name: "Basic Wash", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 18000, referenceSubtotalCentavos: null }],
  totalPriceCentavos: 18000, estimatedTotalCentavos: 18000, currency: "PHP", selfServiceAllowed: true, selfServiceCutoff: "2026-11-02T10:00:00.000Z",
  deposit: { status: "NONE", proofsSent: 0, proofsAllowed: 3, message: null }, ...o,
});
const json = (body: unknown) => new Response(JSON.stringify(body));
let revealed: string[] = [];
const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, window: g.window, fetch: globalThis.fetch };
beforeEach(() => {
  revealed = [];
  g.document = { getElementById: (id: string) => ({ scrollIntoView: () => revealed.push("scroll:" + id), focus: () => revealed.push("focus:" + id) }) };
  g.window = { matchMedia: () => ({ matches: false }), location: { href: "http://shop.test/book/manage" } };
});
afterEach(() => {
  g.document = saved.document;
  g.window = saved.window;
  globalThis.fetch = saved.fetch;
});
function stub(routes: Record<string, () => Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = (init.method ?? "GET") + " " + String(input);
    const reply = routes[key];
    if (!reply) throw new Error("unexpected " + key);
    return reply();
  }) as typeof fetch;
}
async function open(extra: Record<string, () => Response> = {}) {
  stub({ "GET /api/bookings/manage": () => json({ ok: true, data: view() }), "GET /api/catalog": () => json({ ok: false }), ...extra });
  const h = mountHooks(ManageBooking, {});
  await h.settle();
  revealed = [];
  return h;
}

test("W7: Change day and Cancel bring their panel into view and focus its heading", async () => {
  const h = await open({ "POST /api/bookings/manage/availability": () => json({ ok: false, error: { code: "RATE_LIMITED", message: "Wait", fieldErrors: {}, retryable: true, commitState: "NOT_APPLICABLE", currentQuote: null, currentBooking: null, retryAfterSeconds: 5 } }) });
  h.child(ManagedBookingDetails)!.props.onChangeDay();
  await h.settle();
  assert.deepEqual(revealed.slice(0, 2), ["scroll:days-title", "focus:days-title"]);
  h.button("Keep my current day")!.props.onClick();
  await h.settle();
  revealed = [];
  h.child(ManagedBookingDetails)!.props.onCancel();
  await h.settle();
  assert.deepEqual(revealed, ["scroll:cancel-title", "focus:cancel-title"]);
});

test("W7: the result of a cancel is brought into view, not left above the screen", async () => {
  const cancelled = view({ status: "CANCELLED", selfServiceAllowed: false, revision: 2 });
  const h = await open({ "POST /api/bookings/manage/cancellation": () => json({ ok: true, data: { operationKind: "CANCEL", booking: cancelled, replayed: false, noChange: false } }) });
  h.child(ManagedBookingDetails)!.props.onCancel();
  await h.settle();
  revealed = [];
  h.button("Yes, cancel my booking")!.props.onClick();
  await h.settle();
  assert.match(h.text(), /Your booking is cancelled\./);
  assert.deepEqual(revealed, ["scroll:manage-result", "focus:manage-result"]);
});

test("W11: one status vocabulary on both pages", () => {
  assert.equal(bookingStatusWords("PENDING"), "Waiting for confirmation");
  assert.equal(bookingStatusWords("CONFIRMED"), "Confirmed");
  assert.equal(bookingStatusWords("CANCELLED"), "Cancelled");
});

test("W12: how to pay comes before the screenshot upload, and asks for the reference in the note", async () => {
  const h = await open();
  const order = h.all().map((e) => e.type);
  assert.ok(order.indexOf(PaymentInstructions) >= 0 && order.indexOf(PaymentInstructions) < order.indexOf(DepositProofSection));
  const t = renderToStaticMarkup(createElement(PaymentInstructions, { where: "manage", referenceCode: "ZEUS-TEST01" })).replace(/<[^>]+>/g, " ");
  assert.match(t, /only if the shop asks/);
  assert.match(t, /ZEUS-TEST01/);
  assert.match(t, /note/);
});

test("W6 (Ruling R1): the private code is explained honestly; changes-closed is said plainly", () => {
  const access = { accessToken: "private.code", expiresAt: "2026-11-04T16:00:00.000Z" };
  const text = (now: Date) => renderToStaticMarkup(createElement(ManagementCode, { referenceCode: "ZEUS-TEST01", bookingDate: "2026-11-03", access, now })).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
  const early = text(new Date("2026-11-01T02:00:00.000Z"));
  assert.match(early, /Your private code/);
  assert.match(early, /This phone and browser open your booking without it for 24 hours/);
  assert.doesNotMatch(early, /shown only on this page/i);
  const late = text(new Date("2026-11-02T10:00:00.000Z")); // 18:00 Manila the day before
  assert.match(late, /Online changes for this booking are closed/);
});

test("L8: the cancel confirmation button meets 4.5:1 (white on red-700)", async () => {
  const h = await open();
  h.child(ManagedBookingDetails)!.props.onCancel();
  await h.settle();
  const yes = h.button("Yes, cancel my booking")!;
  assert.match(String(yes.props.className), /bg-red-700/);
  assert.match(String(yes.props.className), /text-white/);
});
