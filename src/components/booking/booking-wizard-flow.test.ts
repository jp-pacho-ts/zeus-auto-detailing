// P1-19 (audit 2026-10-28): the booking wizard's real handlers, mounted with a stubbed network, page
// and clock. Covers step reveal and focus (W1), categories (W3), the PAUSED day step (W2), plain
// one-round errors and the disabled-Submit reason (W4, W5), the kept or explained day (W10) and the
// confirmation landing (W1/L10).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingCatalog, BookingQuote, ServicePackage } from "@/types/catalog-contracts";
import type { PublicDay } from "@/types/contracts";
import { mountHooks } from "./render-hooks.fixture";
import { BookingWizard } from "./booking-wizard";
import { DayPicker } from "./day-picker";
import { TurnstileChallenge } from "./turnstile";

const S = "11111111-1111-4111-8111-111111111111";
const MOTOR = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
let offerSeq = 0;
const offer = (size: string, o: Record<string, unknown>) => ({ id: id(900 + offerSeq++), vehicleCategoryId: size, duration: { kind: "UNKNOWN" }, ...o });
const priced = (size: string, c: number) => offer(size, { state: "OFFERED", bookingMode: "FIXED_ONLINE", onlineBooking: "PRICED", unitPriceCentavos: c, compareAtCentavos: null });
const quoted = (size: string, c: number | null) => offer(size, { state: "OFFERED", bookingMode: "QUOTE_REQUIRED", onlineBooking: "FOR_QUOTE", unitPriceCentavos: c, compareAtCentavos: null });
const none = (size: string) => offer(size, { state: "NOT_OFFERED", bookingMode: "QUOTE_REQUIRED", onlineBooking: "UNAVAILABLE", unitPriceCentavos: null, compareAtCentavos: null });
const service = (n: number, name: string, o: Partial<ServicePackage>): ServicePackage =>
  ({ id: id(n), slug: name.toLowerCase().replace(/ /g, "-"), name, description: null, category: "WASH", type: "BASE", unit: "VEHICLE", inclusions: [],
    productName: null, hardness: null, warrantyMonths: null, referenceUnitPriceCentavos: null, offers: [], ...o }) as ServicePackage;
const basic = service(1, "Basic Wash", { description: "Wash, vacuum, tire black", offers: [priced(S, 18000), priced(MOTOR, 10000)] as never });
const premium = service(2, "Premium Wash", { offers: [priced(S, 60000), none(MOTOR)] as never });
const glass = service(3, "Glass Acid Rain Removal", { type: "ADD_ON", offers: [quoted(S, 50000), none(MOTOR)] as never });
const interior = service(4, "Interior Detailing", { category: "DETAILING", offers: [quoted(S, 400000), none(MOTOR)] as never });
const headlight = service(5, "Headlight Restoration", { category: "DETAILING", offers: [none(S), none(MOTOR)] as never });
const tint = service(6, "Regular Tint", { category: "TINT", offers: [quoted(S, 250000), none(MOTOR)] as never });
const catalog = {
  catalogReleaseId: id(99), catalogVersion: "test",
  vehicleCategories: [
    { id: MOTOR, code: "MOTOR", name: "Motor / Motorcycle", description: null, sortOrder: 0 },
    { id: S, code: "S", name: "Small · Compact / Sedan", description: null, sortOrder: 1 },
  ],
  services: [basic, premium, glass, interior, headlight, tint],
  addOnCompatibility: [{ baseServiceId: basic.id, addOnServiceId: glass.id }],
} as BookingCatalog;

const issued = new Date(Date.now() - 60000);
const quoteFor = (lines: { s: ServicePackage; c: number }[]): BookingQuote => ({
  version: 3, catalogReleaseId: id(99), catalogFingerprint: "a".repeat(64), pricingAlgorithm: "php-service-size-v3",
  vehicleCategoryId: S, primaryServiceId: lines[0].s.id, queueId: "WASH",
  lines: lines.map(({ s, c }) => ({ serviceId: s.id, offerId: id(800), kind: s.type, name: s.name, unit: "VEHICLE", quantity: 1, priceStatus: "PRICED",
    unitPriceCentavos: c, subtotalCentavos: c, referenceUnitPriceCentavos: null, referenceSubtotalCentavos: null })),
  totalPriceCentavos: lines.reduce((t, l) => t + l.c, 0), estimatedTotalCentavos: lines.reduce((t, l) => t + l.c, 0), currency: "PHP",
  issuedAt: issued.toISOString(), expiresAt: new Date(issued.getTime() + 15 * 60000).toISOString(), quoteToken: "signed",
}) as BookingQuote;
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
const openDays = (closed: string[] = []): PublicDay[] => Array.from({ length: 14 }, (_, i) => ({ date: plus(i), state: closed.includes(plus(i)) ? "CLOSED" : "AVAILABLE" }));

