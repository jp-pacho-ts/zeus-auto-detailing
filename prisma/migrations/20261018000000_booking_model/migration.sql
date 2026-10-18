-- P1-02 booking model (ADR-005 day queues). Generated DDL first (prisma migrate diff), then the raw SQL below.
-- CreateEnum
CREATE TYPE "LinePriceStatus" AS ENUM ('PRICED', 'FOR_QUOTE');

-- CreateEnum
CREATE TYPE "LineWorkStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "BookingCancellationKind" AS ENUM ('CUSTOMER', 'SHOP_DECLINED', 'STAFF');

-- CreateEnum
CREATE TYPE "BookingAuditAction" AS ENUM ('STATUS_CHANGED', 'RESCHEDULED', 'QUEUE_MOVED', 'REORDERED', 'LINE_ADDED', 'LINE_REMOVED', 'LINE_STATUS_CHANGED', 'PRICE_SET', 'BAY_ASSIGNED', 'BAY_UNASSIGNED', 'BAY_LIST_CHANGED', 'CAP_CHANGED', 'CUSTOMER_NOTIFIED', 'HISTORY_LOOKUP');

-- AlterEnum
ALTER TYPE "SnapshotVersion" ADD VALUE 'QUEUE_V3';

-- AlterTable
ALTER TABLE "booking_line_items" ADD COLUMN     "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "addedByStaffId" TEXT,
ADD COLUMN     "lineVersion" "SnapshotVersion" NOT NULL DEFAULT 'CATALOG_V2',
ADD COLUMN     "priceStatus" "LinePriceStatus",
ADD COLUMN     "referenceSubtotalCentavos" INTEGER,
ADD COLUMN     "referenceUnitPriceCentavos" INTEGER,
ADD COLUMN     "removedAt" TIMESTAMPTZ(3),
ADD COLUMN     "removedByStaffId" TEXT,
ADD COLUMN     "staffPriceCentavos" INTEGER,
ADD COLUMN     "staffPriceSetAt" TIMESTAMPTZ(3),
ADD COLUMN     "staffPriceSetByStaffId" TEXT,
ADD COLUMN     "workStatus" "LineWorkStatus" NOT NULL DEFAULT 'WAITING',
ADD COLUMN     "workStatusChangedAt" TIMESTAMPTZ(3),
ALTER COLUMN "unitPriceCentavos" DROP NOT NULL,
ALTER COLUMN "subtotalCentavos" DROP NOT NULL,
ALTER COLUMN "addedMinutes" DROP NOT NULL;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancellationKind" "BookingCancellationKind",
ADD COLUMN     "createdTxId" BIGINT NOT NULL DEFAULT txid_current(),
ADD COLUMN     "queueCode" TEXT,
ADD COLUMN     "queuePosition" INTEGER,
ADD COLUMN     "receiptEstimatedCentavos" INTEGER,
ADD COLUMN     "receiptTotalCentavos" INTEGER,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "terminalAt" TIMESTAMPTZ(3),
ALTER COLUMN "startTime" DROP NOT NULL,
ALTER COLUMN "endTime" DROP NOT NULL,
ALTER COLUMN "durationMinutes" DROP NOT NULL;

-- AlterTable
ALTER TABLE "catalog_service_versions" ADD COLUMN     "queueCode" TEXT;

-- CreateTable
CREATE TABLE "booking_queues" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dailyCap" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByStaffId" TEXT,

    CONSTRAINT "booking_queues_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "queue_cap_overrides" (
    "id" TEXT NOT NULL,
    "queueCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dailyCap" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByStaffId" TEXT NOT NULL,

    CONSTRAINT "queue_cap_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bays" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_bay_assignments" (
    "bookingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bayId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedByStaffId" TEXT NOT NULL,

    CONSTRAINT "booking_bay_assignments_pkey" PRIMARY KEY ("bookingId","date")
);

