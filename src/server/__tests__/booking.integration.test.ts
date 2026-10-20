import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
let legacyRequest: ReturnType<typeof payload>;
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

  // Approved cutover fixture: a historical row, never a fresh slot-service write.
  const { CreateBookingSchema } = await import("@/lib/validation");
  const { legacyRequestHash } = await import("../bookings-hash");
  legacyRequest = payload(); const r = CreateBookingSchema.parse(legacyRequest);
  await db.booking.create({ data: { referenceCode: "ZEUS-HIST01", customerName:r.customerName, customerPhone:r.customerPhone, customerEmail:r.customerEmail??null, vehicleModel:r.vehicleModel, vehiclePlate:r.vehiclePlate??null, notes:r.specialRequests??null, vehicleCategoryId:categoryId, serviceId, bookingDate:carrier(r.bookingDate), startTime:"09:00", endTime:"11:00", startsAt:new Date(r.bookingDate+"T09:00:00+08:00"), endsAt:new Date(r.bookingDate+"T11:00:00+08:00"), durationMinutes:120, priceSnapshot:"2070", serviceNameSnapshot:"Two hour service", vehicleCategoryNameSnapshot:"Test Sedan", idempotencyKey:r.idempotencyKey, requestHash:legacyRequestHash(r) } });
  for(const [name,kid] of [["BOOKING_QUOTE","q"],["MANAGEMENT_GRANT","g"],["MANAGEMENT_SESSION","s"]]){process.env[name+"_KEYS"]=kid+":"+randomBytes(32).toString("base64url");process.env[name+"_ACTIVE_KID"]=kid;}
  Object.assign(process.env,{APP_ORIGIN:"http://localhost",ONLINE_BOOKING_MODE:"OPEN",TURNSTILE_SECRET_KEY:"1x0000000000000000000000000000000AA",NEXT_PUBLIC_TURNSTILE_SITE_KEY:"1x00000000000000000000AA",TURNSTILE_ALLOWED_HOSTNAMES:"localhost"});
});
after(async () => { await db.$disconnect(); });
async function reservation(input: unknown) {
  const feature = await import("../bookings").catch(() => null);
  assert.ok(feature, "Atomic booking service has not been implemented");
  return feature.reserveBooking(input, db);
}

test("fresh slot writes are retired; exact historical retries preserve normalized snapshots and conflicts", {skip:!enabled},async()=>{
 const refused=await reservation(payload());assert.equal(refused.ok,false);
 const replay=await reservation(legacyRequest);assert.ok(replay.ok);
 assert.equal(replay.data.totalPriceCentavos,207000);assert.equal(replay.data.customerPhone,"+639171234567");assert.equal(replay.data.vehiclePlate,"ABC 123");assert.equal(replay.data.customerEmail,null);assert.equal(replay.data.durationMinutes,120);assert.equal(replay.data.endTime,"11:00");assert.equal(replay.data.serviceName,"Two hour service");assert.equal(replay.data.status,"PENDING");
 const conflict=await reservation({...legacyRequest,customerName:"Different Person"});assert.equal(!conflict.ok&&conflict.error.code,"IDEMPOTENCY_CONFLICT");assert.equal(await db.booking.count(),1);
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
  const blocked = await reservation(payload(date)); assert.equal(!blocked.ok && blocked.error.code, "VALIDATION_ERROR");
  const atEnd = await reservation({ ...payload(date), startTime: "11:00" }); assert.equal(atEnd.ok,false);
 const {getAvailableSlots}=await import("../availability");
 const historical=await getAvailableSlots({date,vehicleCategoryId:categoryId,serviceId});
 assert.ok(historical.ok);assert.equal(historical.data.slots.find(s=>s.startTime==="09:00")?.selectable,false);assert.equal(historical.data.slots.find(s=>s.startTime==="11:00")?.selectable,true);
  const otherDate = businessDate(3);
  const slot = await db.timeSlot.findFirstOrThrow({ where: { dayOfWeek: 1, startTime: "10:30" } });
  await db.slotCapacityOverride.create({ data: { date: carrier(otherDate), timeSlotId: slot.id, maxVehicleCapacity: 0 } });
  const full = await reservation(payload(otherDate)); assert.equal(!full.ok&&full.error.code,"VALIDATION_ERROR");
 const overridden=await getAvailableSlots({date:otherDate,vehicleCategoryId:categoryId,serviceId});assert.ok(overridden.ok);assert.equal(overridden.data.slots.find(s=>s.startTime==="09:00")?.selectable,false);
});


test("HTTP availability rejects unknown/duplicate query keys and catalog DTOs contain real UUIDs only", { skip: !enabled }, async () => {
  const { NextRequest } = await import("next/server");
  const availabilityRoute = await import("../../app/api/availability/route");
  const catalogRoute = await import("../../app/api/catalog/route");
  const query = new URLSearchParams({ date: businessDate(), vehicleCategoryId: categoryId, serviceId: shortServiceId });
  const valid = await availabilityRoute.GET(new NextRequest("http://localhost/api/availability?" + query));
  assert.equal(valid.status, 400); assert.equal(valid.headers.get("cache-control"), "no-store");
  const publicBody = await valid.json(); assert.equal(publicBody.ok, false); assert.equal(JSON.stringify(publicBody).includes("Test Customer"), false);
  for (const suffix of ["&date=2026-10-19", "&price=1"]) {
    const rejected = await availabilityRoute.GET(new NextRequest("http://localhost/api/availability?" + query + suffix));
    assert.equal(rejected.status, 400);
  }
  // ADR-004 (P1-02): the catalog route serves only a published release, never these release-1
  // multiplier rows; this database has none, so it fails closed. The published-release DTO
  // (real UUIDs, exact allowlist) is covered by src/server/catalog.integration.test.ts.
  const catalogResponse = await catalogRoute.GET(new NextRequest("http://localhost/api/catalog"));
  assert.equal(catalogResponse.status, 503);
  const catalogText = await catalogResponse.text();
  const catalog = JSON.parse(catalogText); assert.equal(catalog.ok, false); assert.equal(catalog.error.code, "RETRYABLE_ERROR");
  for (const leaked of [categoryId, serviceId, shortServiceId, "sizeMultiplier", "bayCapacityRequired", "customerPhone"]) assert.equal(catalogText.includes(leaked), false, leaked);
});
test("HTTP cutover refuses fresh slots, replays committed history and rejects malformed or oversized bodies", { skip: !enabled }, async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../../app/api/bookings/route");
  const request = (body: string) => new NextRequest("http://localhost/api/bookings", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "test-adapter",origin:"http://localhost","x-zeus-booking":"1" }, body });
  const input = payload(businessDate(4));
  const created = await POST(request(JSON.stringify(input))); assert.equal(created.status, 400);
  const body = await created.json(); assert.equal(body.ok, false);
  const replay = await POST(request(JSON.stringify(legacyRequest))); assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.referenceCode,"ZEUS-HIST01");
  assert.equal((await POST(request("{broken"))).status, 400);
  assert.equal((await POST(request(JSON.stringify({ ...input, specialRequests: "x".repeat(17000) })))).status, 400);
});
