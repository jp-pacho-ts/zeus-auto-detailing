// P1-05 second pass + P1-18 customer UI: what the confirmation and private booking screens render.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import type { ManagedDayBookingView } from "@/types/contracts";
import { ManagementCode } from "./management-code";
import { PaymentInstructions } from "./payment-instructions";
import { ManagedBookingDetails } from "./managed-booking-details";
import { DepositProofSection } from "./deposit-proof";
import { DayPicker } from "./day-picker";
import { ManageBooking } from "./manage-booking-page";

const TOKEN = "eyJ2IjoxLCJraWQiOiJnIiwicHVycG9zZSI6IkJPT0tJTkdfTUFOQUdFTUVOVCJ9.c2lnbmF0dXJlLWJ5dGVzLWZvci10aGUtdGVzdC1vbmx5";
const html = <P extends object>(type: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(type, props));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const hrefs = (markup: string) => [...markup.matchAll(/(?:href|src|action)="([^"]*)"/g)].map((m) => m[1]);
const view = (o: Partial<ManagedDayBookingView> = {}): ManagedDayBookingView => ({
  id: "0c6a3b5e-6d1f-4c2a-9e1b-3f5d7a9c1e2b",
  referenceCode: "ZEUS-TEST01",
  status: "PENDING",
  revision: 1,
  bookingDate: "2026-11-03",
  timezone: "Asia/Manila",
  vehicleCategoryId: "11111111-1111-4111-8111-111111111111",
  vehicleCategoryName: "Small · Compact / Sedan",
  lines: [
    { serviceId: "22222222-2222-4222-8222-222222222222", name: "Basic Wash", quantity: 1, priceStatus: "PRICED", subtotalCentavos: 18000, referenceSubtotalCentavos: null },
    { serviceId: "33333333-3333-4333-8333-333333333333", name: "Regular Tint", quantity: 1, priceStatus: "FOR_QUOTE", subtotalCentavos: null, referenceSubtotalCentavos: 250000 },
  ],
  totalPriceCentavos: 18000,
  estimatedTotalCentavos: 268000,
  currency: "PHP",
  selfServiceAllowed: true,
  selfServiceCutoff: "2026-11-02T10:00:00.000Z",
  deposit: { status: "NONE", proofsSent: 0, proofsAllowed: 3, message: null },
  ...o,
});
const noop = () => {};

