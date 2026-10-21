BEGIN;
-- P1-18 optional deposit proof. Additive: a deposit status on the booking, an immutable proof
-- table (sanitized images in the database, no file names) and one new audit action.
CREATE TYPE "DepositStatus" AS ENUM ('NONE', 'PROOF_SENT', 'RECEIVED', 'REJECTED');
ALTER TYPE "BookingAuditAction" ADD VALUE 'DEPOSIT_STATUS_CHANGED';
ALTER TABLE "booking_audit_events" ADD COLUMN "fromDepositStatus" "DepositStatus", ADD COLUMN "toDepositStatus" "DepositStatus";
ALTER TABLE "bookings" ADD COLUMN "depositStatus" "DepositStatus" NOT NULL DEFAULT 'NONE';

CREATE TABLE "booking_deposit_proofs" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "clientHash" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdTxId" BIGINT NOT NULL DEFAULT txid_current(),
    "notifyState" TEXT NOT NULL DEFAULT 'PENDING',
    "notifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "notifyNextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifySentAt" TIMESTAMPTZ(3),
    CONSTRAINT "booking_deposit_proofs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "booking_deposit_proofs_keyHash_key" ON "booking_deposit_proofs"("keyHash");
CREATE INDEX "booking_deposit_proofs_bookingId_createdAt_idx" ON "booking_deposit_proofs"("bookingId", "createdAt");
CREATE INDEX "booking_deposit_proofs_notifyState_notifyNextAttemptAt_idx" ON "booking_deposit_proofs"("notifyState", "notifyNextAttemptAt");
-- Files go with their booking record (retention rule).
ALTER TABLE "booking_deposit_proofs" ADD CONSTRAINT "booking_deposit_proofs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE booking_deposit_proofs ADD CONSTRAINT deposit_proof_shape CHECK (
  "contentType" IN ('image/jpeg','image/png','image/webp')
  AND "byteSize" BETWEEN 1 AND 5242880 AND octet_length(data) = "byteSize"
  AND width BETWEEN 1 AND 10000 AND height BETWEEN 1 AND 10000
  AND "keyHash" ~ '^[a-f0-9]{64}$' AND "contentHash" ~ '^[a-f0-9]{64}$' AND "clientHash" ~ '^[a-f0-9]{64}$'
  AND "notifyState" IN ('PENDING','SENDING','SENT','FAILED') AND "notifyAttempts" BETWEEN 0 AND 3
  AND (("notifyState"='SENT') = ("notifySentAt" IS NOT NULL)));

-- At most 3 proofs per booking, only on open day-queue bookings, in the inserting transaction.
CREATE FUNCTION guard_deposit_proof_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b record; BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 SELECT id, "snapshotVersion"::text AS v, status::text AS s INTO b FROM public.bookings WHERE id=NEW."bookingId" FOR UPDATE;
 IF b.id IS NULL OR b.v<>'QUEUE_V3' OR b.s NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN RAISE EXCEPTION 'Deposit proof needs an open day-queue booking'; END IF;
 IF (SELECT count(*) FROM public.booking_deposit_proofs WHERE "bookingId"=NEW."bookingId") >= 3 THEN RAISE EXCEPTION 'At most 3 deposit proofs per booking'; END IF;
 IF NEW."createdTxId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Deposit proof createdTxId must be the inserting transaction'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER deposit_proof_insert BEFORE INSERT ON booking_deposit_proofs FOR EACH ROW EXECUTE FUNCTION guard_deposit_proof_insert();
-- The image and its provenance are immutable; only the shop-email delivery state moves.
CREATE FUNCTION guard_deposit_proof_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF ROW(NEW.id,NEW."bookingId",NEW."keyHash",NEW."contentHash",NEW."clientHash",NEW."contentType",NEW."byteSize",NEW.width,NEW.height,NEW.data,NEW."createdAt",NEW."createdTxId")
   IS DISTINCT FROM ROW(OLD.id,OLD."bookingId",OLD."keyHash",OLD."contentHash",OLD."clientHash",OLD."contentType",OLD."byteSize",OLD.width,OLD.height,OLD.data,OLD."createdAt",OLD."createdTxId")
 THEN RAISE EXCEPTION 'Deposit proofs are immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER deposit_proof_update BEFORE UPDATE ON booking_deposit_proofs FOR EACH ROW EXECUTE FUNCTION guard_deposit_proof_update();
CREATE TRIGGER deposit_proof_no_truncate BEFORE TRUNCATE ON booking_deposit_proofs FOR EACH STATEMENT EXECUTE FUNCTION reject_booking_audit_change();

