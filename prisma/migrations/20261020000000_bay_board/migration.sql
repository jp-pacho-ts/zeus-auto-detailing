-- Read-only preflight is outside BEGIN so Prisma reports offending IDs rather than an aborted transaction.
DO $$ DECLARE bad text; BEGIN
 SELECT string_agg(id, ', ' ORDER BY id) INTO bad FROM bays WHERE name NOT IN ('Wash Bay 1','Wash Bay 2','Wash Bay 3','Detailing Bay 1','Detailing Bay 2','Detailing Bay 3','Paint Booth 1','Paint Booth 2');
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Unclassified bay IDs: %',bad; END IF;
 SELECT string_agg(a."bookingId", ', ') INTO bad FROM booking_bay_assignments a JOIN bookings b ON b.id=a."bookingId" JOIN bays y ON y.id=a."bayId" WHERE NOT ((y.name LIKE 'Wash Bay %' AND b."queueCode"='WASH') OR (y.name LIKE 'Detailing Bay %' AND b."queueCode" IN ('DETAILING_COATING','TINT_PPF')) OR (y.name LIKE 'Paint Booth %' AND b."queueCode"='REPAINT'));
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Incompatible bay assignment booking IDs: %',bad; END IF;
 SELECT string_agg(x."bookingId", ', ') INTO bad FROM (SELECT a."bookingId" FROM booking_bay_assignments a JOIN bookings b ON b.id=a."bookingId" WHERE b.status IN ('PENDING','CONFIRMED','IN_PROGRESS') GROUP BY a."bookingId" HAVING count(DISTINCT a."bayId")>1) x;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Ambiguous open assignment booking IDs: %',bad; END IF;
 END $$;