-- CreateTable
CREATE TABLE "booking_audit_events" (
    "id" TEXT NOT NULL,
    "action" "BookingAuditAction" NOT NULL,
    "actorStaffId" TEXT NOT NULL,
    "bookingId" TEXT,
    "lineId" TEXT,
    "queueCode" TEXT,
    "bayId" TEXT,
    "fromRevision" INTEGER,
    "toRevision" INTEGER,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus",
    "fromDate" DATE,
    "toDate" DATE,
    "fromQueueCode" TEXT,
    "toQueueCode" TEXT,
    "fromPosition" INTEGER,
    "toPosition" INTEGER,
    "fromLineStatus" "LineWorkStatus",
    "toLineStatus" "LineWorkStatus",
    "previousPriceCentavos" INTEGER,
    "newPriceCentavos" INTEGER,
    "capDate" DATE,
    "previousCap" INTEGER,
    "newCap" INTEGER,
    "phoneDigest" TEXT,
    "resultCount" INTEGER,
    "reason" TEXT,
    "requestId" TEXT,
    "txId" BIGINT NOT NULL DEFAULT txid_current(),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_queues_sortOrder_key" ON "booking_queues"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "queue_cap_overrides_queueCode_date_key" ON "queue_cap_overrides"("queueCode", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bays_nameKey_key" ON "bays"("nameKey");

-- CreateIndex
CREATE INDEX "booking_bay_assignments_bayId_date_idx" ON "booking_bay_assignments"("bayId", "date");

-- CreateIndex
CREATE INDEX "booking_audit_events_bookingId_createdAt_idx" ON "booking_audit_events"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_audit_events_actorStaffId_createdAt_idx" ON "booking_audit_events"("actorStaffId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_audit_events_lineId_idx" ON "booking_audit_events"("lineId");

-- CreateIndex
CREATE INDEX "bookings_customerPhone_bookingDate_idx" ON "bookings"("customerPhone", "bookingDate" DESC);

-- CreateIndex
CREATE INDEX "bookings_bookingDate_queueCode_status_idx" ON "bookings"("bookingDate", "queueCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_bookingDate_queueCode_queuePosition_key" ON "bookings"("bookingDate", "queueCode", "queuePosition");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_queueCode_fkey" FOREIGN KEY ("queueCode") REFERENCES "booking_queues"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_service_versions" ADD CONSTRAINT "catalog_service_versions_queueCode_fkey" FOREIGN KEY ("queueCode") REFERENCES "booking_queues"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_staffPriceSetByStaffId_fkey" FOREIGN KEY ("staffPriceSetByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_addedByStaffId_fkey" FOREIGN KEY ("addedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_removedByStaffId_fkey" FOREIGN KEY ("removedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_queues" ADD CONSTRAINT "booking_queues_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_cap_overrides" ADD CONSTRAINT "queue_cap_overrides_queueCode_fkey" FOREIGN KEY ("queueCode") REFERENCES "booking_queues"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "queue_cap_overrides" ADD CONSTRAINT "queue_cap_overrides_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_bay_assignments" ADD CONSTRAINT "booking_bay_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_bay_assignments" ADD CONSTRAINT "booking_bay_assignments_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "bays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_bay_assignments" ADD CONSTRAINT "booking_bay_assignments_assignedByStaffId_fkey" FOREIGN KEY ("assignedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_audit_events" ADD CONSTRAINT "booking_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_audit_events" ADD CONSTRAINT "booking_audit_events_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_audit_events" ADD CONSTRAINT "booking_audit_events_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "booking_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_audit_events" ADD CONSTRAINT "booking_audit_events_queueCode_fkey" FOREIGN KEY ("queueCode") REFERENCES "booking_queues"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "booking_audit_events" ADD CONSTRAINT "booking_audit_events_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES "bays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- P1-02 booking model (ADR-005, Amendment 1; PM decisions on Revision 3). Raw SQL for what
-- Prisma does not model: checks, guards, the deferrable position constraint, publish_catalog,
-- grants and the queue seed. The SnapshotVersion value added above cannot be used as a typed
-- literal inside this transaction, so new checks compare "snapshotVersion"::text.
-- Every writer takes pg_advisory_xact_lock(746001, 1) first; these guards are defense in depth.
-- =============================================================================

-- Queue positions: one per (day, queue), deferrable so a reorder can swap in one transaction.
-- Legacy rows have NULL queue and position and never conflict.
DROP INDEX "bookings_bookingDate_queueCode_queuePosition_key";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookingDate_queueCode_queuePosition_key"
  UNIQUE ("bookingDate", "queueCode", "queuePosition") DEFERRABLE INITIALLY IMMEDIATE;

-- ADR-005 §7 working-assumption queues. No cap value: NULL means not configured (fail closed).
INSERT INTO booking_queues (code, name, "sortOrder", "updatedAt") VALUES
  ('WASH', 'Wash', 1, CURRENT_TIMESTAMP),
  ('DETAILING_COATING', 'Detailing + Coating', 2, CURRENT_TIMESTAMP),
  ('TINT_PPF', 'Tint + PPF', 3, CURRENT_TIMESTAMP),
  ('REPAINT', 'Repaint', 4, CURRENT_TIMESTAMP);

ALTER TABLE booking_queues ADD CONSTRAINT booking_queue_shape CHECK (code ~ '^[A-Z][A-Z0-9_]{0,31}$' AND length(btrim(name)) BETWEEN 1 AND 60
  AND "sortOrder" >= 0 AND ("dailyCap" IS NULL OR "dailyCap" BETWEEN 0 AND 500) AND revision >= 1);
ALTER TABLE queue_cap_overrides ADD CONSTRAINT queue_cap_override_shape CHECK ("dailyCap" BETWEEN 0 AND 500 AND revision >= 1);
ALTER TABLE bays ADD CONSTRAINT bay_name_key CHECK (length(btrim(name)) BETWEEN 1 AND 40 AND "nameKey" = lower(btrim(name)) AND "sortOrder" >= 0);

-- Queue codes are identities: catalog releases, caps and bookings reference them.
CREATE FUNCTION guard_queue_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR NEW.code <> OLD.code THEN RAISE EXCEPTION 'Booking queue identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_identity BEFORE UPDATE OR DELETE ON booking_queues FOR EACH ROW EXECUTE FUNCTION guard_queue_identity();

-- -----------------------------------------------------------------------------
-- bookings (G10, G11)
-- -----------------------------------------------------------------------------
ALTER TABLE bookings DROP CONSTRAINT catalog_snapshot_shape;
ALTER TABLE bookings ADD CONSTRAINT catalog_snapshot_shape CHECK (
  ("snapshotVersion"::text = 'LEGACY_V1' AND "catalogReleaseId" IS NULL AND "catalogFingerprint" IS NULL AND "pricingAlgorithm" IS NULL AND "vehicleSizeCodeSnapshot" IS NULL)
  OR ("snapshotVersion"::text = 'CATALOG_V2' AND "catalogReleaseId" IS NOT NULL AND "catalogFingerprint" ~ '^[a-f0-9]{64}$' AND "pricingAlgorithm" = 'php-service-size-v2' AND "vehicleSizeCodeSnapshot" IN ('MOTOR','S','M','L','XL'))
  OR ("snapshotVersion"::text = 'QUEUE_V3' AND "catalogReleaseId" IS NOT NULL AND "catalogFingerprint" ~ '^[a-f0-9]{64}$' AND "pricingAlgorithm" = 'php-service-size-v3' AND "vehicleSizeCodeSnapshot" IN ('MOTOR','S','M','L','XL')));
ALTER TABLE bookings DROP CONSTRAINT catalog_snapshot_fields_present;
ALTER TABLE bookings ADD CONSTRAINT catalog_snapshot_fields_present CHECK ("snapshotVersion"::text = 'LEGACY_V1'
  OR ("catalogReleaseId" IS NOT NULL AND "catalogFingerprint" IS NOT NULL AND "pricingAlgorithm" IS NOT NULL AND "vehicleSizeCodeSnapshot" IS NOT NULL));
-- A day booking (QUEUE_V3) has a queue, a position, an immutable receipt, a normalized phone,
-- no clock time and the Manila day window [00:00, next 00:00) in startsAt/endsAt (UTC TIMESTAMP).
-- Legacy and catalog-v2 rows keep their clock fields and take none of the day-queue columns.
-- COALESCE: a NULL inside the CASE must fail, not pass.
ALTER TABLE bookings ADD CONSTRAINT booking_model_shape CHECK (COALESCE(CASE WHEN "snapshotVersion"::text = 'QUEUE_V3' THEN
    "queueCode" IS NOT NULL AND "queuePosition" >= 1
    AND "receiptTotalCentavos" BETWEEN 0 AND 100000000
    AND ("receiptEstimatedCentavos" IS NULL OR "receiptEstimatedCentavos" BETWEEN "receiptTotalCentavos" AND 100000000)
    AND "priceSnapshot" * 100 = "receiptTotalCentavos"
    AND "customerPhone" ~ '^\+639[0-9]{9}$'
    AND "startTime" IS NULL AND "endTime" IS NULL AND "durationMinutes" IS NULL
    AND "startsAt" = ("bookingDate"::timestamp AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'UTC'
    AND "endsAt" = "startsAt" + interval '1 day'
    AND ((status IN ('COMPLETED','CANCELLED')) = ("terminalAt" IS NOT NULL))
    AND ((status = 'CANCELLED') = ("cancellationKind" IS NOT NULL))
  ELSE
    "queueCode" IS NULL AND "queuePosition" IS NULL AND "receiptTotalCentavos" IS NULL AND "receiptEstimatedCentavos" IS NULL
    AND "startTime" IS NOT NULL AND "endTime" IS NOT NULL AND "durationMinutes" IS NOT NULL
    AND ("cancellationKind" IS NULL OR status = 'CANCELLED')
  END, false));

-- G11: the P1-01 frozen set, plus the receipt and the creating transaction. The revision never
-- decreases; the first update of a booking in a transaction records the revision it started
-- from (transaction-local), for the deferred revision and audit checks below.
CREATE OR REPLACE FUNCTION guard_booking_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE k text;
BEGIN
 IF ROW(NEW."snapshotVersion",NEW."catalogReleaseId",NEW."vehicleSizeCodeSnapshot",NEW."catalogFingerprint",NEW."pricingAlgorithm",NEW."vehicleCategoryId",NEW."serviceId",NEW."durationMinutes",NEW."priceSnapshot",NEW."serviceNameSnapshot",NEW."vehicleCategoryNameSnapshot",NEW."idempotencyKey",NEW."requestHash",NEW."receiptTotalCentavos",NEW."receiptEstimatedCentavos",NEW."createdTxId") IS DISTINCT FROM ROW(OLD."snapshotVersion",OLD."catalogReleaseId",OLD."vehicleSizeCodeSnapshot",OLD."catalogFingerprint",OLD."pricingAlgorithm",OLD."vehicleCategoryId",OLD."serviceId",OLD."durationMinutes",OLD."priceSnapshot",OLD."serviceNameSnapshot",OLD."vehicleCategoryNameSnapshot",OLD."idempotencyKey",OLD."requestHash",OLD."receiptTotalCentavos",OLD."receiptEstimatedCentavos",OLD."createdTxId") THEN RAISE EXCEPTION 'Booking financial snapshot is immutable'; END IF;
 IF NEW.revision < OLD.revision THEN RAISE EXCEPTION 'Booking revision cannot decrease'; END IF;
 k := 'zeus_rev.b' || replace(OLD.id, '-', '_');
 IF coalesce(current_setting(k, true), '') = '' THEN PERFORM set_config(k, OLD.revision::text, true); END IF;
 RETURN NEW;
END $$;

-- A day-booking state change (status, day, queue, position, cancellation) commits with a new revision.
CREATE FUNCTION check_booking_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cur int; start text;
BEGIN
 IF NEW."snapshotVersion"::text <> 'QUEUE_V3' THEN RETURN NULL; END IF;
 IF ROW(NEW.status,NEW."bookingDate",NEW."queueCode",NEW."queuePosition",NEW."cancellationKind",NEW."terminalAt",NEW."startsAt",NEW."endsAt") IS NOT DISTINCT FROM ROW(OLD.status,OLD."bookingDate",OLD."queueCode",OLD."queuePosition",OLD."cancellationKind",OLD."terminalAt",OLD."startsAt",OLD."endsAt") THEN RETURN NULL; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id = NEW.id;
 start := current_setting('zeus_rev.b' || replace(NEW.id, '-', '_'), true);
 IF coalesce(start, '') = '' OR cur <= start::int THEN RAISE EXCEPTION 'A day-queue booking change needs a new revision'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_revision_bump AFTER UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_revision();

-- Q3: a (day, queue) never holds more non-CANCELLED day bookings than its effective cap (the
-- override, else the queue default). A NULL cap holds none. COMPLETED keeps its unit (§9).
CREATE FUNCTION queue_day_overbooked(p_queue text, p_date date) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT n > 0 AND n > COALESCE((SELECT o."dailyCap" FROM public.queue_cap_overrides o WHERE o."queueCode" = p_queue AND o.date = p_date),
                               (SELECT q."dailyCap" FROM public.booking_queues q WHERE q.code = p_queue), -1)
 FROM (SELECT count(*) AS n FROM public.bookings b WHERE b."queueCode" = p_queue AND b."bookingDate" = p_date
       AND b."snapshotVersion"::text = 'QUEUE_V3' AND b.status <> 'CANCELLED') c
$$;
-- A booking that newly occupies a (day, queue): created, un-cancelled, moved to another day or queue.
CREATE FUNCTION check_queue_day_cap_booking() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."snapshotVersion"::text <> 'QUEUE_V3' OR NEW.status = 'CANCELLED' THEN RETURN NULL; END IF;
 IF TG_OP = 'UPDATE' AND OLD.status <> 'CANCELLED' AND OLD."bookingDate" = NEW."bookingDate" AND OLD."queueCode" IS NOT DISTINCT FROM NEW."queueCode" THEN RETURN NULL; END IF;
 IF public.queue_day_overbooked(NEW."queueCode", NEW."bookingDate") THEN
  RAISE EXCEPTION 'Queue day is full or has no cap configured (% on %)', NEW."queueCode", NEW."bookingDate";
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_queue_day_cap AFTER INSERT OR UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_queue_day_cap_booking();
-- A cap change is refused when it would drop below committed bookings today or later (Manila).
-- Past days are history and do not block a change.
CREATE FUNCTION check_queue_cap_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d date; q text; today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date;
BEGIN
 IF TG_TABLE_NAME = 'booking_queues' THEN
  FOR d IN SELECT DISTINCT b."bookingDate" FROM public.bookings b WHERE b."queueCode" = NEW.code AND b."bookingDate" >= today
           AND b."snapshotVersion"::text = 'QUEUE_V3' AND b.status <> 'CANCELLED' LOOP
   IF public.queue_day_overbooked(NEW.code, d) THEN RAISE EXCEPTION 'Queue cap is below committed bookings (% on %)', NEW.code, d; END IF;
  END LOOP;
  RETURN NULL;
 END IF;
 IF TG_OP <> 'INSERT' AND OLD.date >= today AND public.queue_day_overbooked(OLD."queueCode", OLD.date) THEN
  RAISE EXCEPTION 'Queue cap is below committed bookings (% on %)', OLD."queueCode", OLD.date;
 END IF;
 IF TG_OP <> 'DELETE' THEN
  q := NEW."queueCode"; d := NEW.date;
  IF d >= today AND public.queue_day_overbooked(q, d) THEN RAISE EXCEPTION 'Queue cap is below committed bookings (% on %)', q, d; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER queue_default_cap AFTER UPDATE ON booking_queues DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_queue_cap_change();
CREATE CONSTRAINT TRIGGER queue_override_cap AFTER INSERT OR UPDATE OR DELETE ON queue_cap_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_queue_cap_change();

-- Q3: COMPLETED needs every active line DONE (ADR-005 §16).
CREATE FUNCTION check_booking_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."snapshotVersion"::text = 'QUEUE_V3' AND NEW.status = 'COMPLETED' AND EXISTS(SELECT 1 FROM public.booking_line_items l
    WHERE l."bookingId" = NEW.id AND l."removedAt" IS NULL AND l."workStatus" <> 'DONE') THEN
  RAISE EXCEPTION 'A day-queue booking is completed only when every service is done';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_completion_lines AFTER INSERT OR UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_completion();

-- -----------------------------------------------------------------------------
-- booking_line_items (G1, G4-G9)
-- -----------------------------------------------------------------------------
-- G1: the P1-01 CATALOG_V2 rule unchanged (new columns empty); QUEUE_V3 per A1/A2/A4.
ALTER TABLE booking_line_items DROP CONSTRAINT catalog_line_bounds;
ALTER TABLE booking_line_items ADD CONSTRAINT catalog_line_bounds CHECK (COALESCE(CASE "lineVersion"::text
  WHEN 'CATALOG_V2' THEN
    "order" BETWEEN 0 AND 2 AND quantity BETWEEN 1 AND 20 AND (unit<>'VEHICLE' OR quantity=1) AND (type<>'ADD_ON' OR quantity=1)
    AND "unitPriceCentavos" BETWEEN 0 AND 100000000 AND "subtotalCentavos" BETWEEN 0 AND 100000000 AND "subtotalCentavos"::bigint=quantity::bigint*"unitPriceCentavos"
    AND "addedMinutes" BETWEEN 0 AND 540 AND (("order"=0 AND type='BASE') OR ("order">0 AND type='ADD_ON'))
    AND "priceStatus" IS NULL AND "referenceUnitPriceCentavos" IS NULL AND "referenceSubtotalCentavos" IS NULL
    AND "staffPriceCentavos" IS NULL AND "staffPriceSetAt" IS NULL AND "staffPriceSetByStaffId" IS NULL
    AND "workStatus"='WAITING' AND "workStatusChangedAt" IS NULL AND "addedByStaffId" IS NULL AND "removedAt" IS NULL AND "removedByStaffId" IS NULL
  WHEN 'QUEUE_V3' THEN
    "order" BETWEEN 0 AND 29 AND quantity BETWEEN 1 AND 20 AND (unit<>'VEHICLE' OR quantity=1) AND (type<>'ADD_ON' OR quantity=1)
    AND ("order"<>0 OR type='BASE') AND "addedMinutes" IS NULL AND "priceStatus" IS NOT NULL
    AND CASE "priceStatus" WHEN 'PRICED' THEN
          "unitPriceCentavos" BETWEEN 0 AND 100000000 AND "subtotalCentavos" BETWEEN 0 AND 100000000
          AND "subtotalCentavos"::bigint=quantity::bigint*"unitPriceCentavos" AND "referenceUnitPriceCentavos" IS NULL AND "referenceSubtotalCentavos" IS NULL
        ELSE "unitPriceCentavos" IS NULL AND "subtotalCentavos" IS NULL
          AND (("referenceUnitPriceCentavos" IS NULL AND "referenceSubtotalCentavos" IS NULL)
            OR ("referenceUnitPriceCentavos" BETWEEN 0 AND 100000000 AND "referenceSubtotalCentavos" BETWEEN 0 AND 100000000
                AND "referenceSubtotalCentavos"::bigint=quantity::bigint*"referenceUnitPriceCentavos")) END
    AND (("staffPriceCentavos" IS NULL AND "staffPriceSetAt" IS NULL AND "staffPriceSetByStaffId" IS NULL)
      OR ("staffPriceCentavos" BETWEEN 0 AND 100000000 AND "staffPriceSetAt" IS NOT NULL AND "staffPriceSetByStaffId" IS NOT NULL))
    AND (("removedAt" IS NULL) = ("removedByStaffId" IS NULL))
    AND ("workStatus"='WAITING' OR "workStatusChangedAt" IS NOT NULL)
  ELSE false END, false));

-- Line inserts: the version follows the booking (LEGACY_V1 never takes lines, G5). A day-queue
-- create line belongs to the booking's own transaction; a staff-added line comes from the head
-- release (A4) onto an open booking. Lines are inserted unedited; edits are audited updates.
CREATE FUNCTION guard_booking_line_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.bookings; head text;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id = NEW."bookingId";
 IF NOT FOUND THEN RETURN NEW; END IF; -- the foreign key reports it
 IF b."snapshotVersion"::text = 'LEGACY_V1' THEN RAISE EXCEPTION 'Legacy snapshot cannot acquire inferred lines'; END IF;
 IF NEW."lineVersion"::text <> b."snapshotVersion"::text THEN RAISE EXCEPTION 'Booking line version must match its booking'; END IF;
 IF NEW."lineVersion"::text = 'QUEUE_V3' THEN
  IF NEW."staffPriceCentavos" IS NOT NULL OR NEW."removedAt" IS NOT NULL OR NEW."workStatus" <> 'WAITING' THEN
   RAISE EXCEPTION 'A day-queue line is inserted unedited (staff-added edits are separate audited changes)';
  END IF;
  IF NEW."addedByStaffId" IS NULL THEN
   IF b."createdTxId" <> txid_current() THEN RAISE EXCEPTION 'A day-queue create line must be created with its booking'; END IF;
  ELSE
   SELECT "releaseId" INTO head FROM public.catalog_head WHERE "shopId" = 1;
   IF head IS DISTINCT FROM NEW."releaseId" THEN RAISE EXCEPTION 'Staff-added lines must come from the head release'; END IF;
   IF b.status IN ('CANCELLED', 'COMPLETED') THEN RAISE EXCEPTION 'Lines cannot be added to a cancelled or completed booking'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_line_insert BEFORE INSERT ON booking_line_items FOR EACH ROW EXECUTE FUNCTION guard_booking_line_insert();

-- G4: DELETE and catalog-v2 updates stay refused ("append-only", as in P1-01). A day-queue line
-- may change only its work status, staff price and one-way soft removal (A4).
DROP TRIGGER catalog_line_immutable ON booking_line_items;
CREATE FUNCTION guard_booking_line_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE st text;
BEGIN
 IF TG_OP = 'DELETE' OR OLD."lineVersion"::text <> 'QUEUE_V3' THEN RAISE EXCEPTION 'Booking line snapshot is append-only'; END IF;
 IF ROW(NEW.id,NEW."bookingId",NEW."order",NEW."releaseId",NEW."serviceId",NEW."vehicleCategoryId",NEW."offerId",NEW.type,NEW."nameSnapshot",NEW.unit,NEW.quantity,NEW."unitPriceCentavos",NEW."subtotalCentavos",NEW."addedMinutes",NEW."lineVersion",NEW."priceStatus",NEW."referenceUnitPriceCentavos",NEW."referenceSubtotalCentavos",NEW."addedAt",NEW."addedByStaffId")
    IS DISTINCT FROM ROW(OLD.id,OLD."bookingId",OLD."order",OLD."releaseId",OLD."serviceId",OLD."vehicleCategoryId",OLD."offerId",OLD.type,OLD."nameSnapshot",OLD.unit,OLD.quantity,OLD."unitPriceCentavos",OLD."subtotalCentavos",OLD."addedMinutes",OLD."lineVersion",OLD."priceStatus",OLD."referenceUnitPriceCentavos",OLD."referenceSubtotalCentavos",OLD."addedAt",OLD."addedByStaffId") THEN
  RAISE EXCEPTION 'Booking line snapshot is immutable';
 END IF;
 IF OLD."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable once removed'; END IF;
 IF OLD."staffPriceCentavos" IS NOT NULL AND NEW."staffPriceCentavos" IS NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable: a staff price cannot be cleared'; END IF;
 SELECT status INTO st FROM public.bookings WHERE id = OLD."bookingId";
 IF st = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled booking takes no line change'; END IF;
 IF st = 'COMPLETED' AND ROW(NEW."workStatus", NEW."removedAt") IS DISTINCT FROM ROW(OLD."workStatus", OLD."removedAt") THEN
  RAISE EXCEPTION 'A completed booking takes only a final price';
 END IF;
 IF NEW."staffPriceCentavos" IS DISTINCT FROM OLD."staffPriceCentavos" AND NOT EXISTS(SELECT 1 FROM public.staff
    WHERE id = NEW."staffPriceSetByStaffId" AND "isActive" AND role IN ('ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only ADMIN sets a line price';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_line_change BEFORE UPDATE OR DELETE ON booking_line_items FOR EACH ROW EXECUTE FUNCTION guard_booking_line_change();
CREATE FUNCTION reject_booking_line_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Booking line snapshot is append-only'; END $$;
CREATE TRIGGER booking_line_no_truncate BEFORE TRUNCATE ON booking_line_items FOR EACH STATEMENT EXECUTE FUNCTION reject_booking_line_truncate();

-- A4: every staff line change commits with a new booking revision and its own audit row from the
-- same transaction (txId), within this transaction's revisions and by the acting staff member.
CREATE FUNCTION check_booking_line_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cur int; start text; ok boolean := true;
BEGIN
 IF NEW."lineVersion"::text <> 'QUEUE_V3' OR (TG_OP = 'INSERT' AND NEW."addedByStaffId" IS NULL) THEN RETURN NULL; END IF;
 IF TG_OP = 'UPDATE' AND ROW(NEW."workStatus", NEW."staffPriceCentavos", NEW."removedAt") IS NOT DISTINCT FROM ROW(OLD."workStatus", OLD."staffPriceCentavos", OLD."removedAt") THEN RETURN NULL; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id = NEW."bookingId";
 start := current_setting('zeus_rev.b' || replace(NEW."bookingId", '-', '_'), true);
 IF coalesce(start, '') = '' OR cur <= start::int THEN RAISE EXCEPTION 'A booking line change needs a new booking revision and its audit row'; END IF;
 IF TG_OP = 'INSERT' THEN
  ok := EXISTS(SELECT 1 FROM public.booking_audit_events e WHERE e."txId" = txid_current() AND e.action = 'LINE_ADDED' AND e."lineId" = NEW.id
        AND e."bookingId" = NEW."bookingId" AND e."actorStaffId" = NEW."addedByStaffId" AND e."toRevision" > start::int AND e."toRevision" <= cur);
 ELSE
  IF NEW."workStatus" IS DISTINCT FROM OLD."workStatus" THEN
   ok := ok AND EXISTS(SELECT 1 FROM public.booking_audit_events e WHERE e."txId" = txid_current() AND e.action = 'LINE_STATUS_CHANGED' AND e."lineId" = NEW.id
         AND e."bookingId" = NEW."bookingId" AND e."fromLineStatus" = OLD."workStatus" AND e."toLineStatus" = NEW."workStatus" AND e."toRevision" > start::int AND e."toRevision" <= cur);
  END IF;
  IF NEW."staffPriceCentavos" IS DISTINCT FROM OLD."staffPriceCentavos" THEN
   ok := ok AND EXISTS(SELECT 1 FROM public.booking_audit_events e WHERE e."txId" = txid_current() AND e.action = 'PRICE_SET' AND e."lineId" = NEW.id
         AND e."bookingId" = NEW."bookingId" AND e."actorStaffId" = NEW."staffPriceSetByStaffId" AND e."newPriceCentavos" = NEW."staffPriceCentavos"
         AND e."previousPriceCentavos" IS NOT DISTINCT FROM OLD."staffPriceCentavos" AND e."toRevision" > start::int AND e."toRevision" <= cur);
  END IF;
  IF NEW."removedAt" IS DISTINCT FROM OLD."removedAt" THEN
   ok := ok AND EXISTS(SELECT 1 FROM public.booking_audit_events e WHERE e."txId" = txid_current() AND e.action = 'LINE_REMOVED' AND e."lineId" = NEW.id
         AND e."bookingId" = NEW."bookingId" AND e."actorStaffId" = NEW."removedByStaffId" AND e."toRevision" > start::int AND e."toRevision" <= cur);
  END IF;
 END IF;
 IF NOT ok THEN RAISE EXCEPTION 'A booking line change needs its audit row in the same transaction'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_line_audit AFTER INSERT OR UPDATE ON booking_line_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_line_audit();

-- G5-G9: the P1-01 function with its LEGACY_V1 and CATALOG_V2 branches unchanged, plus the
-- QUEUE_V3 branch. It also runs after line updates, so the active set stays valid (A4).
CREATE OR REPLACE FUNCTION validate_booking_catalog_lines() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE bid text; b public.bookings; total bigint; minutes bigint; line_count int;
  create_count int; active_count int; active_bases int; all_referenced boolean; estimate bigint;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN bid:=NEW.id; ELSE bid:=NEW."bookingId"; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=bid;
 IF b."snapshotVersion"::text='QUEUE_V3' THEN
  SELECT count(*) FILTER (WHERE "addedByStaffId" IS NULL), count(*) FILTER (WHERE "removedAt" IS NULL),
         count(*) FILTER (WHERE "removedAt" IS NULL AND type='BASE')
    INTO create_count, active_count, active_bases FROM public.booking_line_items WHERE "bookingId"=bid;
  IF create_count NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'A day-queue booking needs 1 to 10 create lines'; END IF;
  IF active_count > 10 THEN RAISE EXCEPTION 'A day-queue booking has at most 10 active lines'; END IF;
  IF active_bases < 1 THEN RAISE EXCEPTION 'A day-queue booking needs at least one active base service'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "order"=0 AND "addedByStaffId" IS NULL AND type='BASE' AND "serviceId"=b."serviceId") THEN
   RAISE EXCEPTION 'The day-queue primary service must be the order-0 base line';
  END IF;
  -- At create the booking joins its primary service's queue (A6); staff may move it later (§14).
  IF b."createdTxId"=txid_current() AND b."queueCode" IS DISTINCT FROM (SELECT v."queueCode" FROM public.catalog_service_versions v WHERE v."releaseId"=b."catalogReleaseId" AND v."serviceId"=b."serviceId") THEN
   RAISE EXCEPTION 'A day-queue booking joins its primary service''s queue';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "removedAt" IS NULL GROUP BY "serviceId" HAVING count(*)>1) THEN
   RAISE EXCEPTION 'A service appears once per visit';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "addedByStaffId" IS NULL AND "releaseId"<>b."catalogReleaseId") THEN
   RAISE EXCEPTION 'Day-queue create lines must use the booking release';
  END IF;
  -- G7 for QUEUE_V3: same size, the line release's own name/unit/type, never NOT_OFFERED, and the
  -- A1/A2 rule (the SQL form of offerBooking() in catalog-pricing.ts).
  IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId"
     JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId"
     WHERE l."bookingId"=bid AND NOT COALESCE(l."vehicleCategoryId"=b."vehicleCategoryId" AND o."sizeCode"=b."vehicleSizeCodeSnapshot"
       AND l."nameSnapshot"=v.name AND l.unit=v.unit AND l.type=v.type AND o.state<>'NOT_OFFERED'
       AND CASE WHEN l."priceStatus"='PRICED' THEN o.state='OFFERED' AND o."bookingMode"='FIXED_ONLINE' AND o."unitPriceCentavos" IS NOT NULL
              AND l."unitPriceCentavos"=o."unitPriceCentavos"
            ELSE (o.state='OFFERED' AND o."bookingMode"='QUOTE_REQUIRED' AND l."referenceUnitPriceCentavos" IS NOT DISTINCT FROM o."unitPriceCentavos")
              OR (o.state='UNCONFIRMED' AND v.unit='PANEL' AND v."referenceUnitPriceCentavos" IS NOT NULL AND l."referenceUnitPriceCentavos"=v."referenceUnitPriceCentavos") END, false)) THEN
   RAISE EXCEPTION 'Catalog snapshot offer mismatch';
  END IF;
  -- The immutable receipt equals the create lines: priced sum, and the estimate (NULL while a
  -- for-quote create line has no reference, R21).
  SELECT COALESCE(sum("subtotalCentavos") FILTER (WHERE "priceStatus"='PRICED'), 0), bool_and("priceStatus"='PRICED' OR "referenceSubtotalCentavos" IS NOT NULL),
         sum(COALESCE("subtotalCentavos", "referenceSubtotalCentavos"))
    INTO total, all_referenced, estimate FROM public.booking_line_items WHERE "bookingId"=bid AND "addedByStaffId" IS NULL;
  IF total IS DISTINCT FROM b."receiptTotalCentavos"::bigint OR (CASE WHEN all_referenced THEN estimate END) IS DISTINCT FROM b."receiptEstimatedCentavos"::bigint THEN
   RAISE EXCEPTION 'Day-queue receipt does not match its create lines';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items s JOIN public.booking_line_items c ON c."bookingId"=s."bookingId" AND c."addedByStaffId" IS NULL
     WHERE s."bookingId"=bid AND s."addedByStaffId" IS NOT NULL AND s."order"<c."order") THEN
   RAISE EXCEPTION 'Staff-added lines follow the create lines';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
  RETURN NEW;
 END IF;
 SELECT sum("subtotalCentavos"),sum("addedMinutes"),count(*) INTO total,minutes,line_count FROM public.booking_line_items WHERE "bookingId"=bid;
 IF b."snapshotVersion"='LEGACY_V1' THEN IF line_count<>0 THEN RAISE EXCEPTION 'Legacy snapshot cannot acquire inferred lines'; END IF; RETURN NEW; END IF;
 IF line_count NOT BETWEEN 1 AND 3 OR total IS DISTINCT FROM (b."priceSnapshot"*100)::bigint OR minutes IS DISTINCT FROM b."durationMinutes"::bigint OR NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "order"=0 AND "serviceId"=b."serviceId" AND type='BASE') THEN RAISE EXCEPTION 'Incomplete catalog snapshot totals'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId" JOIN public.service_work_plans p ON p."offerId"=o.id JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE l."bookingId"=bid AND (l."releaseId"<>b."catalogReleaseId" OR l."vehicleCategoryId"<>b."vehicleCategoryId" OR o."sizeCode"<>b."vehicleSizeCodeSnapshot" OR l."unitPriceCentavos" IS DISTINCT FROM o."unitPriceCentavos" OR l."nameSnapshot"<>v.name OR l.unit<>v.unit OR l.type<>v.type OR o.state<>'OFFERED' OR o."bookingMode"<>'FIXED_ONLINE' OR p.kind<>'TIMED' OR l."addedMinutes" IS DISTINCT FROM p."durationMinutes")) THEN RAISE EXCEPTION 'Catalog snapshot offer mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER catalog_line_updates AFTER UPDATE ON booking_line_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_booking_catalog_lines();