-- A deposit status change commits with a new revision and its cause in the same transaction:
-- PROOF_SENT with a proof inserted there; RECEIVED/REJECTED with an ADMIN audit row. Never back to NONE.
CREATE FUNCTION check_deposit_status_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cur int; start text; BEGIN
 IF NEW."depositStatus"::text='NONE' THEN RAISE EXCEPTION 'Deposit status cannot return to NONE'; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id=NEW.id;
 start:=current_setting('zeus_rev.b'||replace(NEW.id,'-','_'),true);
 IF coalesce(start,'')='' OR cur<=start::int THEN RAISE EXCEPTION 'A deposit status change needs a new revision'; END IF;
 IF NEW."depositStatus"::text='PROOF_SENT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.booking_deposit_proofs WHERE "bookingId"=NEW.id AND "createdTxId"=txid_current()) THEN RAISE EXCEPTION 'PROOF_SENT needs a new deposit proof'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId"
   WHERE e.action::text='DEPOSIT_STATUS_CHANGED' AND e."bookingId"=NEW.id AND e."txId"=txid_current()
   AND e."fromDepositStatus"=OLD."depositStatus" AND e."toDepositStatus"=NEW."depositStatus" AND e."toRevision"=cur
   AND s."isActive" AND s.role IN ('ADMIN','MANAGER')) THEN
  RAISE EXCEPTION 'A deposit decision needs an ADMIN audit row';
 END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER booking_deposit_status AFTER UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (OLD."depositStatus" IS DISTINCT FROM NEW."depositStatus") EXECUTE FUNCTION check_deposit_status_change();

-- The audit shape gains the new action (text comparison: the enum value is new in this transaction).
ALTER TABLE booking_audit_events DROP CONSTRAINT booking_audit_shape;
ALTER TABLE booking_audit_events ADD CONSTRAINT booking_audit_shape CHECK (COALESCE(
  (reason IS NULL OR length(reason) BETWEEN 1 AND 500) AND ("requestId" IS NULL OR length("requestId") BETWEEN 1 AND 100)
  AND (("fromRevision" IS NULL AND "toRevision" IS NULL) OR ("fromRevision" >= 1 AND "toRevision" = "fromRevision" + 1))
  AND ("fromQueueCode" IS NULL OR "fromQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$') AND ("toQueueCode" IS NULL OR "toQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$')
  AND ("fromPosition" IS NULL OR "fromPosition" >= 1) AND ("toPosition" IS NULL OR "toPosition" >= 1)
  AND ("previousPriceCentavos" IS NULL OR "previousPriceCentavos" BETWEEN 0 AND 100000000) AND ("newPriceCentavos" IS NULL OR "newPriceCentavos" BETWEEN 0 AND 100000000)
  AND ("previousCap" IS NULL OR "previousCap" BETWEEN 0 AND 500) AND ("newCap" IS NULL OR "newCap" BETWEEN 0 AND 500)
  AND ("phoneDigest" IS NULL OR "phoneDigest" ~ '^[a-f0-9]{64}$') AND ("resultCount" IS NULL OR "resultCount" >= 0)
  AND (("fromDepositStatus" IS NULL AND "toDepositStatus" IS NULL) OR action::text='DEPOSIT_STATUS_CHANGED')
  AND CASE action::text
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
    WHEN 'WORKER_ASSIGNED' THEN "bookingId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'WORKER_UNASSIGNED' THEN "bookingId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "toRevision" IS NOT NULL
    WHEN 'DEPOSIT_STATUS_CHANGED' THEN "bookingId" IS NOT NULL AND "fromDepositStatus" IS NOT NULL AND "toDepositStatus" IN ('RECEIVED','REJECTED') AND "toRevision" IS NOT NULL
    ELSE false END, false));

-- Owner defaults (including PUBLIC) must not widen these exact runtime grants.
REVOKE ALL ON booking_deposit_proofs FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 REVOKE ALL ON booking_deposit_proofs FROM zeus_app;
 -- Customers insert; staff read; the shop-email drain moves only the delivery state. No DELETE.
 GRANT SELECT, INSERT ON booking_deposit_proofs TO zeus_app;
 GRANT UPDATE ("notifyState","notifyAttempts","notifyNextAttemptAt","notifySentAt") ON booking_deposit_proofs TO zeus_app;
 GRANT UPDATE ("depositStatus") ON bookings TO zeus_app;
END IF; END $$;
COMMIT;
