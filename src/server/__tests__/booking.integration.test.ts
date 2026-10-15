import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";

const url = process.env.T007_TEST_DATABASE_URL;
const enabled = Boolean(url);
if (url) {
  assert.equal(process.env.DATABASE_URL, url, "DATABASE_URL must equal the isolated T007_TEST_DATABASE_URL");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.pathname.startsWith("/zeus_t007_"), "Use only an isolated local T-007 test database");
}
const db = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const categoryId = randomUUID(), serviceId = randomUUID(), shortServiceId = randomUUID();
function businessDate(weeks = 0) {
  const day = new Date(Date.now() + 8 * 3600000);
  day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCDate(day.getUTCDate() + weeks * 7);
  return day.toISOString().slice(0, 10);
}
const carrier = (date: string) => new Date(date + "T00:00:00Z");
const payload = (date = businessDate()) => ({ idempotencyKey: randomUUID(), vehicleCategoryId: categoryId, serviceId, bookingDate: date, startTime: "09:00", customerName: "  Test Customer  ", customerPhone: "0917 123 4567", customerEmail: " ", vehicleModel: "Test Vehicle", vehiclePlate: " abc 123 ", specialRequests: " Test notes " });

before(async () => {
  if (!enabled) return;
  const counts = await Promise.all([db.vehicleCategory.count(), db.service.count(), db.scheduleConfig.count(), db.timeSlot.count(), db.booking.count(), db.blockedDate.count(), db.slotCapacityOverride.count()]);
  assert.ok(counts.every(count => count === 0), "Use a fresh empty test database; existing data will not be changed");
  await db.vehicleCategory.create({ data: { id: categoryId, slug: "SEDAN", name: "Test Sedan", sizeMultiplier: "1.15", sortOrder: 0 } });
  await db.service.createMany({ data: [
    { id: serviceId, slug: "test-two-hours", name: "Two hour service", category: "INTERIOR_DETAILING", durationMinutes: 120, price: "1800.00" },
    { id: shortServiceId, slug: "test-half-hour", name: "Half hour service", category: "EXTERIOR_WASH_SEAL", durationMinutes: 30, price: "100.00" },
  ] });
  await db.scheduleConfig.create({ data: { effectiveDate: carrier("2000-01-01") } });
  await db.timeSlot.createMany({ data: Array.from({ length: 6 }, (_, day) => Array.from({ length: 18 }, (_, i) => ({ dayOfWeek: day + 1, startTime: String(8 + Math.floor(i / 2)).padStart(2, "0") + ":" + (i % 2 ? "30" : "00"), endTime: String(8 + Math.floor((i + 1) / 2)).padStart(2, "0") + ":" + ((i + 1) % 2 ? "30" : "00"), maxVehicleCapacity: 1 }))).flat() });
});
after(async () => { await db.$disconnect(); });
async function reservation(input: unknown) {
  const feature = await import("../bookings").catch(() => null);
  assert.ok(feature, "Atomic booking service has not been implemented");
  return feature.reserveBooking(input, db);
}