BEGIN;
-- ADR-005 Amendment 4: typed physical bays and persistent, exclusive occupancy.
CREATE TYPE "BayType" AS ENUM ('WASH','DETAILING','PAINT');
ALTER TYPE "BookingAuditAction" ADD VALUE 'WORKER_ASSIGNED';
ALTER TYPE "BookingAuditAction" ADD VALUE 'WORKER_UNASSIGNED';
ALTER TABLE bays ADD COLUMN "bayType" "BayType";
UPDATE bays SET "bayType"=CASE WHEN name IN ('Wash Bay 1','Wash Bay 2','Wash Bay 3') THEN 'WASH'::"BayType" WHEN name IN ('Detailing Bay 1','Detailing Bay 2','Detailing Bay 3') THEN 'DETAILING'::"BayType" WHEN name IN ('Paint Booth 1','Paint Booth 2') THEN 'PAINT'::"BayType" END;
DO $$ DECLARE bad text; BEGIN SELECT string_agg(id, ', ' ORDER BY id) INTO bad FROM bays WHERE "bayType" IS NULL; IF bad IS NOT NULL THEN RAISE EXCEPTION 'Unclassified bay IDs: %',bad; END IF; END $$;
ALTER TABLE bays ALTER COLUMN "bayType" SET NOT NULL;
CREATE TABLE bay_type_queues ("queueCode" TEXT NOT NULL, "bayType" "BayType" NOT NULL, CONSTRAINT bay_type_queues_pkey PRIMARY KEY ("queueCode"));
INSERT INTO bay_type_queues VALUES ('WASH','WASH'),('DETAILING_COATING','DETAILING'),('TINT_PPF','DETAILING'),('REPAINT','PAINT');
ALTER TABLE bay_type_queues ADD CONSTRAINT "bay_type_queues_queueCode_fkey" FOREIGN KEY ("queueCode") REFERENCES booking_queues(code) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE bay_occupancies ("bookingId" TEXT NOT NULL,"bayId" TEXT NOT NULL,date DATE NOT NULL,"assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"assignedByStaffId" TEXT NOT NULL,
 CONSTRAINT bay_occupancies_pkey PRIMARY KEY ("bookingId"), CONSTRAINT "bay_occupancies_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "bay_occupancies_bayId_fkey" FOREIGN KEY ("bayId") REFERENCES bays(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "bay_occupancies_assignedByStaffId_fkey" FOREIGN KEY ("assignedByStaffId") REFERENCES staff(id) ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "bay_occupancies_bayId_key" ON bay_occupancies("bayId");
CREATE TABLE booking_worker_assignments ("bookingId" TEXT NOT NULL,"staffId" TEXT NOT NULL,"assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"assignedByStaffId" TEXT NOT NULL,
 CONSTRAINT booking_worker_assignments_pkey PRIMARY KEY ("bookingId","staffId"),
 CONSTRAINT "booking_worker_assignments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "booking_worker_assignments_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES staff(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "booking_worker_assignments_assignedByStaffId_fkey" FOREIGN KEY ("assignedByStaffId") REFERENCES staff(id) ON DELETE RESTRICT ON UPDATE CASCADE);
ALTER TABLE booking_audit_events ADD COLUMN "targetStaffId" TEXT, ADD COLUMN "previousBayType" "BayType", ADD COLUMN "newBayType" "BayType",
 ADD CONSTRAINT "booking_audit_events_targetStaffId_fkey" FOREIGN KEY ("targetStaffId") REFERENCES staff(id) ON DELETE RESTRICT ON UPDATE CASCADE;
-- Retain every historical row. Multiple distinct bays for an open job need explicit classification.
DO $$ DECLARE bad text; BEGIN SELECT string_agg(x."bookingId", ', ') INTO bad FROM (SELECT a."bookingId" FROM booking_bay_assignments a JOIN bookings b ON b.id=a."bookingId" WHERE b.status IN ('PENDING','CONFIRMED','IN_PROGRESS') GROUP BY a."bookingId" HAVING count(DISTINCT a."bayId")>1) x; IF bad IS NOT NULL THEN RAISE EXCEPTION 'Ambiguous open bay assignments: %',bad; END IF; END $$;
INSERT INTO bay_occupancies SELECT DISTINCT ON (a."bookingId") a."bookingId",a."bayId",a.date,a."assignedAt",a."assignedByStaffId" FROM booking_bay_assignments a JOIN bookings b ON b.id=a."bookingId" WHERE b.status IN ('PENDING','CONFIRMED','IN_PROGRESS') ORDER BY a."bookingId",a.date DESC;
-- Every relevant writer takes the existing shop lock, including direct SQL/maintenance paths.
CREATE FUNCTION lock_bay_board() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN PERFORM pg_advisory_xact_lock(746001,1); RETURN COALESCE(NEW,OLD); END $$;
CREATE TRIGGER board_booking_lock BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION lock_bay_board();
CREATE TRIGGER board_bay_lock BEFORE INSERT OR UPDATE OR DELETE ON bays FOR EACH ROW EXECUTE FUNCTION lock_bay_board();
CREATE TRIGGER board_mapping_lock BEFORE INSERT OR UPDATE OR DELETE ON bay_type_queues FOR EACH ROW EXECUTE FUNCTION lock_bay_board();
CREATE TRIGGER board_history_lock BEFORE INSERT OR UPDATE OR DELETE ON booking_bay_assignments FOR EACH ROW EXECUTE FUNCTION lock_bay_board();
CREATE FUNCTION validate_bay_board() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.bay_type_queues m LEFT JOIN public.booking_queues q ON q.code=m."queueCode" WHERE q.code IS NULL) THEN RAISE EXCEPTION 'Unknown mapped queue'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_bay_assignments a JOIN public.bookings b ON b.id=a."bookingId" JOIN public.bays y ON y.id=a."bayId" LEFT JOIN public.bay_type_queues m ON m."queueCode"=b."queueCode" AND m."bayType"=y."bayType" WHERE m."queueCode" IS NULL) THEN RAISE EXCEPTION 'Bay type does not take this queue'; END IF;
 IF EXISTS(SELECT 1 FROM public.bay_occupancies a JOIN public.bookings b ON b.id=a."bookingId" JOIN public.bays y ON y.id=a."bayId" LEFT JOIN public.bay_type_queues m ON m."queueCode"=b."queueCode" AND m."bayType"=y."bayType" WHERE m."queueCode" IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') OR a.date<b."bookingDate") THEN RAISE EXCEPTION 'Invalid open bay occupancy or queue type'; END IF;
 RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER board_integrity AFTER INSERT OR UPDATE OR DELETE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_bay_board();
CREATE CONSTRAINT TRIGGER board_integrity AFTER INSERT OR UPDATE OR DELETE ON bays DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_bay_board();
CREATE CONSTRAINT TRIGGER board_integrity AFTER INSERT OR UPDATE OR DELETE ON bay_type_queues DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_bay_board();
CREATE CONSTRAINT TRIGGER board_integrity AFTER INSERT OR UPDATE OR DELETE ON booking_bay_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_bay_board();
CREATE CONSTRAINT TRIGGER board_integrity AFTER INSERT OR UPDATE OR DELETE ON bay_occupancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_bay_board();
-- Validate upgrade before enabling runtime writes, with IDs intact.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM booking_bay_assignments a JOIN bookings b ON b.id=a."bookingId" JOIN bays y ON y.id=a."bayId" LEFT JOIN bay_type_queues m ON m."queueCode"=b."queueCode" AND m."bayType"=y."bayType" WHERE m."queueCode" IS NULL) THEN RAISE EXCEPTION 'Incompatible historical bay assignment; classify before upgrade'; END IF; END $$;
CREATE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ DECLARE b public.bookings; BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Board relations are insert/delete only'; END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=OLD."bookingId" AND "snapshotVersion"::text='QUEUE_V3' AND status IN ('PENDING','CONFIRMED','IN_PROGRESS')) THEN RAISE EXCEPTION 'Closed worker history cannot be changed'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
 IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN RAISE EXCEPTION 'Assign only open day-queue bookings'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN RAISE EXCEPTION 'ADMIN assignment required'; END IF;
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active worker'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active bay'; END IF;
 END IF;
 NEW."assignedAt":=CURRENT_TIMESTAMP; RETURN NEW; END $$;
