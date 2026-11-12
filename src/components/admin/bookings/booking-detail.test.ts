/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const detail = (vehicleModel: string, vehiclePlate: string | null) => ({
  id: "booking",
  referenceCode: "ZEUS-PLATE1",
  snapshot: "QUEUE_V3",
  status: "PENDING",
  revision: 2,
  bookingDate: "2026-10-21",
  queueCode: "WASH",
  queuePosition: 1,
  customerName: "Synthetic Customer",
  customerPhone: "+639000000001",
  customerEmail: null,
  notes: null,
  vehicleModel,
  vehiclePlate,
  sizeCode: "S",
  serviceName: "Basic Wash",
  bay: null,
  lines: [],
  totals: { receiptTotalCentavos: 18000, receiptEstimatedCentavos: 18000, currentTotalCentavos: 18000, currentEstimateCentavos: 18000, forQuoteCount: 0 },
  assignedWorkers: [],
  occupancy: null,
  cancellationKind: null,
  bays: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  history: [],
  depositStatus: "NONE",
  depositProofs: [],
});

// The car line of the rendered dialog, as plain text.
function carLine(vehicleModel: string, vehiclePlate: string | null) {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bookings/booking" ? detail(vehicleModel, vehiclePlate) : null,
    loading: false,
    error: null,
    reload: () => {},
    setData: () => {},
  }));
  try {
    const html = renderToStaticMarkup(
      createElement(require("./booking-detail").BookingDetail, { id: "booking", role: "STAFF", queues: [], onChanged: () => {}, onClose: () => {} }),
    );
    const text = html.replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim());
    return text.find((s) => s.startsWith(vehicleModel + " ·")) ?? null;
  } finally {
    mock.restoreAll();
  }
}

test("detail shows the car model and plate once, then the size", () => {
  assert.equal(carLine("Toyota Vios", "QA 101"), "Toyota Vios · QA 101 · S");
});

test("detail shows 'No plate' for a blank plate", () => {
  assert.equal(carLine("Honda City", null), "Honda City · No plate · S");
  assert.equal(carLine("Honda City", "  "), "Honda City · No plate · S");
});

// P1-68: while services are open, Mark done stays in view, disabled, with the reason; when all are done it is live.
test("Mark done: disabled with the open-service count, then enabled once every service is done", () => {
  const resources = require("./use-admin-resource");
  const line = (id: string, workStatus: string, removed = false) => ({
    id, order: 1, serviceId: "s-" + id, name: "Service " + id, kind: "BASE", unit: "VEHICLE", quantity: 1, priceStatus: "PRICED",
    unitPriceCentavos: 100, subtotalCentavos: 100, referenceSubtotalCentavos: 100, staffPriceCentavos: null, effectivePriceCentavos: 100, workStatus, removed,
  });
  const render = (lines: unknown[]) => {
    mock.method(resources, "useAdminResource", (url: string | null) => ({
      data: url === "/api/admin/bookings/booking" ? { ...detail("Toyota Vios", "QA 101"), status: "IN_PROGRESS", lines } : null,
      loading: false, error: null, reload: () => {}, setData: () => {},
    }));
    try {
      return renderToStaticMarkup(
        createElement(require("./booking-detail").BookingDetail, { id: "booking", role: "ADMIN", queues: [], onChanged: () => {}, onClose: () => {} }),
      );
    } finally {
      mock.restoreAll();
    }
  };
  const open = render([line("a", "DONE"), line("b", "WAITING"), line("c", "IN_PROGRESS"), line("d", "WAITING", true)]);
  assert.match(open, /2 services still open/, "removed services do not count");
  assert.match(open, /<button[^>]*disabled=""[^>]*>Mark done/);
  const ready = render([line("a", "DONE"), line("b", "DONE")]);
  assert.doesNotMatch(ready, /still open/);
  assert.match(ready, />Mark done</);
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>Mark done/);
});

// P1-18: staff see the proofs through the staff route; only ADMIN gets the decision buttons.
function depositHtml(role: "ADMIN" | "STAFF", depositStatus: string, proofs: number) {
  const resources = require("./use-admin-resource");
  const data = {
    ...detail("Toyota Vios", "QA 101"),
    depositStatus,
    depositProofs: Array.from({ length: proofs }, (_, i) => ({
      id: "proof-" + i, createdAt: "2026-10-21T01:00:00.000Z", contentType: "image/png", byteSize: 100, width: 20, height: 10,
    })),
  };
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bookings/booking" ? data : null, loading: false, error: null, reload: () => {}, setData: () => {},
  }));
  try {
    return renderToStaticMarkup(
      createElement(require("./booking-detail").BookingDetail, { id: "booking", role, queues: [], onChanged: () => {}, onClose: () => {} }),
    );
  } finally {
    mock.restoreAll();
  }
}

