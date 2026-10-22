// Review F1/F2 (Codex, 87728c8): the real screen handlers under rapid repeat taps, slow file reads,
// lost responses and malformed replies. One user action is one operation with one key, sent once
// per attempt; an unconfirmed outcome is retried with the identical body.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ManagedDayBookingView } from "@/types/contracts";
import { deferred, mountHooks } from "./render-hooks.fixture";
import { DepositProofSection } from "./deposit-proof";
import { ManageBooking } from "./manage-booking-page";
import { ManagedBookingDetails } from "./managed-booking-details";
import { DayPicker } from "./day-picker";

const TOKEN = "eyJ2IjoxLCJraWQiOiJnIiwicHVycG9zZSI6IkJPT0tJTkdfTUFOQUdFTUVOVCJ9.c2lnbmF0dXJlLWJ5dGVzLWZvci10aGUtdGVzdC1vbmx5";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
type Call = { url: string; method: string; body: string | undefined };
// Routes each call to the next scripted reply for its path; records every call.
function stubFetch(routes: Record<string, (() => Response | Promise<Response>)[]>) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined });
    const key = (init.method ?? "GET") + " " + url;
    const queue = routes[key];
    if (!queue || !queue.length) throw new Error("unexpected call " + key);
    return queue.length > 1 ? queue.shift()!() : queue[0]();
  }) as typeof fetch;
  return calls;
}
const lost = () => Promise.reject(new TypeError("network connection lost"));
const malformed = () => json({ ok: false }, 502);

test("F1: a second tap while the screenshot is read sends nothing; one key through read, send and retries", async () => {
  const read = deferred<ArrayBuffer>();
  let reads = 0;
  const file = { type: "image/png", size: PNG.length, arrayBuffer: () => (reads++, read.promise) };
  const sent = view({ deposit: { status: "PROOF_SENT", proofsSent: 1, proofsAllowed: 3, message: null } });
  const calls = stubFetch({
    "POST /api/bookings/manage/deposit-proofs": [lost, malformed, () => json({ ok: true, data: { booking: sent, replayed: true } })],
  });
  const updates: ManagedDayBookingView[] = [];
  const h = mountHooks(DepositProofSection, { view: view(), onUpdated: (v) => updates.push(v), onSignedOut: () => assert.fail("signed out") });
  h.all().find((el) => el.props.id === "deposit-file")!.props.onChange({ target: { files: [file] } });
  await h.settle(1);
  const send = h.button("Send screenshot")!;
  send.props.onClick();
  send.props.onClick(); // the same render's handler: a rapid double tap
  assert.equal(reads, 1, "one read for one tap pair");
  await h.settle(1);
  assert.equal(h.button("Send screenshot"), null, "pending shows while the file is still being read");
  assert.equal(h.button("Sending…")!.props.disabled, true);
  send.props.onClick(); // a stale handler fired again during the read
  assert.equal(reads, 1);
  read.resolve(PNG.buffer.slice(0));
  await h.settle();
  assert.equal(calls.length, 1, "exactly one upload request");
  // A stale Send handler (from before the unconfirmed outcome) must not start a new key.
  send.props.onClick();
  await h.settle();
  assert.equal(calls.length, 1, "no new operation while the first is unconfirmed");
  // Lost response: the same screenshot and key are retried, once per tap pair.
  let retry = h.button("Retry the same screenshot")!;
  retry.props.onClick();
  retry.props.onClick();
  await h.settle();
  assert.equal(calls.length, 2);
  // F2: a malformed reply is unconfirmed too; the retry is still offered with the same body.
  retry = h.button("Retry the same screenshot")!;
  assert.ok(retry, "the same-key retry survives a malformed reply");
  retry.props.onClick();
  retry.props.onClick();
  await h.settle();
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((c) => c.body)).size, 1, "identical body and key on every attempt");
  assert.equal(JSON.parse(calls[0].body!).image, Buffer.from(PNG).toString("base64"));
  assert.equal(updates.length, 1);
  assert.match(h.text(), /Your screenshot was sent\./);
  assert.equal(h.button("Retry the same screenshot"), null);
});

