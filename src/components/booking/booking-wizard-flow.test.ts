// P1-19 (audit 2026-10-28): the booking wizard's real handlers, mounted with a stubbed network, page
// and clock. Covers step reveal and focus (W1), categories (W3), the PAUSED day step (W2), plain
// one-round errors and the disabled-Submit reason (W4, W5), the kept or explained day (W10) and the
// confirmation landing (W1/L10).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingCatalog, BookingQuote, ServicePackage } from "@/types/catalog-contracts";
import type { PublicDay } from "@/types/contracts";
import { mountHooks } from "./render-hooks.fixture";
import { BookingWizard } from "./booking-wizard";
import { BookingTicket } from "./booking-ticket";
import { VehicleDrawing } from "./vehicle-drawing";
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
const saved = { window: g.window, document: g.document, fetch: globalThis.fetch, ResizeObserver: g.ResizeObserver, Element: g.Element };
// The fixed action bar's measured height (QA F1) and the narrow-screen media query (QA F2).
let barHeight = 129;
let rootStyle: { scrollPaddingBottom?: string } = {};
let resized: (() => void)[] = [];
let narrowListeners: (() => void)[] = [];
let focusListeners: ((e: { target: unknown }) => void)[] = [];
// A focusable control: records how the wizard scrolled it into view.
class FakeElement {
  scrolls: unknown[] = [];
  scrollIntoView(options: unknown) {
    this.scrolls.push(options);
  }
}
const inBar = new FakeElement();
const focusOn = (target: unknown) => {
  for (const fn of focusListeners) fn({ target });
};
const resizeTo = (width: number) => {
  windowWidth = width;
  for (const fn of narrowListeners) fn();
};
beforeEach(() => {
  revealed = [];
  windowWidth = 390;
  barHeight = 129;
  rootStyle = {};
  resized = [];
  narrowListeners = [];
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "wizard-test-site-key";
  focusListeners = [];
  g.Element = FakeElement;
  g.document = {
    documentElement: { style: rootStyle },
    addEventListener: (type: string, fn: (e: { target: unknown }) => void) => type === "focusin" && focusListeners.push(fn),
    removeEventListener: (type: string, fn: (e: { target: unknown }) => void) => {
      focusListeners = focusListeners.filter((f) => f !== fn);
    },
    getElementById: (elementId: string) =>
      elementId === "wizard-action-bar"
        ? { get offsetHeight() { return barHeight; }, contains: (el: unknown) => el === inBar }
        : {
            scrollIntoView: () => revealed.push("scroll:" + elementId),
            focus: () => revealed.push("focus:" + elementId),
          },
  };
  g.ResizeObserver = class {
    constructor(private fn: () => void) {}
    observe() {
      resized.push(this.fn);
    }
    disconnect() {
      resized = resized.filter((f) => f !== this.fn);
    }
  };
  g.window = {
    setTimeout: (fn: () => void) => setImmediate(fn),
    clearTimeout: (t: NodeJS.Immediate) => clearImmediate(t),
    setInterval: () => 0,
    clearInterval: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => fn(),
    matchMedia: (query: string) => ({
      get matches() {
        return query === "(max-width: 359px)" ? windowWidth < 360 : false;
      },
      addEventListener: (_type: string, fn: () => void) => narrowListeners.push(fn),
      removeEventListener: (_type: string, fn: () => void) => {
        narrowListeners = narrowListeners.filter((f) => f !== fn);
      },
    }),
    get innerWidth() {
      return windowWidth;
    },
  };
});
afterEach(() => {
  g.window = saved.window;
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  g.document = saved.document;
  g.ResizeObserver = saved.ResizeObserver;
  g.Element = saved.Element;
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
  assert.match(t, /Enter your first name\./);
  assert.match(t, /Enter your last name\./);
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
  for (const [field, value] of [["customerFirstName", "Test"], ["customerLastName", "Customer"], ["customerPhone", "0917 000 0000"], ["vehicleModel", "Toyota Vios"]])
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
  for (const [field, value] of [["customerFirstName", "Test"], ["customerLastName", "Customer"], ["customerPhone", "0917 000 0000"], ["vehicleModel", "Toyota Vios"]])
    h.all().find((e) => e.props.id === field)!.props.onChange({ target: { value } });
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  revealed = [];
  h.all().find((e) => e.type === "form")!.props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(posts.length, 1);
  assert.equal(heading(h), "Booking received");
  assert.deepEqual(revealed, ["scroll:wizard-step-title", "focus:wizard-step-title"]);
  // P1-52: the confirmation is the ticket component; its markup carries the reference, the status and the arrival hours.
  const ticketText = renderToStaticMarkup(createElement(BookingTicket, h.child(BookingTicket)!.props as never))
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\r\n]+/g, " ");
  assert.match(ticketText, /ZEUS-TEST01/);
  assert.match(ticketText, /Waiting for confirmation/);
  assert.match(ticketText, /Bring your car any time during opening hours, 8\u00a0AM–6\u00a0PM, on your chosen day\./);
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

