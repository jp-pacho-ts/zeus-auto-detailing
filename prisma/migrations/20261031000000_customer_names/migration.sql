BEGIN;
-- P1-32: first and last name on a booking, for the "reference code + last name" lookup. Purely
-- additive: two nullable columns. customerName stays NOT NULL as the display name ("First Last" for a
-- new booking, the old single name for an older one), so every existing reader and the request hash
-- keep working. Existing rows are NOT rewritten; the lookup falls back to the last word of the old name.
--
-- It also adds booking_management_sessions."origin" (LINK or LOOKUP, default LINK; Codex F1): a session opened with the
-- reference code and last name is marked LOOKUP so that it, and every later read, cancel or proof upload made with it,
-- shows no money. Existing rows and the old code keep the default LINK. Sessions stay immutable (the existing trigger).
--
-- Rollout: this migration FIRST (old code ignores the columns), then a read-only check that the three columns
-- exist, then the code release. The new code reads them only in the customer create, the lookup and the management reads.
--
-- Down-step (documented only; Prisma does not run it):
--   ALTER TABLE bookings DROP CONSTRAINT booking_customer_name_parts,
--     DROP COLUMN "customerFirstName", DROP COLUMN "customerLastName";
--   ALTER TABLE booking_management_sessions DROP CONSTRAINT booking_management_session_origin, DROP COLUMN "origin";
ALTER TABLE "bookings" ADD COLUMN "customerFirstName" TEXT, ADD COLUMN "customerLastName" TEXT;
-- Both or neither (a CHECK passes on NULL, so the pairing is stated explicitly), 1 to 50 characters each,
-- no control characters.
ALTER TABLE "bookings" ADD CONSTRAINT booking_customer_name_parts CHECK (
  ("customerFirstName" IS NULL) = ("customerLastName" IS NULL)
  AND ("customerFirstName" IS NULL OR (
    length("customerFirstName") BETWEEN 1 AND 50 AND length("customerLastName") BETWEEN 1 AND 50
    AND "customerFirstName" !~ '[[:cntrl:]]' AND "customerLastName" !~ '[[:cntrl:]]')));
ALTER TABLE "booking_management_sessions" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'LINK';
ALTER TABLE "booking_management_sessions" ADD CONSTRAINT booking_management_session_origin CHECK ("origin" IN ('LINK', 'LOOKUP'));
COMMIT;
