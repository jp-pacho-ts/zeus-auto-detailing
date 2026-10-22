import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPOSIT_UPLOAD_POLICIES, MAX_PROOFS_PER_BOOKING, MAX_UPLOAD_BODY_BYTES } from "./deposit-proofs";
import { bookingError, lifecycleHttpStatus } from "./bookings-errors";
import { canPerform } from "./admin/roles";
import { proofImageResponse } from "./admin/deposit";
import { depositNoticeMessage } from "./notifications/bookings";
import { png } from "./deposit-image.fixture";

test("upload limits: 3 files per booking, per-client and per-booking rate limits, one upload at a time", () => {
  assert.equal(MAX_PROOFS_PER_BOOKING, 3);
  assert.deepEqual(DEPOSIT_UPLOAD_POLICIES, {
    client: { perKeyPerMinute: 10, perKeyPerDay: 30, maxConcurrentPerKey: 1 },
    booking: { perKeyPerMinute: 6, perKeyPerDay: 20, maxConcurrentPerKey: 1 },
  });
  // base64 of 5 MiB plus the JSON envelope; anything longer is refused while reading.
  assert.ok(MAX_UPLOAD_BODY_BYTES >= Math.ceil((5 * 1024 * 1024) / 3) * 4 + 200);
  assert.ok(MAX_UPLOAD_BODY_BYTES < 7.2 * 1024 * 1024);
});

test("upload error codes map to HTTP 400, 413 and 409", () => {
  assert.equal(lifecycleHttpStatus(bookingError("UNSUPPORTED_FILE", "x")), 400);
  assert.equal(lifecycleHttpStatus(bookingError("FILE_TOO_LARGE", "x")), 413);
  assert.equal(lifecycleHttpStatus(bookingError("DEPOSIT_PROOF_LIMIT", "x")), 409);
});

test("only ADMIN sets the deposit status; STAFF reads", () => {
  assert.equal(canPerform("DEPOSIT_STATUS", "ADMIN"), true);
  assert.equal(canPerform("DEPOSIT_STATUS", "STAFF"), false);
  assert.equal(canPerform("READ", "STAFF"), true);
});

test("staff image responses: fixed type, inline without a file name, no-store, nosniff, sandboxed", async () => {
  const data = png();
  const res = proofImageResponse({ contentType: "image/png", data });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("content-disposition"), "inline");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(res.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("content-length"), String(data.length));
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(data));
  assert.throws(() => proofImageResponse({ contentType: "text/html", data }), /content type/);
});

test("the shop email names the reference only: no image, no customer details", () => {
  const m = depositNoticeMessage("ZEUS-ABC123", "11111111-2222-4333-8444-555555555555", "https://zeus.example.test");
  assert.equal(m.subject, "Deposit proof sent for ZEUS-ABC123");
  assert.equal(m.text, [
    "ZEUS-ABC123",
    "The customer sent a deposit proof. Check it against the shop account, then mark the deposit received or rejected.",
    "https://zeus.example.test/admin/bookings?bookingId=11111111-2222-4333-8444-555555555555",
  ].join("\n"));
});
