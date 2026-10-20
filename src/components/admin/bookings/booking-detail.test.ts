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