test("deposit section: proofs load from the staff route; ADMIN alone gets the decision buttons", () => {
  const admin = depositHtml("ADMIN", "PROOF_SENT", 2);
  assert.match(admin, /Deposit proof to check/);
  assert.equal((admin.match(/src="\/api\/admin\/bookings\/booking\/deposit-proofs\/proof-\d"/g) ?? []).length, 2);
  assert.match(admin, />Mark deposit received</);
  assert.match(admin, />Mark deposit rejected</);
  const staff = depositHtml("STAFF", "PROOF_SENT", 1);
  assert.match(staff, /deposit-proofs\/proof-0/);
  assert.doesNotMatch(staff, /Mark deposit/);
  const none = depositHtml("ADMIN", "NONE", 0);
  assert.match(none, /The customer has not sent a deposit screenshot\./);
  assert.match(none, /<button[^>]*disabled=""[^>]*>Mark deposit rejected/, "nothing to reject without a proof");
  // Review F2: the proof count decides, not the status (RECEIVED can be paid at the shop).
  const paidAtShop = depositHtml("ADMIN", "RECEIVED", 0);
  assert.match(paidAtShop, /<button[^>]*disabled=""[^>]*>Mark deposit rejected/, "RECEIVED without a proof: still nothing to reject");
  assert.doesNotMatch(depositHtml("ADMIN", "RECEIVED", 1), /<button[^>]*disabled=""[^>]*>Mark deposit rejected/);
});

test("board badge: nothing for NONE; a label for each decision state", () => {
  const { DepositBadge } = require("./deposit-badge");
  const badge = (status: string) => renderToStaticMarkup(createElement(DepositBadge, { status }));
  assert.equal(badge("NONE"), "");
  assert.match(badge("PROOF_SENT"), />Deposit proof to check</);
  assert.match(badge("RECEIVED"), />Deposit received</);
  assert.match(badge("REJECTED"), />Deposit rejected</);
});

// P1-05 second pass (small fix): a customer entry has no staff actor; its history line must not
// end in a dangling separator, and says who acted.
test("history: customer entries read 'Customer' with no trailing separator", () => {
  const resources = require("./use-admin-resource");
  const entry = (id: string, source: string, action: string, actorName: string | null, reason: string | null) => ({
    id, source, action, actorStaffId: null, actorName, createdAt: "2026-10-21T01:00:00.000Z", fromRevision: 1, toRevision: 2, lineId: null, details: {}, reason,
  });
  const data = {
    ...detail("Toyota Vios", "QA 101"),
    history: [
      entry("h1", "CUSTOMER", "CUSTOMER_CANCELLED", null, null),
      entry("h2", "STAFF", "STATUS_CHANGED", "Synthetic Admin", "called ahead"),
      entry("h3", "STAFF", "STATUS_CHANGED", "Synthetic Admin", null),
    ],
  };
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url === "/api/admin/bookings/booking" ? data : null, loading: false, error: null, reload: () => {}, setData: () => {},
  }));
  try {
    const html = renderToStaticMarkup(
      createElement(require("./booking-detail").BookingDetail, { id: "booking", role: "ADMIN", queues: [], onChanged: () => {}, onClose: () => {} }),
    );
    // P1-68: history is a timeline (section "History"); each entry reads action, then who and when, then the reason.
    const section = html.match(/<section aria-label="History"[\s\S]*?<\/section>/)?.[0] ?? "";
    const items = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      m[1].replace(/<!-- -->/g, "").split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean),
    );
    // Readable time (Manila) and plain-word actions, no raw codes.
    const when = new Date("2026-10-21T01:00:00.000Z").toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
    assert.deepEqual(items, [
      ["Customer cancelled", `Customer · ${when}`],
      ["Status changed", `Synthetic Admin · ${when}`, "called ahead"],
      ["Status changed", `Synthetic Admin · ${when}`],
    ]);
    assert.doesNotMatch(html, /STATUS_CHANGED|CUSTOMER_CANCELLED|Revision \d/);
  } finally {
    mock.restoreAll();
  }
});