test("F1: a new screenshot after a confirmed send gets a new key", async () => {
  const sent = (n: number) => view({ deposit: { status: "PROOF_SENT", proofsSent: n, proofsAllowed: 3, message: null } });
  const calls = stubFetch({
    "POST /api/bookings/manage/deposit-proofs": [() => json({ ok: true, data: { booking: sent(1), replayed: false } }), () => json({ ok: true, data: { booking: sent(2), replayed: false } })],
  });
  let current = view();
  const h = mountHooks(DepositProofSection, { view: current, onUpdated: (v) => (current = v), onSignedOut: () => assert.fail("signed out") });
  for (let i = 0; i < 2; i++) {
    h.all().find((el) => el.props.id === "deposit-file")!.props.onChange({ target: { files: [{ type: "image/png", size: PNG.length, arrayBuffer: async () => PNG.buffer.slice(0) }] } });
    await h.settle(1);
    h.button("Send screenshot")!.props.onClick();
    await h.settle();
    h.rerender({ view: current, onUpdated: (v) => (current = v), onSignedOut: () => assert.fail("signed out") });
  }
  assert.equal(calls.length, 2);
  assert.notEqual(JSON.parse(calls[0].body!).idempotencyKey, JSON.parse(calls[1].body!).idempotencyKey);
});

async function openBooking(extra: Record<string, (() => Response | Promise<Response>)[]> = {}, start = view()) {
  const calls = stubFetch({ "GET /api/bookings/manage": [() => json({ ok: true, data: start })], "GET /api/catalog": [() => json({ ok: false })], ...extra });
  const h = mountHooks(ManageBooking, {});
  await h.settle();
  assert.match(h.text(), /Opening|ZEUS|Your booking/);
  return { h, calls };
}
const postsTo = (calls: Call[], path: string) => calls.filter((c) => c.method === "POST" && c.url === path);

test("F1: cancel: a double tap sends one request; lost and malformed replies retry the identical body", async () => {
  const cancelled = view({ status: "CANCELLED", selfServiceAllowed: false, revision: 2 });
  const { h, calls } = await openBooking({
    "POST /api/bookings/manage/cancellation": [lost, malformed, () => json({ ok: true, data: { operationKind: "CANCEL", booking: cancelled, replayed: true, noChange: false } })],
  });
  h.child(ManagedBookingDetails)!.props.onCancel();
  await h.settle(1);
  const yes = h.button("Yes, cancel my booking")!;
  yes.props.onClick();
  yes.props.onClick();
  await h.settle();
  assert.equal(postsTo(calls, "/api/bookings/manage/cancellation").length, 1);
  yes.props.onClick(); // stale handler after the unconfirmed outcome: no new key
  await h.settle();
  assert.equal(postsTo(calls, "/api/bookings/manage/cancellation").length, 1);
  for (let round = 0; round < 2; round++) {
    const retry = h.button("Retry cancelling")!;
    assert.ok(retry, "same-key retry offered (round " + round + ")");
    retry.props.onClick();
    retry.props.onClick();
    await h.settle();
  }
  const sent = postsTo(calls, "/api/bookings/manage/cancellation");
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map((c) => c.body)).size, 1);
  assert.match(h.text(), /Your booking is cancelled\./);
});

test("F1: change day: a double tap on the move sends one request", async () => {
  const moved = view({ bookingDate: "2026-11-05", revision: 2 });
  const { h, calls } = await openBooking({
    "POST /api/bookings/manage/availability": [() => json({ ok: true, data: { bookingId: view().id, bookingRevision: 1, timezone: "Asia/Manila", days: [{ date: "2026-11-03", state: "AVAILABLE" }, { date: "2026-11-05", state: "AVAILABLE" }], nextAvailableDay: "2026-11-05", searchedThrough: "2027-01-31", quote: null } })],
    "POST /api/bookings/manage/rescheduling": [() => json({ ok: true, data: { operationKind: "RESCHEDULE", booking: moved, replayed: false, noChange: false } })],
  });
  h.child(ManagedBookingDetails)!.props.onChangeDay();
  await h.settle();
  h.child(DayPicker)!.props.onSelect("2026-11-05");
  await h.settle(1);
  const move = h.all().find((el) => el.type === "button" && /^Move my booking to /.test(String((el.props.children as unknown) ?? "")))!;
  move.props.onClick();
  move.props.onClick();
  await h.settle();
  const sent = postsTo(calls, "/api/bookings/manage/rescheduling");
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body!).bookingDate, "2026-11-05");
  assert.match(h.text(), /Your booking is moved to /);
});