-- -----------------------------------------------------------------------------
-- Bays (A3): assignments for open day bookings, on or after the booked day, to an active bay.
-- -----------------------------------------------------------------------------
CREATE FUNCTION guard_booking_bay() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.bookings;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id = NEW."bookingId";
 IF NOT FOUND OR b."snapshotVersion"::text <> 'QUEUE_V3' THEN RAISE EXCEPTION 'Bay assignments are for day-queue bookings'; END IF;
 IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled booking takes no bay'; END IF;
 IF NEW.date < b."bookingDate" THEN RAISE EXCEPTION 'A bay is assigned on or after the booked day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id = NEW."bayId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active bay'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_bay_rules BEFORE INSERT OR UPDATE ON booking_bay_assignments FOR EACH ROW EXECUTE FUNCTION guard_booking_bay();

-- -----------------------------------------------------------------------------
-- Staff audit trail (Q1; ADR-003 T-021 and S-06, re-expressed for ADR-005). HISTORY_LOOKUP
-- stores only a keyed HMAC-SHA256 digest (the key stays server-side, never in the database).
-- -----------------------------------------------------------------------------
ALTER TABLE booking_audit_events ADD CONSTRAINT booking_audit_shape CHECK (COALESCE(
  (reason IS NULL OR length(reason) BETWEEN 1 AND 500) AND ("requestId" IS NULL OR length("requestId") BETWEEN 1 AND 100)
  AND (("fromRevision" IS NULL AND "toRevision" IS NULL) OR ("fromRevision" >= 1 AND "toRevision" = "fromRevision" + 1))
  AND ("fromQueueCode" IS NULL OR "fromQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$') AND ("toQueueCode" IS NULL OR "toQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$')
  AND ("fromPosition" IS NULL OR "fromPosition" >= 1) AND ("toPosition" IS NULL OR "toPosition" >= 1)
  AND ("previousPriceCentavos" IS NULL OR "previousPriceCentavos" BETWEEN 0 AND 100000000) AND ("newPriceCentavos" IS NULL OR "newPriceCentavos" BETWEEN 0 AND 100000000)
  AND ("previousCap" IS NULL OR "previousCap" BETWEEN 0 AND 500) AND ("newCap" IS NULL OR "newCap" BETWEEN 0 AND 500)
  AND ("phoneDigest" IS NULL OR "phoneDigest" ~ '^[a-f0-9]{64}$') AND ("resultCount" IS NULL OR "resultCount" >= 0)
  AND CASE action
    WHEN 'STATUS_CHANGED' THEN "bookingId" IS NOT NULL AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'RESCHEDULED' THEN "bookingId" IS NOT NULL AND "fromDate" IS NOT NULL AND "toDate" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'QUEUE_MOVED' THEN "bookingId" IS NOT NULL AND "fromQueueCode" IS NOT NULL AND "toQueueCode" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'REORDERED' THEN "bookingId" IS NOT NULL AND "fromPosition" IS NOT NULL AND "toPosition" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'LINE_ADDED' THEN "bookingId" IS NOT NULL AND "lineId" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'LINE_REMOVED' THEN "bookingId" IS NOT NULL AND "lineId" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'LINE_STATUS_CHANGED' THEN "bookingId" IS NOT NULL AND "lineId" IS NOT NULL AND "fromLineStatus" IS NOT NULL AND "toLineStatus" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'PRICE_SET' THEN "bookingId" IS NOT NULL AND "lineId" IS NOT NULL AND "newPriceCentavos" IS NOT NULL AND reason IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'BAY_ASSIGNED' THEN "bookingId" IS NOT NULL AND "bayId" IS NOT NULL AND "toDate" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'BAY_UNASSIGNED' THEN "bookingId" IS NOT NULL AND "bayId" IS NOT NULL AND "fromDate" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'BAY_LIST_CHANGED' THEN "bayId" IS NOT NULL AND "bookingId" IS NULL
    WHEN 'CAP_CHANGED' THEN "queueCode" IS NOT NULL AND "bookingId" IS NULL
    WHEN 'CUSTOMER_NOTIFIED' THEN "bookingId" IS NOT NULL
    WHEN 'HISTORY_LOOKUP' THEN "phoneDigest" IS NOT NULL AND "resultCount" IS NOT NULL AND "bookingId" IS NULL AND "lineId" IS NULL
    ELSE false END, false));
CREATE FUNCTION reject_booking_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Booking audit is append-only'; END $$;
CREATE TRIGGER booking_audit_immutable BEFORE UPDATE OR DELETE ON booking_audit_events FOR EACH ROW EXECUTE FUNCTION reject_booking_audit_change();
CREATE TRIGGER booking_audit_no_truncate BEFORE TRUNCATE ON booking_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_booking_audit_change();

-- -----------------------------------------------------------------------------
-- G14: publish_catalog, unchanged from P1-01 except the queue check (CREATE OR REPLACE keeps
-- its owner, SECURITY DEFINER and the PUBLIC/zeus_app revokes).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION publish_catalog(p_release text,p_hash text,p_review text,p_reason text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor text; r public.catalog_releases; previous_id text; previous_hash text; document jsonb; s jsonb; o jsonb; actual jsonb; event_id text;
BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 SELECT staff.id INTO actor FROM public.catalog_publishers mapping JOIN public.staff staff ON staff.id=mapping."actorStaffId" WHERE mapping."databaseRole"=session_user AND staff."isActive" AND staff.role IN ('ADMIN','MANAGER') FOR UPDATE OF staff;
 IF actor IS NULL THEN RAISE EXCEPTION 'Catalog publication requires a mapped active ADMIN'; END IF;
 IF p_review IS NULL OR length(btrim(p_review))=0 OR length(p_review)>500 OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Review reference and reason required'; END IF;
 SELECT * INTO STRICT r FROM public.catalog_releases WHERE id=p_release FOR UPDATE;
 IF r.state<>'DRAFT' OR r."manifestSha256"<>p_hash OR p_hash<>encode(sha256(convert_to(r."manifestJson",'UTF8')),'hex') THEN RAISE EXCEPTION 'Release state or approved manifest hash mismatch'; END IF;
 document:=r."manifestJson"::jsonb;
 IF document->>'version'<>r.version OR document->>'sourceSha256'<>r."sourceSha256" OR document->>'sourcePath'<>r."sourcePath" OR document->>'sourceReceivedDate'<>r."sourceReceivedDate"::date::text THEN RAISE EXCEPTION 'Manifest provenance mismatch'; END IF;
 IF jsonb_array_length(document->'services')<>21 OR (SELECT count(*) FROM public.catalog_service_versions WHERE "releaseId"=r.id)<>21 OR (SELECT count(*) FROM public.service_size_offers WHERE "releaseId"=r.id)<>105 OR (SELECT count(*) FROM public.add_on_compatibility WHERE "releaseId"=r.id)<>6 THEN RAISE EXCEPTION 'Incomplete catalog release'; END IF;
 -- P1-02 (ADR-005 §7): every service of the release joins an active queue.
 IF EXISTS(SELECT 1 FROM public.catalog_service_versions v LEFT JOIN public.booking_queues q ON q.code=v."queueCode" WHERE v."releaseId"=r.id AND (q.code IS NULL OR NOT q."isActive")) THEN RAISE EXCEPTION 'Catalog service without an active queue'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'sizes') LOOP
  SELECT jsonb_build_object('id',id,'code',slug,'name',name,'sortOrder',"sortOrder") INTO actual FROM public.vehicle_categories WHERE id=s->>'id';
  IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'Manifest size mismatch'; END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'services') LOOP
  SELECT (to_jsonb(v)-'releaseId'-'serviceId')||jsonb_build_object('id',v."serviceId") INTO actual FROM public.catalog_service_versions v WHERE "releaseId"=r.id AND "serviceId"=s->>'id';
  IF actual IS DISTINCT FROM s-'offers' THEN RAISE EXCEPTION 'Manifest service mismatch'; END IF;
  IF jsonb_array_length(s->'offers')<>5 THEN RAISE EXCEPTION 'Missing size offer'; END IF;
  FOR o IN SELECT value FROM jsonb_array_elements(s->'offers') LOOP
   SELECT (to_jsonb(offer)-'releaseId'-'serviceId'-'promoStartsAt'-'promoEndsAt')||jsonb_build_object('durationKind',plan.kind,'durationMinutes',plan."durationMinutes",'elapsedDays',plan."elapsedDays",'bayHoldPolicy',plan."bayHoldPolicy") INTO actual FROM public.service_size_offers offer JOIN public.service_work_plans plan ON plan."offerId"=offer.id WHERE offer.id=o->>'id' AND offer."releaseId"=r.id AND offer."serviceId"=s->>'id';
   IF actual IS DISTINCT FROM o THEN RAISE EXCEPTION 'Manifest offer mismatch'; END IF;
  END LOOP;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'compatibility') LOOP
  SELECT to_jsonb(c)-'releaseId' INTO actual FROM public.add_on_compatibility c WHERE "releaseId"=r.id AND "baseServiceId"=s->>'baseServiceId' AND "addOnServiceId"=s->>'addOnServiceId';
  IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'Manifest compatibility mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.catalog_hold_segments h JOIN public.service_size_offers o ON h."offerId"=o.id WHERE o."releaseId"=r.id) OR EXISTS(SELECT 1 FROM public.service_work_plans p JOIN public.service_size_offers o ON o.id=p."offerId" WHERE o."releaseId"=r.id AND p.kind='MULTI_DAY') THEN RAISE EXCEPTION 'Multi-day allocation is not enabled'; END IF;
 SELECT head."releaseId",old."manifestSha256" INTO previous_id,previous_hash FROM public.catalog_head head JOIN public.catalog_releases old ON old.id=head."releaseId" WHERE head."shopId"=1;
 UPDATE public.catalog_releases SET state='RETIRED' WHERE id=previous_id;
 UPDATE public.catalog_releases SET state='PUBLISHED',"reviewReference"=p_review,"publishedAt"=CURRENT_TIMESTAMP WHERE id=r.id;
 INSERT INTO public.catalog_head ("shopId","releaseId") VALUES (1,r.id) ON CONFLICT ("shopId") DO UPDATE SET "releaseId"=EXCLUDED."releaseId";
 UPDATE public.services SET "isActive"=false WHERE id NOT IN (SELECT "serviceId" FROM public.catalog_service_versions WHERE "releaseId"=r.id);
 event_id:=gen_random_uuid()::text;
 INSERT INTO public.catalog_publication_events (id,"releaseId","previousReleaseId","actorStaffId","databaseRole",action,reason,"reviewReference","sourceSha256","manifestSha256","previousManifestSha256") VALUES (event_id,r.id,previous_id,actor,session_user,CASE WHEN p_reason LIKE 'ROLLBACK:%' THEN 'ROLLBACK' ELSE 'PUBLISH' END,p_reason,p_review,r."sourceSha256",r."manifestSha256",previous_hash);
 RETURN event_id;