// The page: elements the wizard reveals are recorded (scroll to their top, then focus).
let revealed: string[] = [];
let windowWidth = 390;
const g = globalThis as Record<string, unknown>;
const saved = { window: g.window, document: g.document, fetch: globalThis.fetch };
beforeEach(() => {
  revealed = [];
  windowWidth = 390;
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "wizard-test-site-key";
  g.document = {
    getElementById: (elementId: string) => ({
      scrollIntoView: () => revealed.push("scroll:" + elementId),
      focus: () => revealed.push("focus:" + elementId),
    }),
  };
  g.window = {
    setTimeout: (fn: () => void) => setImmediate(fn),
    clearTimeout: (t: NodeJS.Immediate) => clearImmediate(t),
    setInterval: () => 0,
    clearInterval: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    matchMedia: () => ({ matches: false }),
    get innerWidth() {
      return windowWidth;
    },
  };
});
afterEach(() => {
  g.window = saved.window;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  g.document = saved.document;
  globalThis.fetch = saved.fetch;
});

type Reply = (url: URL, body: unknown) => unknown;
function network(o: { days?: () => { days: PublicDay[]; status?: "OPEN" | "PAUSED" }; create?: Reply } = {}) {
  const posts: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://shop.test");
    const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
    if (url.pathname === "/api/catalog") return ok(catalog);
    const lines = (url.searchParams.get("lines") ?? "").split(",").filter(Boolean).map((l) => catalog.services.find((s) => s.id === l.split(":")[0])!);
    const quote = () => quoteFor(lines.map((s) => ({ s, c: s === premium ? 60000 : s === basic ? 18000 : 50000 })));
    if (url.pathname === "/api/bookings/quote") return ok({ quote: quote() });
    if (url.pathname === "/api/availability") {
      const d: { days: PublicDay[]; status?: "OPEN" | "PAUSED" } = (o.days ?? (() => ({ days: openDays() })))();
      return ok({ timezone: "Asia/Manila", days: d.days, nextAvailableDay: d.days.find((x) => x.state === "AVAILABLE")?.date ?? null,
        searchedThrough: plus(90), generatedAt: new Date().toISOString(), quote: quote(), onlineBookingStatus: d.status ?? "OPEN" });
    }
    if (url.pathname === "/api/bookings" && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return new Response(JSON.stringify(o.create ? o.create(url, body) : created(body)));
    }
    throw new Error("unexpected " + url.pathname);
  }) as typeof fetch;
  return posts;
}
const created = (body: { bookingDate: string; acceptedQuote: BookingQuote }) => ({
  ok: true,
  data: {
    booking: { id: id(500), referenceCode: "ZEUS-TEST01", status: "PENDING", revision: 1, bookingDate: body.bookingDate, timezone: "Asia/Manila",
      vehicleCategoryId: S, vehicleCategoryName: "Small · Compact / Sedan",
      lines: body.acceptedQuote.lines.map((l) => ({ serviceId: l.serviceId, name: l.name, quantity: 1, priceStatus: "PRICED", subtotalCentavos: l.subtotalCentavos, referenceSubtotalCentavos: null })),
      totalPriceCentavos: body.acceptedQuote.totalPriceCentavos, estimatedTotalCentavos: body.acceptedQuote.estimatedTotalCentavos, currency: "PHP" },
    managementAccess: { accessToken: "private.code", expiresAt: new Date(Date.now() + 86400000).toISOString() },
    commitState: "COMMITTED", replayed: false,
  },
});

type H = ReturnType<typeof mountHooks<Parameters<typeof BookingWizard>[0]>>;
const heading = (h: H) => {
  const el = h.all().find((e) => e.type === "h1");
  return el ? textOf(el).trim() : "";
};
const back = (h: H) => h.all().find((e) => e.type === "button" && textOf(e.props.children).trim() === "Back")!.props.onClick();
// Calls a handler prop the fixture types loosely (child components' own callbacks, click events).
const fire = (el: { props: Record<string, unknown> } | null | undefined, name: string, ...args: unknown[]) =>
  (el!.props[name] as (...a: unknown[]) => void)(...args);