CREATE FUNCTION check_board_relation_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r record; cur int; start text; act text; target text; valid boolean; BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id=r."bookingId";
 start:=current_setting('zeus_rev.b'||replace(r."bookingId",'-','_'),true);
 IF coalesce(start,'')='' OR cur<>start::int+1 THEN RAISE EXCEPTION 'Board relation needs one booking revision bump and audit'; END IF;
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  act:=CASE WHEN TG_OP='INSERT' THEN 'WORKER_ASSIGNED' ELSE 'WORKER_UNASSIGNED' END; target:=r."staffId";
  SELECT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId" WHERE e.action::text=act AND e."targetStaffId"=target AND e."bookingId"=r."bookingId" AND e."txId"=txid_current() AND e."fromRevision"=start::int AND e."toRevision"=cur AND s."isActive" AND s.role IN ('ADMIN','MANAGER') AND (TG_OP='DELETE' OR e."actorStaffId"=r."assignedByStaffId")) INTO valid;
 ELSE
  act:=CASE WHEN TG_OP='INSERT' THEN 'BAY_ASSIGNED' ELSE 'BAY_UNASSIGNED' END;
  SELECT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId" WHERE e.action::text=act AND e."bayId"=r."bayId" AND e."bookingId"=r."bookingId" AND e."txId"=txid_current() AND e."fromRevision"=start::int AND e."toRevision"=cur AND s."isActive" AND (TG_OP='DELETE' OR e."actorStaffId"=r."assignedByStaffId") AND (CASE WHEN TG_OP='INSERT' THEN e."toDate"=r.date ELSE e."fromDate"=r.date END) AND (s.role IN ('ADMIN','MANAGER') OR (TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.bookings finished WHERE finished.id=r."bookingId" AND finished.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=finished.id AND l."removedAt" IS NULL AND l."workStatus"<>'DONE')) AND EXISTS(SELECT 1 FROM public.booking_audit_events done WHERE done."txId"=txid_current() AND done."bookingId"=r."bookingId" AND done.action::text='STATUS_CHANGED' AND done."toStatus"='COMPLETED' AND done."actorStaffId"=e."actorStaffId" AND done."toRevision"=cur)))) INTO valid;
 END IF;
 IF NOT valid THEN RAISE EXCEPTION 'Board relation needs matching same-transaction actor/target audit'; END IF;
 RETURN NULL; END $$;