test("QA F2: an open details step switches the security check to compact when the window narrows, with no other input", async () => {
  network();
  windowWidth = 1280;
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  assert.equal(h.child(TurnstileChallenge)!.props.size, "normal");
  resizeTo(320);
  await h.settle();
  assert.equal(h.child(TurnstileChallenge)!.props.size, "compact", "no field was touched");
  resizeTo(1280);
  await h.settle();
  assert.equal(h.child(TurnstileChallenge)!.props.size, "normal");
  h.unmount();
  assert.equal(narrowListeners.length, 0, "the media-query listener is removed on unmount");
});

test("QA F1: keyboard focus scrolling keeps clear of the fixed action bar, at its measured height", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await h.settle();
  assert.equal(rootStyle.scrollPaddingBottom, "145px", "bar height 129 + 16 px clearance, from step 1");
  await toDetails(h);
  assert.equal(rootStyle.scrollPaddingBottom, "145px");
  barHeight = 177; // e.g. the security-check reason wraps to two lines
  for (const fn of resized) fn();
  assert.equal(rootStyle.scrollPaddingBottom, "193px");
  // A focused control (e.g. a tall text box the browser left partly under the bar) is brought fully
  // into the padded view, instantly; the bar's own buttons are left alone.
  const textBox = new FakeElement();
  focusOn(textBox);
  assert.deepEqual(textBox.scrolls, [{ block: "nearest", behavior: "instant" }]);
  focusOn(inBar);
  assert.deepEqual(inBar.scrolls, []);
  barHeight = 0; // desktop: the bar is hidden
  for (const fn of resized) fn();
  assert.equal(rootStyle.scrollPaddingBottom, "");
  const desktopField = new FakeElement();
  focusOn(desktopField);
  assert.deepEqual(desktopField.scrolls, [], "no extra scrolling without the bar");
  h.unmount();
  assert.equal(rootStyle.scrollPaddingBottom, "", "cleared when the wizard leaves the page");
  assert.equal(resized.length, 0);
  assert.equal(focusListeners.length, 0);
});

// ---- P1-52 (LE 2026-11-06): the Showroom layout. Same steps and same submit; new panel, calendar, ticket and corners. ----

test("P1-52: step 1 shows a drawn outline for each size, inline, with the size's name and description", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await h.settle();
  assert.equal(h.all().filter((e) => e.type === VehicleDrawing).length, 2, "one drawing per size");
  const svg = renderToStaticMarkup(createElement(VehicleDrawing, { code: "S" }));
  assert.match(svg, /^<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(svg, /<img|<image/);
  h.unmount();
});

test("P1-52: the side panel counts four steps, marks the current one and lists what is chosen with a Change for each finished step", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toDay(h);
  const list = h.all().find((e) => e.type === "ol" && e.props["aria-label"] === "Progress steps")!;
  const items = (list.props.children as { props: Record<string, unknown> }[]).filter(Boolean);
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((li) => li.props["aria-current"]), [undefined, undefined, "step", undefined]);
  const sheet = textOf(list);
  assert.match(sheet, /Vehicle size/);
  assert.match(sheet, /Small · Compact \/ Sedan/);
  assert.match(sheet, /Basic Wash/);
  const changes = h.all().filter((e) => e.type === "button" && typeof e.props["aria-label"] === "string" && /^Change /.test(e.props["aria-label"] as string));
  assert.deepEqual(changes.map((b) => b.props["aria-label"]), ["Change vehicle size", "Change services"]);
  const bar = h.all().find((e) => e.props.role === "progressbar")!;
  assert.equal(bar.props["aria-valuenow"], 3);
  assert.equal(bar.props["aria-valuetext"], "Step 3 of 4: Day");
  h.unmount();
});