const textOf = (node: unknown): string =>
  typeof node === "string" || typeof node === "number" ? String(node)
    : Array.isArray(node) ? node.map(textOf).join("")
      : node && typeof node === "object" && "props" in node ? textOf((node as { props: { children?: unknown } }).props.children) : "";
const inputs = (h: H, type: string) => h.all().filter((e) => e.type === "input" && e.props.type === type);
const byLabelText = (h: H, label: string) => h.all().find((e) => e.type === "button" && textOf(e.props.children).includes(label)) ?? null;
const primary = (h: H, label: string) => h.all().find((e) => e.type === "button" && textOf(e.props.children).trim() === label) ?? null;

async function toServices(h: H, size = S) {
  await h.settle();
  inputs(h, "radio").find((e) => e.props.value === size)!.props.onChange({});
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
}
async function toDay(h: H) {
  await toServices(h);
  byLabelText(h, "Premium Carwash")!.props.onClick();
  await h.settle();
  inputs(h, "checkbox").find((e) => e.props.value === basic.id)!.props.onChange({});
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
}
async function toDetails(h: H) {
  await toDay(h);
  h.child(DayPicker)!.props.onSelect(plus(2));
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
}

test("W1: every Continue opens the next step at its top with focus on its heading; the header counts 4 steps", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await h.settle();
  assert.deepEqual(revealed, [], "nothing moves on first load");
  assert.match(h.text(), /Step 1 of 4/);
  await toServices(h);
  assert.equal(heading(h), "Choose your services");
  assert.deepEqual(revealed, ["scroll:wizard-step-title", "focus:wizard-step-title"]);
  assert.match(h.text(), /Step 2 of 4/);
  assert.equal(h.all().find((e) => e.type === "h1")!.props.tabIndex, -1, "the heading can take focus");
  revealed = [];
  byLabelText(h, "Premium Carwash")!.props.onClick();
  await h.settle();
  inputs(h, "checkbox").find((e) => e.props.value === basic.id)!.props.onChange({});
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
  assert.equal(heading(h), "Choose your day");
  assert.deepEqual(revealed, ["scroll:wizard-step-title", "focus:wizard-step-title"]);
  h.unmount();
});

test("W3: services are grouped by category; only the open category is listed; not-offered services are hidden", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toServices(h);
  assert.equal(inputs(h, "checkbox").length, 0, "categories first: no service is listed until one is opened");
  const toggles = h.all().filter((e) => e.type === "button" && "aria-expanded" in e.props);
  assert.deepEqual(toggles.map((t) => textOf(t.props.children).split("·")[0].replace(/\d.*$/, "").trim()), ["Premium Carwash", "Auto Detailing", "Window Tint"]);
  assert.ok(toggles.every((t) => t.props["aria-expanded"] === false && typeof t.props["aria-controls"] === "string"));
  assert.match(textOf(toggles[0].props.children), /2 services/);
  assert.match(textOf(toggles[0].props.children), /from ₱180/);
  byLabelText(h, "Auto Detailing")!.props.onClick();
  await h.settle();
  assert.deepEqual(inputs(h, "checkbox").map((e) => e.props.value), [interior.id], "Headlight Restoration is not offered for this size");
  assert.match(h.text(), /1 service isn't offered for Small · Compact \/ Sedan/);
  byLabelText(h, "Premium Carwash")!.props.onClick();
  await h.settle();
  assert.deepEqual(inputs(h, "checkbox").map((e) => e.props.value), [basic.id, premium.id], "one category open at a time");
  inputs(h, "checkbox").find((e) => e.props.value === basic.id)!.props.onChange({});
  await h.settle();
  const order = inputs(h, "checkbox").map((e) => e.props.value);
  assert.deepEqual(order, [basic.id, glass.id, premium.id], "the wash's extra appears directly under it");
  assert.match(textOf(byLabelText(h, "Premium Carwash")!.props.children), /1 chosen/);
  h.unmount();
});

test("W3: a motorcycle sees only the categories it can book", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toServices(h, MOTOR);
  const toggles = h.all().filter((e) => e.type === "button" && "aria-expanded" in e.props);
  assert.equal(toggles.length, 1);
  assert.match(h.text(), /4 services aren't offered for Motor \/ Motorcycle/);
  h.unmount();
});