CREATE TRIGGER board_relation_rules BEFORE INSERT OR UPDATE OR DELETE ON bay_occupancies FOR EACH ROW EXECUTE FUNCTION guard_board_relation();
CREATE CONSTRAINT TRIGGER board_relation_audit AFTER INSERT OR DELETE ON bay_occupancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_board_relation_audit();
CREATE TRIGGER board_relation_no_truncate BEFORE TRUNCATE ON bay_occupancies FOR EACH STATEMENT EXECUTE FUNCTION reject_booking_audit_change();
CREATE TRIGGER board_relation_rules BEFORE INSERT OR UPDATE OR DELETE ON booking_worker_assignments FOR EACH ROW EXECUTE FUNCTION guard_board_relation();
CREATE CONSTRAINT TRIGGER board_relation_audit AFTER INSERT OR DELETE ON booking_worker_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_board_relation_audit();
CREATE TRIGGER board_relation_no_truncate BEFORE TRUNCATE ON booking_worker_assignments FOR EACH STATEMENT EXECUTE FUNCTION reject_booking_audit_change();
ALTER TABLE booking_audit_events DROP CONSTRAINT booking_audit_shape;
ALTER TABLE booking_audit_events ADD CONSTRAINT booking_audit_shape CHECK (COALESCE(
  (reason IS NULL OR length(reason) BETWEEN 1 AND 500) AND ("requestId" IS NULL OR length("requestId") BETWEEN 1 AND 100)
  AND (("fromRevision" IS NULL AND "toRevision" IS NULL) OR ("fromRevision" >= 1 AND "toRevision" = "fromRevision" + 1))
  AND ("fromQueueCode" IS NULL OR "fromQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$') AND ("toQueueCode" IS NULL OR "toQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$')
  AND ("fromPosition" IS NULL OR "fromPosition" >= 1) AND ("toPosition" IS NULL OR "toPosition" >= 1)
  AND ("previousPriceCentavos" IS NULL OR "previousPriceCentavos" BETWEEN 0 AND 100000000) AND ("newPriceCentavos" IS NULL OR "newPriceCentavos" BETWEEN 0 AND 100000000)
  AND ("previousCap" IS NULL OR "previousCap" BETWEEN 0 AND 500) AND ("newCap" IS NULL OR "newCap" BETWEEN 0 AND 500)
  AND ("phoneDigest" IS NULL OR "phoneDigest" ~ '^[a-f0-9]{64}$') AND ("resultCount" IS NULL OR "resultCount" >= 0)
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
    ELSE false END, false));
-- Owner defaults (including PUBLIC) must not widen these exact runtime grants.
REVOKE ALL ON bay_type_queues,bay_occupancies,booking_worker_assignments FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 REVOKE ALL ON bay_type_queues,bay_occupancies,booking_worker_assignments FROM zeus_app;
 GRANT SELECT (id,name,role,"isActive") ON staff TO zeus_app;
 GRANT SELECT ON bay_type_queues TO zeus_app;
 GRANT SELECT,INSERT,DELETE ON bay_occupancies,booking_worker_assignments TO zeus_app;
 GRANT UPDATE ("bayType") ON bays TO zeus_app;
 END IF; END $$;

COMMIT;