test("P1-52: the details step keeps ONE submit: the review sits under the fields, no fifth step, same submit button text", async () => {
  network();
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  assert.equal(h.all().filter((e) => e.type === "form").length, 1, "one form on the page");
  const submits = h.all().filter((e) => e.type === "button" && e.props.type === "submit");
  assert.ok(submits.length >= 1 && submits.every((b) => b.props.form === "booking-details" && /Submit booking request/.test(textOf(b.props.children))), "every submit button is the one submit");
  assert.doesNotMatch(h.text(), /Step 5|Step 4 of 5|of 5/);
  const form = h.all().find((e) => e.type === "form")!;
  const formText = textOf(form);
  assert.match(formText, /About you/);
  assert.match(formText, /Your vehicle/);
  assert.match(formText, /Check your booking/);
  assert.match(formText, /Look it over\. Send it when it is right\./);
  assert.ok(formText.indexOf("Your vehicle") < formText.indexOf("Check your booking"), "review after the fields");
  assert.ok(formText.indexOf("Check your booking") < formText.indexOf("Security check"), "security check after the review");
  assert.ok(h.all().some((e) => e.props["data-part"] === "review"));
  assert.match(formText, /Basic Wash/, "the review lists the services");
  for (const field of ["customerFirstName", "customerLastName"]) assert.ok(h.all().some((e) => e.props.id === field && e.props.name === field), field + " keeps its id and name");
  h.unmount();
});

test("P1-52: the day step shows a Monday-first month calendar: weekday heads, faded neighbours, Chosen on the picked day", () => {
  const days: PublicDay[] = Array.from({ length: 14 }, (_, i) => ({ date: "2026-11-" + String(6 + i).padStart(2, "0"), state: i === 2 ? "FULLY_BOOKED" : i === 5 ? "CLOSED" : "AVAILABLE" }));
  const m = renderToStaticMarkup(DayPicker({ data: { days, nextAvailableDay: "2026-11-06", onlineBookingStatus: "OPEN" }, error: "", onRetry: () => {}, selected: "2026-11-10", onSelect: () => {}, fromDate: "2026-11-06", onPage: () => {}, multiDay: false }) as never);
  const t = m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /Mon Tue Wed Thu Fri Sat Sun/);
  assert.equal([...m.matchAll(/name="booking-day"/g)].length, 14);
  assert.equal([...m.matchAll(/aria-hidden="true" class="flex min-h-\[64px\] items-center justify-center/g)].length, 7, "Nov 6 is a Friday: four faded days before; Nov 19 is a Thursday: three after");
  assert.match(t, /Chosen/);
  assert.match(t, /Fully booked/);
  assert.match(t, /Crossed-out days are fully booked or closed\./);
  assert.match(m, /aria-label="[^"]*November 10, 2026: Available"[^>]*checked/);
  for (const [, c] of m.matchAll(/class="([^"]*)"/g)) assert.doesNotMatch(c, /(^| )rounded( |$)/, "no 4 px corner: " + c);
});

test("P1-52: no 4 px corner is left in the booking wizard's own files (Manage booking corner family)", () => {
  for (const file of ["booking-wizard.tsx", "day-picker.tsx", "booking-ticket.tsx", "management-code.tsx", "payment-instructions.tsx", "vehicle-drawing.tsx"]) {
    const source = readFileSync("src/components/booking/" + file, "utf8");
    const plain = [...source.matchAll(/["'`{ ]rounded(?=[\s"'`}])/g)].map((m) => m.index);
    assert.deepEqual(plain, [], file + " has a plain `rounded` (4 px) class");
  }
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  assert.match(wizard, /rounded-xl/);
  assert.match(wizard, /rounded-2xl/);
  assert.match(wizard, /rounded-full/);
});

test("P1-52: the confirmation is the ticket, and Copy reference and Print receipt still work from it", async () => {
  const posts = network();
  const h = mountHooks(BookingWizard, {});
  await toDetails(h);
  for (const [field, value] of [["customerFirstName", "Test"], ["customerLastName", "Customer"], ["customerPhone", "0917 000 0000"], ["vehicleModel", "Toyota Vios"]])
    h.all().find((e) => e.props.id === field)!.props.onChange({ target: { value } });
  fire(h.child(TurnstileChallenge), "onToken", "token-1");
  await h.settle();
  h.all().find((e) => e.type === "form")!.props.onSubmit({ preventDefault() {} });
  await h.settle();
  assert.equal(posts.length, 1, "the submit flow is unchanged: one request");
  const ticket = h.child(BookingTicket)!;
  assert.equal((ticket.props.booking as { referenceCode: string }).referenceCode, "ZEUS-TEST01");
  let printed = 0;
  (g.window as Record<string, unknown>).print = () => printed++;
  fire(ticket, "onPrint");
  assert.equal(printed, 1);
  assert.equal(typeof ticket.props.onCopy, "function");
  assert.doesNotMatch(h.text(), /private\.code|private code/i, "the management code is still never shown");
  h.unmount();
});