test("simultaneous last-bay requests commit one PENDING reservation and persist normalized snapshots", { skip: !enabled }, async () => {
  const a = payload(), b = payload();
  const results = await Promise.all([reservation(a), reservation(b)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  const rejected = results.find(r => !r.ok); assert.equal(rejected && !rejected.ok && rejected.error.code, "SLOT_UNAVAILABLE");
  const rows = await db.booking.findMany({ where: { bookingDate: carrier(a.bookingDate) } });
  assert.equal(rows.length, 1); const row = rows[0];
  assert.equal(row.status, "PENDING"); assert.equal(row.customerPhone, "+639171234567");
  assert.equal(row.vehiclePlate, "ABC 123"); assert.equal(row.customerEmail, null);
  assert.equal(row.priceSnapshot.toString(), "2070"); assert.equal(row.serviceNameSnapshot, "Two hour service");
  assert.equal(row.durationMinutes, 120); assert.equal(row.endsAt.toISOString().slice(11, 16), "03:00");
  assert.match(row.referenceCode, /^ZEUS-[A-Z0-9]{6}$/);
  const original = row.idempotencyKey === a.idempotencyKey ? a : b;
  const replay = await reservation(original); assert.ok(replay.ok); assert.equal(replay.data.id, row.id);
  const conflict = await reservation({ ...original, customerName: "Different Person" });
  assert.equal(!conflict.ok && conflict.error.code, "IDEMPOTENCY_CONFLICT");
});
test("database-backed duration reservations consume four intervals and preserve the exact endpoint", { skip: !enabled }, async () => {
  const feature = await import("../availability");
  const result = await feature.getAvailableSlots({ date: businessDate(), vehicleCategoryId: categoryId, serviceId: shortServiceId });
  assert.ok(result.ok);
  assert.deepEqual(result.data.slots.filter(s => ["09:00", "09:30", "10:00", "10:30"].includes(s.startTime)).map(s => s.remainingCapacity), [0, 0, 0, 0]);
  assert.equal(result.data.slots.find(s => s.startTime === "11:00")?.remainingCapacity, 1);
});
test("strict validation and contextual rejection never create a booking", { skip: !enabled }, async () => {
  const input = payload(businessDate(1));
  for (const invalid of [{ ...input, price: 1 }, { ...input, customerName: "A\nB" }, { ...input, startTime: "09:15" }, { ...input, startTime: "16:00" }, { ...input, vehicleCategoryId: randomUUID() }]) {
    const result = await reservation(invalid); assert.equal(result.ok, false);
  }
  assert.equal(await db.booking.count({ where: { bookingDate: carrier(input.bookingDate) } }), 0);
});
test("partial blocks and date overrides are authoritative inside reservation transactions", { skip: !enabled }, async () => {
  const date = businessDate(2);
  await db.blockedDate.create({ data: { date: carrier(date), isFullDay: false, startTime: "10:00", endTime: "11:00", reason: "Maintenance" } });
  const blocked = await reservation(payload(date)); assert.equal(!blocked.ok && blocked.error.code, "SLOT_UNAVAILABLE");
  const atEnd = await reservation({ ...payload(date), startTime: "11:00" }); assert.equal(atEnd.ok, true);
  const otherDate = businessDate(3);
  const slot = await db.timeSlot.findFirstOrThrow({ where: { dayOfWeek: 1, startTime: "10:30" } });
  await db.slotCapacityOverride.create({ data: { date: carrier(otherDate), timeSlotId: slot.id, maxVehicleCapacity: 0 } });
  const full = await reservation(payload(otherDate)); assert.equal(!full.ok && full.error.code, "SLOT_UNAVAILABLE");
});


test("HTTP availability rejects unknown/duplicate query keys and catalog DTOs contain real UUIDs only", { skip: !enabled }, async () => {
  const { NextRequest } = await import("next/server");
  const availabilityRoute = await import("../../app/api/availability/route");
  const catalogRoute = await import("../../app/api/catalog/route");
  const query = new URLSearchParams({ date: businessDate(), vehicleCategoryId: categoryId, serviceId: shortServiceId });
  const valid = await availabilityRoute.GET(new NextRequest("http://localhost/api/availability?" + query));
  assert.equal(valid.status, 200); assert.equal(valid.headers.get("cache-control"), "no-store");
  const publicBody = await valid.json(); assert.equal(publicBody.ok, true); assert.equal(JSON.stringify(publicBody).includes("Test Customer"), false);
  for (const suffix of ["&date=2026-10-19", "&price=1"]) {
    const rejected = await availabilityRoute.GET(new NextRequest("http://localhost/api/availability?" + query + suffix));
    assert.equal(rejected.status, 400);
  }
  const catalogResponse = await catalogRoute.GET(new NextRequest("http://localhost/api/catalog"));
  const catalog = await catalogResponse.json(); assert.equal(catalog.ok, true);
  assert.equal(catalog.data.vehicleCategories[0].id, categoryId);
  assert.ok(catalog.data.services.some((s: { id: string }) => s.id === serviceId));
  assert.equal(JSON.stringify(catalog).includes("customerPhone"), false);
});
test("HTTP booking adapter persists once, returns 201/200 for create/replay and rejects malformed or oversized bodies", { skip: !enabled }, async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../../app/api/bookings/route");
  const request = (body: string) => new NextRequest("http://localhost/api/bookings", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "test-adapter" }, body });
  const input = payload(businessDate(4));
  const created = await POST(request(JSON.stringify(input))); assert.equal(created.status, 201);
  const body = await created.json(); assert.equal(body.ok, true);
  const replay = await POST(request(JSON.stringify(input))); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.id, body.data.id);
  assert.equal((await POST(request("{broken"))).status, 400);
  assert.equal((await POST(request(JSON.stringify({ ...input, specialRequests: "x".repeat(17000) })))).status, 400);
});
