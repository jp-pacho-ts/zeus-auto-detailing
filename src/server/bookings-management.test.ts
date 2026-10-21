import assert from "node:assert/strict";
import { test } from "node:test";
import { createLoginLimiter } from "./auth/rate-limit";
import { randomUUID } from "node:crypto";
import {
  CancelManagedBookingSchema,
  RescheduleManagedBookingSchema,
  RecoverBookingOperationSchema,
  ExchangeManagementAccessSchema,
  ManagedDayAvailabilitySchema,
} from "@/lib/validation";
import {
  customerCutoff,
  beforeCustomerCutoff,
  recoveryAuthority,
  MANAGEMENT_ADMISSION_POLICIES,
} from "./bookings-management-policy";

test("management day schemas normalize private keys and reject reference/phone, slots and price/queue overrides", () => {
  const base = {
    bookingId: randomUUID(),
    idempotencyKey: randomUUID().toUpperCase(),
    expectedRevision: 1,
  };
  assert.equal(
    CancelManagedBookingSchema.parse(base).idempotencyKey,
    base.idempotencyKey.toLowerCase(),
  );
  for (const field of [
    "referenceCode",
    "customerPhone",
    "queueCode",
    "serviceId",
    "price",
    "status",
    "startTime",
  ])
    assert.equal(
      RescheduleManagedBookingSchema.safeParse({
        ...base,
        bookingDate: "2027-02-05",
        [field]: "CANARY",
      }).success,
      false,
      field,
    );
  assert.equal(
    RescheduleManagedBookingSchema.safeParse({
      ...base,
      bookingDate: "2027-02-30",
    }).success,
    false,
  );
  assert.equal(
    CancelManagedBookingSchema.safeParse({ ...base, expectedRevision: "1" })
      .success,
    false,
  );
  assert.equal(
    RecoverBookingOperationSchema.safeParse({
      operationKind: "CREATE",
      idempotencyKey: base.idempotencyKey,
      bookingId: null,
    }).success,
    true,
  );
  assert.equal(
    RecoverBookingOperationSchema.safeParse({
      operationKind: "CREATE",
      idempotencyKey: base.idempotencyKey,
      bookingId: base.bookingId,
    }).success,
    false,
  );
  assert.equal(
    RecoverBookingOperationSchema.safeParse({
      referenceCode: "ZEUS-ABC123",
      customerPhone: "+639170000001",
    }).success,
    false,
  );
  assert.equal(
    ExchangeManagementAccessSchema.safeParse({
      accessToken: "saved-code",
      bookingId: base.bookingId,
    }).success,
    false,
  );
  assert.equal(
    ManagedDayAvailabilitySchema.safeParse({
      bookingId: base.bookingId,
      fromDate: "2027-02-05",
      days: 14,
    }).success,
    true,
  );
});

test("cutoff is half-open at 18:00 Manila on the previous day, including month/year/leap boundaries", () => {
  assert.equal(
    customerCutoff("2027-01-01").toISOString(),
    "2026-12-31T10:00:00.000Z",
  );
  assert.equal(
    beforeCustomerCutoff("2027-01-01", new Date("2026-12-31T09:59:59.999Z")),
    true,
  );
  assert.equal(
    beforeCustomerCutoff("2027-01-01", new Date("2026-12-31T10:00:00.000Z")),
    false,
  );
  assert.equal(
    customerCutoff("2028-03-01").toISOString(),
    "2028-02-29T10:00:00.000Z",
  );
});

test("CREATE recovery authority is DB-clock bounded and never bypasses credential revocation", () => {
  const op = {
    recoveryExpiresAt: new Date("2027-01-02T00:00:00.000Z"),
    credentialVersion: 1,
  };
  assert.equal(
    recoveryAuthority(op, 1, new Date("2027-01-01T23:59:59.999Z")),
    null,
  );
  assert.equal(
    recoveryAuthority(op, 1, op.recoveryExpiresAt),
    "RECOVERY_EXPIRED",
  );
  assert.equal(
    recoveryAuthority(op, 2, new Date("2027-01-01T23:59:59.999Z")),
    "UNAUTHENTICATED",
  );
});

test("O1: recovery admits 100 per client per day, refuses 101, and resets next day", () => {
  assert.ok(
    MANAGEMENT_ADMISSION_POLICIES,
    "the service exposes its actual limiter policies",
  );
  const policy = MANAGEMENT_ADMISSION_POLICIES.recovery;
  assert.deepEqual(policy, {
    perKeyPerMinute: 10,
    perKeyPerDay: 100,
    maxConcurrentPerKey: 2,
  });
  let now = 0;
  const limiter = createLoginLimiter(policy, () => now);
  for (let minute = 0; minute < 10; minute++) {
    now = minute * 60_000;
    for (let n = 0; n < 10; n++) {
      const entry = limiter.enter("customer");
      assert.ok(entry.ok);
      entry.leave();
    }
  }
  now = 600_000;
  const refused = limiter.enter("customer");
  assert.ok(
    !refused.ok && refused.retryAfterSeconds === 85_800,
    "the real day cap survives the next minute",
  );
  const other = limiter.enter("another-customer");
  assert.ok(other.ok);
  other.leave();
  now = 86_400_000;
  const nextDay = limiter.enter("customer");
  assert.ok(nextDay.ok);
  nextDay.leave();
});

test("O1: all five other management limiters have null day windows and keep admitting after 100 requests", () => {
  assert.ok(
    MANAGEMENT_ADMISSION_POLICIES,
    "the service exposes its actual limiter policies",
  );
  assert.deepEqual(Object.keys(MANAGEMENT_ADMISSION_POLICIES).sort(), [
    "exchange",
    "mutationBooking",
    "mutationClient",
    "readBooking",
    "readClient",
    "recovery",
  ]);
  const expected = {
    exchange: 10,
    readClient: 60,
    mutationClient: 15,
    readBooking: 30,
    mutationBooking: 5,
  };
  for (const [name, minuteLimit] of Object.entries(expected)) {
    const policy = MANAGEMENT_ADMISSION_POLICIES[name as keyof typeof expected];
    assert.deepEqual(
      policy,
      {
        perKeyPerMinute: minuteLimit,
        perKeyPerDay: null,
        maxConcurrentPerKey: 2,
      },
      name,
    );
    let now = 0;
    const limiter = createLoginLimiter(policy, () => now);
    for (let n = 0; n < 101; n++) {
      now = Math.floor(n / minuteLimit) * 60_000;
      const entry = limiter.enter("customer");
      assert.ok(entry.ok, name + " must not inherit recovery's daily cap");
      entry.leave();
    }
  }
});