test("F1: the code form: a double submit opens one session", async () => {
  const calls = stubFetch({
    "GET /api/bookings/manage": [() => json({ ok: false, error: { code: "UNAUTHENTICATED", message: "x", fieldErrors: {}, retryable: false, commitState: "NOT_APPLICABLE", currentQuote: null, currentBooking: null, retryAfterSeconds: null } }, 401)],
    "POST /api/bookings/manage/session": [() => json({ ok: true, data: { booking: view(), sessionExpiresAt: "2026-11-04T00:00:00.000Z" } })],
    "GET /api/catalog": [() => json({ ok: false })],
  });
  const h = mountHooks(ManageBooking, {});
  await h.settle();
  h.all().find((el) => el.props.id === "booking-code")!.props.onChange({ target: { value: TOKEN } });
  await h.settle(1);
  const form = h.all().find((el) => el.type === "form")!;
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(postsTo(calls, "/api/bookings/manage/session").length, 1);
  assert.match(h.text(), /ZEUS-TEST01|Your booking/);
});

test("F1: sign out: a double tap sends one DELETE", async () => {
  const { h, calls } = await openBooking({ "DELETE /api/bookings/manage/session": [() => new Response(null, { status: 204 })] });
  const out = h.button("Sign out")!;
  out.props.onClick();
  out.props.onClick();
  await h.settle();
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 1);
  assert.match(h.text(), /Enter your booking code/);
});

test("F2: a malformed booking read shows a retryable error, never a blank or half view", async () => {
  stubFetch({ "GET /api/bookings/manage": [() => json({ ok: true, data: { id: "half" } })], "GET /api/catalog": [() => json({ ok: false })] });
  const h = mountHooks(ManageBooking, {});
  await h.settle();
  assert.match(h.text(), /Your booking could not be opened right now\./);
  assert.ok(h.button("Try again"));
});

// Review F2 (Codex delta, ceacff0): complete replies carrying an impossible calendar date. Each is an
// unconfirmed outcome with the same-key retry kept, and the real child components (rendered here with
// react-dom/server) are never handed the bad day.
const page = (h: { tree: () => React.ReactNode }) => renderToStaticMarkup(h.tree());
const shownDay = (h: ReturnType<typeof mountHooks>) => (h.child(ManagedBookingDetails)!.props.view as ManagedDayBookingView).bookingDate;

test("F2: a cancel reply with an impossible date keeps the same-key retry; the page still renders", async () => {
  const cancelled = (bookingDate: string) => ({ operationKind: "CANCEL", booking: view({ status: "CANCELLED", selfServiceAllowed: false, revision: 2, bookingDate }), replayed: true, noChange: false });
  const { h, calls } = await openBooking({
    "POST /api/bookings/manage/cancellation": [() => json({ ok: true, data: cancelled("2026-13-01") }), () => json({ ok: true, data: cancelled("2026-02-30") }), () => json({ ok: true, data: cancelled("2026-11-03") })],
  });
  h.child(ManagedBookingDetails)!.props.onCancel();
  await h.settle(1);
  h.button("Yes, cancel my booking")!.props.onClick();
  await h.settle();
  for (let round = 0; round < 2; round++) {
    assert.match(page(h), /Retry cancelling/, "round " + round);
    assert.equal(shownDay(h), "2026-11-03");
    h.button("Retry cancelling")!.props.onClick();
    await h.settle();
  }
  const sent = postsTo(calls, "/api/bookings/manage/cancellation");
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map((c) => c.body)).size, 1, "identical body and key on every attempt");
  assert.match(page(h), /Your booking is cancelled\./);
});