test("confirmation: the management code is shown with Copy, Download and Print and a save-it warning", () => {
  const markup = html(ManagementCode, { referenceCode: "ZEUS-TEST01", bookingDate: "2026-11-03", access: { accessToken: TOKEN, expiresAt: "2026-11-04T16:00:00.000Z" } });
  const t = text(markup);
  assert.ok(t.includes(TOKEN), "the code itself is visible");
  assert.match(t, /Save this code\. You need it to change or cancel your booking\./);
  assert.match(t, /Copy code/);
  assert.match(t, /Download code/);
  assert.match(t, /Print code/);
  assert.match(t, /Open my booking page/);
  // The code never appears in a link, image or form target, and the page link has no parameters.
  for (const h of hrefs(markup)) assert.ok(!h.includes(TOKEN) && !/[?#]/.test(h), h);
  assert.ok(hrefs(markup).includes("/book/manage"));
});

test("confirmation without a code says to contact the shop instead", () => {
  const t = text(html(ManagementCode, { referenceCode: "ZEUS-TEST01", bookingDate: "2026-11-03", access: null }));
  assert.match(t, /contact the shop/);
  assert.doesNotMatch(t, /Copy code|Download code/);
});

test("payment instructions: both accounts from brand.ts with their QR copies; optional; no amounts", () => {
  assert.equal(brandConfig.payment.accounts.length, 2);
  const markup = html(PaymentInstructions, {});
  const t = text(markup);
  for (const a of brandConfig.payment.accounts) {
    assert.ok(t.includes(a.provider), a.provider);
    assert.ok(t.includes(a.accountName), "account name");
    assert.ok(t.includes(a.number), "account number from brand.ts");
    assert.ok(markup.includes(`src="${a.qrImage}"`), "QR image");
    assert.match(a.qrImage, /^\/images\/payment\/[a-z]+-qr\.png$/);
    // Boolean checks with fixed messages: a failure never prints an account number.
    assert.ok(/^\d+$/.test(a.number), "the account number is digits only");
  }
  assert.match(t, /optional/i);
  assert.match(t, /pay at the shop/i);
  assert.doesNotMatch(t, /₱|PHP\s?\d/);
});

test("the served QR copies are about 600 px wide and small; the originals are not in public/", () => {
  const dir = path.join(process.cwd(), "public", "images", "payment");
  for (const a of brandConfig.payment.accounts) {
    const file = path.join(process.cwd(), "public", a.qrImage);
    const b = fs.readFileSync(file);
    assert.equal(b.readUInt32BE(0), 0x89504e47, "PNG");
    const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
    assert.ok(width >= 560 && width <= 640, "width " + width);
    assert.ok(height >= 560 && height <= 640, "height " + height);
    assert.ok(b.length < 512 * 1024, "size " + b.length);
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), brandConfig.payment.accounts.map((a) => path.basename(a.qrImage)).sort());
});

test("booking page shows status, day, services and total only; no bay, worker, position or line progress", () => {
  // Canary fields a careless server change might add: the page must not render them.
  const leaky = { ...view(), bay: "BAY CANARY", workers: ["WORKER CANARY"], queuePosition: 987, notes: "NOTE CANARY", lines: view().lines.map((l) => ({ ...l, workStatus: "PROGRESS CANARY" })) };
  const t = text(html(ManagedBookingDetails, { view: leaky, multiDay: false, busy: false, onCancel: noop, onChangeDay: noop }));
  assert.match(t, /ZEUS-TEST01/);
  assert.match(t, /Waiting for the shop to confirm/);
  assert.match(t, /Basic Wash/);
  assert.match(t, /Regular Tint/);
  assert.match(t, /Estimated total/);
  assert.match(t, /Cancel booking/);
  assert.match(t, /Change day/);
  for (const canary of ["BAY CANARY", "WORKER CANARY", "987", "NOTE CANARY", "PROGRESS CANARY"]) assert.ok(!t.includes(canary), canary);
  assert.doesNotMatch(t, /\bbay\b|worker|position|queue length/i);
});

test("booking page: no self-service sends the customer to the shop, with no cancel or change buttons", () => {
  const t = text(html(ManagedBookingDetails, { view: view({ status: "IN_PROGRESS", selfServiceAllowed: false }), multiDay: false, busy: false, onCancel: noop, onChangeDay: noop }));
  assert.match(t, /In progress at the shop/);
  assert.match(t, /To change or cancel this booking, please contact the shop\./);
  assert.ok(t.includes(brandConfig.displayPhone));
  assert.doesNotMatch(t, /Cancel booking|Change day/);
});

test("booking page: a multi-day job's day reads as the drop-off day", () => {
  const t = text(html(ManagedBookingDetails, { view: view(), multiDay: true, busy: false, onCancel: noop, onChangeDay: noop }));
  assert.match(t, /Drop-off day/);
});

test("deposit section: status in customer words, the count, and a JPEG/PNG/WebP picker", () => {
  const markup = html(DepositProofSection, { view: view(), onUpdated: noop, onSignedOut: noop });
  const t = text(markup);
  assert.match(t, /Send deposit screenshot/);
  assert.match(t, /No deposit screenshot sent\./);
  assert.match(t, /0 of 3 screenshots sent/);
  assert.match(markup, /type="file"/);
  assert.match(markup, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(t, /JPEG, PNG or WebP, up to 5 MB/);
  assert.match(t, /optional/i);
});

test("deposit section: rejected shows only 'Please contact the shop.'; received and full hide the picker", () => {
  const rejected = text(html(DepositProofSection, { view: view({ deposit: { status: "REJECTED", proofsSent: 1, proofsAllowed: 3, message: "Please contact the shop." } }), onUpdated: noop, onSignedOut: noop }));
  assert.match(rejected, /Please contact the shop\./);
  const received = html(DepositProofSection, { view: view({ deposit: { status: "RECEIVED", proofsSent: 1, proofsAllowed: 3, message: null } }), onUpdated: noop, onSignedOut: noop });
  assert.match(text(received), /Deposit received\./);
  assert.doesNotMatch(received, /type="file"/);
  const full = html(DepositProofSection, { view: view({ deposit: { status: "PROOF_SENT", proofsSent: 3, proofsAllowed: 3, message: null } }), onUpdated: noop, onSignedOut: noop });
  assert.doesNotMatch(full, /type="file"/);
  assert.match(text(full), /3 of 3 screenshots sent/);
  const cancelled = html(DepositProofSection, { view: view({ status: "CANCELLED", selfServiceAllowed: false }), onUpdated: noop, onSignedOut: noop });
  assert.doesNotMatch(cancelled, /type="file"/);
});

test("day picker: available days can be chosen; full, closed and the current day cannot", () => {
  const markup = html(DayPicker, {
    data: { days: [
      { date: "2026-11-03", state: "AVAILABLE" },
      { date: "2026-11-04", state: "AVAILABLE" },
      { date: "2026-11-05", state: "FULLY_BOOKED" },
      { date: "2026-11-06", state: "CLOSED" },
    ], nextAvailableDay: "2026-11-04", onlineBookingStatus: "OPEN" },
    error: "", onRetry: noop, selected: "2026-11-04", onSelect: noop, fromDate: "2026-11-03", onPage: noop,
    multiDay: false, currentDay: "2026-11-03",
  });
  const radios = [...markup.matchAll(/<input[^>]*name="booking-day"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 4);
  assert.match(radios[0], /disabled/);
  assert.doesNotMatch(radios[1], /disabled/);
  assert.match(radios[1], /checked/);
  assert.match(radios[2], /disabled/);
  assert.match(radios[3], /disabled/);
  const t = text(markup);
  assert.match(t, /Your current day/);
  assert.match(t, /Fully booked/);
  assert.match(t, /Closed/);
});

test("the private booking page opens on loading, never from URL parameters", () => {
  const t = text(html(ManageBooking, {}));
  assert.match(t, /Opening your booking/);
});

// Privacy guards over the customer screens' source (ADR-002): no browser storage, no code or
// booking data in URLs.
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = [...files(path.join(process.cwd(), "src/components/booking")), ...files(path.join(process.cwd(), "src/app/book"))]
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));

test("customer booking screens never use browser storage", () => {
  for (const f of sources) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /localStorage|sessionStorage|indexedDB|document\.cookie/, f);
});

test("management calls are parameter-free and the manage page reads no URL parameters", () => {
  for (const f of sources) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /\/api\/bookings\/manage[\w/-]*\?/, f);
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/book/manage/page.tsx"), "utf8");
  assert.doesNotMatch(page, /searchParams|params/);
  for (const f of sources) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /router\.(push|replace)\([^)]*(accessToken|code)/i, f);
});
