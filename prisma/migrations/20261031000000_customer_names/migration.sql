BEGIN;
-- P1-32: first and last name on a booking, for the "reference code + last name" lookup. Purely
-- additive: two nullable columns. customerName stays NOT NULL as the display name ("First Last" for a
-- new booking, the old single name for an older one), so every existing reader and the request hash
-- keep working. Existing rows are NOT rewritten; the lookup falls back to the last word of the old name.
--
-- Rollout: this migration FIRST (old code ignores the columns), then a read-only check that both columns
-- exist, then the code release. The new code reads them only in the customer create and the lookup.
--
-- Down-step (documented only; Prisma does not run it):
--   ALTER TABLE bookings DROP COLUMN "customerFirstName", DROP COLUMN "customerLastName";
ALTER TABLE "bookings" ADD COLUMN "customerFirstName" TEXT, ADD COLUMN "customerLastName" TEXT;
ALTER TABLE "bookings" ADD CONSTRAINT booking_customer_name_parts CHECK (
  ("customerFirstName" IS NULL AND "customerLastName" IS NULL)
  OR (length("customerFirstName") BETWEEN 1 AND 50 AND length("customerLastName") BETWEEN 1 AND 50
      AND "customerFirstName" !~ '[[:cntrl:]]' AND "customerLastName" !~ '[[:cntrl:]]'));
COMMIT;
