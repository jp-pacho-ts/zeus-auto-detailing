import assert from "node:assert/strict";
import { test } from "node:test";
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