END $$;

-- -----------------------------------------------------------------------------
-- G12 and the new tables: runtime grants (only when the runtime role exists, as in P1-01).
-- Default privileges may grant more, so each table is revoked first.
-- -----------------------------------------------------------------------------
REVOKE ALL ON booking_audit_events FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 REVOKE ALL ON booking_queues, queue_cap_overrides, bays, booking_bay_assignments, booking_audit_events, booking_line_items FROM zeus_app;
 GRANT SELECT ON booking_queues TO zeus_app;
 GRANT UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId") ON booking_queues TO zeus_app;
 GRANT SELECT, INSERT, DELETE ON queue_cap_overrides TO zeus_app;
 GRANT UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId") ON queue_cap_overrides TO zeus_app;
 GRANT SELECT, INSERT ON bays TO zeus_app;
 GRANT UPDATE (name, "nameKey", "sortOrder", "isActive", "updatedAt") ON bays TO zeus_app;
 GRANT SELECT, INSERT, DELETE ON booking_bay_assignments TO zeus_app;
 GRANT UPDATE ("bayId", "assignedAt", "assignedByStaffId") ON booking_bay_assignments TO zeus_app;
 GRANT SELECT, INSERT ON booking_audit_events TO zeus_app;
 GRANT SELECT, INSERT ON booking_line_items TO zeus_app;
 GRANT UPDATE ("workStatus", "workStatusChangedAt", "staffPriceCentavos", "staffPriceSetAt", "staffPriceSetByStaffId", "removedAt", "removedByStaffId") ON booking_line_items TO zeus_app;
END IF; END $$;
