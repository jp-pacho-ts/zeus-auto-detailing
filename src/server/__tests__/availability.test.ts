import assert from "node:assert/strict";
import test from "node:test";

const date = "2026-10-19";
const instant = (time: string) => new Date(date + "T" + time + ":00+08:00");
function fixture() {
  return {
    request: { date, vehicleCategoryId: "11111111-1111-4111-8111-111111111111", serviceId: "22222222-2222-4222-8222-222222222222" },
    now: new Date("2026-10-16T00:00:00Z"),
    config: { openTime: "08:00", closeTime: "17:00", defaultSlotIntervalMinutes: 30 },
    durationMinutes: 120,
    totalPriceCentavos: 180000,
    templates: Array.from({ length: 18 }, (_, i) => ({
      id: "slot-" + i, dayOfWeek: 1, isActive: true, maxVehicleCapacity: 2,
      startTime: String(8 + Math.floor(i / 2)).padStart(2, "0") + ":" + (i % 2 ? "30" : "00"),
      endTime: String(8 + Math.floor((i + 1) / 2)).padStart(2, "0") + ":" + ((i + 1) % 2 ? "30" : "00"),
    })),
    overrides: [] as { timeSlotId: string; maxVehicleCapacity: number }[],
    blocks: [] as { isFullDay: boolean; startTime: string | null; endTime: string | null; reason: string }[],
    bookings: [] as { startsAt: Date; endsAt: Date; status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" }[],
  };
}
async function engine(input: ReturnType<typeof fixture>) {
  const feature = await import("../availability-core").catch(() => null);
  assert.ok(feature, "Duration-aware availability has not been implemented");
  return feature.calculateAvailability(input);
}

test("a two-hour reservation consumes all four half-hour intervals and releases exactly at its endpoint", async () => {
  const input = fixture();
  input.durationMinutes = 30;
  input.bookings.push({ startsAt: instant("09:00"), endsAt: instant("11:00"), status: "PENDING" });
  const data = await engine(input);
  assert.deepEqual(data.slots.filter(s => s.startTime >= "09:00" && s.startTime < "11:00").map(s => s.remainingCapacity), [1, 1, 1, 1]);
  assert.equal(data.slots.find(s => s.startTime === "11:00")?.remainingCapacity, 2);
});
test("a later bottleneck makes the full-duration candidate sold out", async () => {
  const input = fixture();
  input.bookings.push({ startsAt: instant("10:00"), endsAt: instant("11:00"), status: "CONFIRMED" }, { startsAt: instant("10:30"), endsAt: instant("11:00"), status: "COMPLETED" });
  const slot = (await engine(input)).slots.find(s => s.startTime === "09:00");
  assert.equal(slot?.state, "SOLD_OUT");
  assert.equal(slot?.remainingCapacity, 0);
});
test("a partial final interval is reserved without rounding the service end", async () => {
  const input = fixture(); input.durationMinutes = 45;
  input.overrides.push({ timeSlotId: "slot-3", maxVehicleCapacity: 0 });
  const slot = (await engine(input)).slots.find(s => s.startTime === "09:00");
  assert.equal(slot?.endTime, "09:45"); assert.equal(slot?.state, "SOLD_OUT");
});
test("cancelled reservations release capacity while completed reservations retain it", async () => {
  const input = fixture(); input.durationMinutes = 30;
  input.bookings.push({ startsAt: instant("09:00"), endsAt: instant("10:00"), status: "CANCELLED" }, { startsAt: instant("09:00"), endsAt: instant("10:00"), status: "COMPLETED" });
  assert.equal((await engine(input)).slots.find(s => s.startTime === "09:00")?.remainingCapacity, 1);
});
test("full-day holidays close the day and partial closures honor half-open boundaries", async () => {
  const input = fixture(); input.durationMinutes = 90;
  input.blocks.push({ isFullDay: false, startTime: "12:00", endTime: "13:00", reason: "Maintenance" });
  const data = await engine(input);
  assert.equal(data.slots.find(s => s.startTime === "11:30")?.state, "BLOCKED");
  assert.equal(data.slots.find(s => s.startTime === "13:00")?.selectable, true);
  input.blocks[0] = { isFullDay: true, startTime: null, endTime: null, reason: "Holiday" };
  assert.deepEqual((await engine(input)).slots, []);
});
test("services must finish within opening hours", async () => {
  const input = fixture(); input.durationMinutes = 90;
  assert.equal((await engine(input)).slots.find(s => s.startTime === "16:00")?.state, "OUTSIDE_HOURS");
});
test("malformed interval coverage and negative remaining capacity fail closed", async () => {
  const input = fixture(); input.templates.splice(3, 1);
  await assert.rejects(() => engine(input), /schedule/i);
  const crowded = fixture(); crowded.templates.forEach(s => { s.maxVehicleCapacity = 0; });
  crowded.bookings.push({ startsAt: instant("09:00"), endsAt: instant("10:00"), status: "PENDING" });
  await assert.rejects(() => engine(crowded), /capacity|schedule/i);
});
test("today and the 90-day horizon use Manila dates rather than the host timezone", async () => {
  const input = fixture(); input.now = new Date("2026-10-18T16:00:00Z");
  assert.equal((await engine(input)).date, "2026-10-19");
  input.request.date = "2027-01-18";
  await assert.rejects(() => engine(input), /90|horizon/i);
});
test("past starts are not selectable and weekdays without templates are closed", async () => {
  const input = fixture(); input.now = new Date("2026-10-19T01:00:00Z");
  assert.equal((await engine(input)).slots.find(s => s.startTime === "09:00")?.state, "PAST");
  input.request.date = "2026-10-25";
  assert.equal((await engine(input)).dayState, "CLOSED");
});