test("W2: while online booking is paused the day step offers calls instead of days, and no Continue", async () => {
  network({ days: () => ({ days: openDays(), status: "PAUSED" }) });
  const h = mountHooks(BookingWizard, {});
  await toDay(h);
  assert.equal(primary(h, "Continue"), null);
  const picker = h.child(DayPicker)!;
  const markup = renderToStaticMarkup(DayPicker(picker.props as never) as never);
  assert.match(markup, /Online booking isn&#x27;t open yet/);
  assert.match(markup, /href="tel:/);
  assert.match(markup, /Messenger/);
  assert.doesNotMatch(markup, /Available days|type="radio"|Later days/);
  h.unmount();
});

test("W4: one round of checking with plain words; no browser bubble, no programmer text", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  const form = h.all().find((e) => e.type === "form")!;
  assert.equal(form.props.noValidate, true);
  assert.ok(h.all().every((e) => !e.props.required), "no native required bubble");
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  form.props.onSubmit({ preventDefault() {} });
  await h.settle();
  const t = h.text();
  assert.match(t, /Enter your name \(at least 2 letters\)\./);
  assert.match(t, /Enter a Philippine mobile number, like 0917 000 0000\./);
  assert.match(t, /Enter your car's make and model/);
  assert.doesNotMatch(t, /Too small|expected|>=|string/);
  h.unmount();
});

test("W5: a disabled Submit says why: security check pending, expired or failed", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  const submit = () => h.all().find((e) => e.type === "button" && /Submit booking request/.test(textOf(e.props.children)))!;
  assert.equal(submit().props.disabled, true);
  assert.match(h.text(), /Waiting for the security check/);
  fire(h.child(TurnstileChallenge), "onStatus", "expired");
  await h.settle();
  assert.match(h.text(), /The security check expired/);
  fire(h.child(TurnstileChallenge), "onStatus", "failed");
  await h.settle();
  assert.match(h.text(), /The security check didn't load/);
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  assert.equal(submit().props.disabled, false);
  assert.doesNotMatch(h.text(), /Waiting for the security check|expired|didn't load/);
  h.unmount();
});

test("W5: a server message is shown once, not repeated as its own field line", async () => {
  network({ create: () => ({ ok: false, error: { code: "CHALLENGE_FAILED", message: "Complete the security check again.", fieldErrors: { turnstileToken: ["Complete the security check again."] }, retryable: true, commitState: "UNKNOWN", currentQuote: null, currentBooking: null, retryAfterSeconds: null } }) });
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  for (const [field, value] of [["customerName", "Test Customer"], ["customerPhone", "0917 000 0000"], ["vehicleModel", "Toyota Vios"]])
    h.all().find((e) => e.props.id === field)!.props.onChange({ target: { value } });
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  h.all().find((e) => e.type === "form")!.props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(h.text().split("Complete the security check again.").length - 1, 1);
  h.unmount();
});

test("W1/L10: after Submit the customer lands on 'Booking received' with the arrival hours", async () => {
  const posts = network();
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  for (const [field, value] of [["customerName", "Test Customer"], ["customerPhone", "0917 000 0000"], ["vehicleModel", "Toyota Vios"]])
    h.all().find((e) => e.props.id === field)!.props.onChange({ target: { value } });
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  revealed = [];
  h.all().find((e) => e.type === "form")!.props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(posts.length, 1);
  assert.equal(heading(h), "Booking received");
  assert.deepEqual(revealed, ["scroll:wizard-step-title", "focus:wizard-step-title"]);
  assert.match(h.text(), /Waiting for confirmation/);
  assert.match(h.text(), /Bring your car any time during opening hours, 8 AM–6 PM, on your chosen day\./);
  h.unmount();
});

test("W10: the chosen day is kept after a service change, or cleared with the reason", async () => {
  let closed: string[] = [];
  network({ days: () => ({ days: openDays(closed) }) });
  const h = mountHooks(BookingWizard, {});
  await toDay(h);
  h.child(DayPicker)!.props.onSelect(plus(2));
  await h.settle();
  back(h);
  await h.settle();
  inputs(h, "checkbox").find((e) => e.props.value === premium.id)!.props.onChange({});
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
  assert.equal(h.child(DayPicker)!.props.selected, plus(2), "still available: kept");
  back(h);
  await h.settle();
  closed = [plus(2)];
  inputs(h, "checkbox").find((e) => e.props.value === premium.id)!.props.onChange({});
  await h.settle();
  fire(primary(h, "Continue"), "onClick", { preventDefault() {} });
  await h.settle();
  assert.equal(h.child(DayPicker)!.props.selected, "");
  assert.match(h.text(), /isn't available for this choice\. Choose another day\./);
  h.unmount();
});

test("L9: the security check is compact when the window is narrower than 360 px", async () => {
  network();
  windowWidth = 320;
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  assert.equal(h.child(TurnstileChallenge)!.props.size, "compact");
  h.unmount();
});