test("F2: an upload reply with an impossible date keeps the same screenshot retry; the page keeps its view", async () => {
  const sent = (bookingDate: string) => ({ booking: view({ bookingDate, deposit: { status: "PROOF_SENT", proofsSent: 1, proofsAllowed: 3, message: null } }), replayed: false });
  const { h, calls } = await openBooking({
    "POST /api/bookings/manage/deposit-proofs": [() => json({ ok: true, data: sent("2026-04-31") }), () => json({ ok: true, data: sent("2026-11-03") })],
  });
  // The upload section wired to the real page's callbacks.
  const section = mountHooks(DepositProofSection, h.child(DepositProofSection)!.props as unknown as Parameters<typeof DepositProofSection>[0]);
  section.all().find((el) => el.props.id === "deposit-file")!.props.onChange({ target: { files: [{ type: "image/png", size: PNG.length, arrayBuffer: async () => PNG.buffer.slice(0) }] } });
  await section.settle(1);
  section.button("Send screenshot")!.props.onClick();
  await section.settle();
  await h.settle();
  assert.ok(section.button("Retry the same screenshot"), "same-key retry offered");
  assert.equal(shownDay(h), "2026-11-03");
  assert.doesNotMatch(page(h), /Deposit screenshot sent/);
  section.button("Retry the same screenshot")!.props.onClick();
  await section.settle();
  await h.settle();
  const posts = postsTo(calls, "/api/bookings/manage/deposit-proofs");
  assert.equal(posts.length, 2);
  assert.equal(new Set(posts.map((c) => c.body)).size, 1, "identical body and key on every attempt");
  assert.equal((h.child(ManagedBookingDetails)!.props.view as ManagedDayBookingView).deposit.status, "PROOF_SENT");
  page(h);
});

test("F2: availability with an impossible date shows a retryable error; the day picker never gets it", async () => {
  const reply = (days: { date: string; state: string }[], nextAvailableDay: string | null) => () =>
    json({ ok: true, data: { bookingId: view().id, bookingRevision: 1, timezone: "Asia/Manila", days, nextAvailableDay, searchedThrough: "2027-01-31", quote: null } });
  const { h, calls } = await openBooking({
    "POST /api/bookings/manage/availability": [
      reply([{ date: "2026-11-04", state: "AVAILABLE" }, { date: "2026-13-01", state: "AVAILABLE" }], "2026-11-04"),
      reply([{ date: "2026-11-04", state: "AVAILABLE" }], "2026-02-30"),
      reply([{ date: "2026-11-04", state: "AVAILABLE" }, { date: "2026-11-05", state: "AVAILABLE" }], "2026-11-04"),
    ],
  });
  h.child(ManagedBookingDetails)!.props.onChangeDay();
  await h.settle();
  for (let round = 0; round < 2; round++) {
    const picker = h.child(DayPicker)!;
    assert.equal(picker.props.data, null, "round " + round);
    assert.match(String(picker.props.error), /Could not load the days\./);
    page(h);
    (picker.props.onRetry as () => void)();
    await h.settle();
  }
  assert.equal((h.child(DayPicker)!.props.data as { days: unknown[] }).days.length, 2);
  page(h);
  const asked = postsTo(calls, "/api/bookings/manage/availability");
  assert.equal(asked.length, 3);
  assert.equal(new Set(asked.map((c) => c.body)).size, 1);
});

test("F2: a booking read with an impossible date shows a retryable error", async () => {
  stubFetch({ "GET /api/bookings/manage": [() => json({ ok: true, data: view({ bookingDate: "2026-02-30" }) })], "GET /api/catalog": [() => json({ ok: false })] });
  const h = mountHooks(ManageBooking, {});
  await h.settle();
  assert.match(page(h), /Your booking could not be opened right now\./);
  assert.ok(h.button("Try again"));
  assert.equal(h.child(ManagedBookingDetails), null);
});
