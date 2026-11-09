-- P1-41c: Recognize SUPERADMIN across all admin triggers, audit checks, and procedures

-- 1. admin_assert_actor
CREATE OR REPLACE FUNCTION admin_assert_actor(p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF p_actor IS NULL OR p_actor = '' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only an admin can do this' USING ERRCODE = 'ZT004';
 END IF;
END $$;

-- 2. guard_board_relation
CREATE OR REPLACE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ DECLARE b public.bookings; BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Board relations are insert/delete only'; END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=OLD."bookingId" AND "snapshotVersion"::text='QUEUE_V3' AND status IN ('PENDING','CONFIRMED','IN_PROGRESS')) THEN RAISE EXCEPTION 'Closed worker history cannot be changed'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
 IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN RAISE EXCEPTION 'Assign only open day-queue bookings'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN RAISE EXCEPTION 'ADMIN assignment required'; END IF;
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active worker'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active bay'; END IF;
 END IF;
 NEW."assignedAt":=CURRENT_TIMESTAMP; RETURN NEW; END $$;

-- 3. check_board_relation_audit
CREATE OR REPLACE FUNCTION check_board_relation_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r record; cur int; start text; act text; target text; valid boolean; BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; ELSE r:=NEW; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id=r."bookingId";
 start:=current_setting('zeus_rev.b'||replace(r."bookingId",'-','_'),true);
 IF coalesce(start,'')='' OR cur<>start::int+1 THEN RAISE EXCEPTION 'Board relation needs one booking revision bump and audit'; END IF;
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  act:=CASE WHEN TG_OP='INSERT' THEN 'WORKER_ASSIGNED' ELSE 'WORKER_UNASSIGNED' END; target:=r."staffId";
  SELECT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId" WHERE e.action::text=act AND e."targetStaffId"=target AND e."bookingId"=r."bookingId" AND e."txId"=txid_current() AND e."fromRevision"=start::int AND e."toRevision"=cur AND s."isActive" AND s.role IN ('SUPERADMIN', 'ADMIN', 'MANAGER') AND (TG_OP='DELETE' OR e."actorStaffId"=r."assignedByStaffId")) INTO valid;
 ELSE
  act:=CASE WHEN TG_OP='INSERT' THEN 'BAY_ASSIGNED' ELSE 'BAY_UNASSIGNED' END;
  SELECT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId" WHERE e.action::text=act AND e."bayId"=r."bayId" AND e."bookingId"=r."bookingId" AND e."txId"=txid_current() AND e."fromRevision"=start::int AND e."toRevision"=cur AND s."isActive" AND (TG_OP='DELETE' OR e."actorStaffId"=r."assignedByStaffId") AND (CASE WHEN TG_OP='INSERT' THEN e."toDate"=r.date ELSE e."fromDate"=r.date END) AND (s.role IN ('SUPERADMIN', 'ADMIN', 'MANAGER') OR (TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.bookings finished WHERE finished.id=r."bookingId" AND finished.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=finished.id AND l."removedAt" IS NULL AND l."workStatus"<>'DONE')) AND EXISTS(SELECT 1 FROM public.booking_audit_events done WHERE done."txId"=txid_current() AND done."bookingId"=r."bookingId" AND done.action::text='STATUS_CHANGED' AND done."toStatus"='COMPLETED' AND done."actorStaffId"=e."actorStaffId" AND done."toRevision"=cur)))) INTO valid;
 END IF;
 IF NOT valid THEN RAISE EXCEPTION 'Board relation needs matching same-transaction actor/target audit'; END IF;
 RETURN NULL; END $$;

-- 4. check_deposit_status_change
CREATE OR REPLACE FUNCTION check_deposit_status_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE cur int; start text; BEGIN
 IF NEW."depositStatus"::text='NONE' THEN RAISE EXCEPTION 'Deposit status cannot return to NONE'; END IF;
 SELECT revision INTO cur FROM public.bookings WHERE id=NEW.id;
 start:=current_setting('zeus_rev.b'||replace(NEW.id,'-','_'),true);
 IF coalesce(start,'')='' OR cur<=start::int THEN RAISE EXCEPTION 'A deposit status change needs a new revision'; END IF;
 IF NEW."depositStatus"::text='REJECTED' AND NOT EXISTS(SELECT 1 FROM public.booking_deposit_proofs WHERE "bookingId"=NEW.id) THEN RAISE EXCEPTION 'REJECTED needs a deposit proof'; END IF;
 IF NEW."depositStatus"::text='PROOF_SENT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.booking_deposit_proofs WHERE "bookingId"=NEW.id AND "createdTxId"=txid_current()) THEN RAISE EXCEPTION 'PROOF_SENT needs a new deposit proof'; END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.booking_audit_events e JOIN public.staff s ON s.id=e."actorStaffId"
   WHERE e.action::text='DEPOSIT_STATUS_CHANGED' AND e."bookingId"=NEW.id AND e."txId"=txid_current()
   AND e."fromDepositStatus"=OLD."depositStatus" AND e."toDepositStatus"=NEW."depositStatus" AND e."toRevision"=cur
   AND s."isActive" AND s.role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'A deposit decision needs an ADMIN audit row';
 END IF;
 RETURN NULL; END $$;

-- 5. guard_booking_line_change
CREATE OR REPLACE FUNCTION guard_booking_line_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."staffPriceCentavos" IS NOT DISTINCT FROM OLD."staffPriceCentavos" THEN
  IF ROW(NEW."staffPriceSetAt", NEW."staffPriceSetByStaffId") IS DISTINCT FROM ROW(OLD."staffPriceSetAt", OLD."staffPriceSetByStaffId") THEN
   RAISE EXCEPTION 'A line price actor or time changes only with the price';
  END IF;
 ELSE
  NEW."staffPriceSetAt" := CURRENT_TIMESTAMP;
 END IF;
 IF NEW."workStatus" IS NOT DISTINCT FROM OLD."workStatus" THEN
  IF NEW."workStatusChangedAt" IS DISTINCT FROM OLD."workStatusChangedAt" THEN RAISE EXCEPTION 'A line status time changes only with the status'; END IF;
 ELSE
  NEW."workStatusChangedAt" := CURRENT_TIMESTAMP;
 END IF;
 IF OLD."removedAt" IS NULL AND NEW."removedAt" IS NOT NULL THEN NEW."removedAt" := CURRENT_TIMESTAMP; END IF;
 IF NEW."staffPriceCentavos" IS DISTINCT FROM OLD."staffPriceCentavos" AND NOT EXISTS(SELECT 1 FROM public.staff
    WHERE id = NEW."staffPriceSetByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only ADMIN sets a line price';
 END IF;
 RETURN NEW;
END $$;

-- 6. delete_booking
CREATE OR REPLACE FUNCTION delete_booking(p_booking text, p_actor text, p_revision integer, p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.bookings; line_count integer; total bigint;
BEGIN
 IF p_booking IS NULL OR p_booking = '' OR p_actor IS NULL OR p_actor = '' OR p_revision IS NULL OR p_revision < 1 OR p_reference IS NULL OR p_reference = '' THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZD006';
 END IF;
 PERFORM pg_advisory_xact_lock(746001, 1);
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only an admin can delete a booking' USING ERRCODE = 'ZD004';
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id = p_booking FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZD001'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Booking changed' USING ERRCODE = 'ZD002'; END IF;
 IF b."referenceCode" IS DISTINCT FROM p_reference THEN RAISE EXCEPTION 'Reference code does not match' USING ERRCODE = 'ZD003'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_assignments WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.commission_payouts WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.inventory_transactions WHERE "bookingId" = p_booking) THEN
  RAISE EXCEPTION 'A payout, assignment or stock record points at this booking' USING ERRCODE = 'ZD005';
 END IF;
 SELECT count(*), LEAST(sum(COALESCE("staffPriceCentavos", "subtotalCentavos")), 100000000) INTO line_count, total
   FROM public.booking_line_items WHERE "bookingId" = p_booking AND "removedAt" IS NULL;
 INSERT INTO public.booking_delete_tokens ("txId", "bookingId") VALUES (txid_current(), p_booking);
 INSERT INTO public.booking_audit_events (id, action, "actorStaffId", "bookingId", "queueCode", "fromStatus", "fromDate", "resultCount", "newPriceCentavos", "bookingReference")
   VALUES (gen_random_uuid()::text, 'BOOKING_DELETED', p_actor, p_booking, b."queueCode", b.status, b."bookingDate", line_count, total::integer, b."referenceCode");
 DELETE FROM public.booking_turnstile_uses WHERE "operationId" IN (SELECT id FROM public.booking_operations WHERE "bookingId" = p_booking);
 DELETE FROM public.booking_operations WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_management_sessions WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_management_grants WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_notification_outbox WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_deposit_proofs WHERE "bookingId" = p_booking;
 DELETE FROM public.bay_occupancies WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_worker_assignments WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_bay_assignments WHERE "bookingId" = p_booking;
 DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_line_items WHERE "bookingId" = p_booking;
 DELETE FROM public.bookings WHERE id = p_booking;
 RETURN jsonb_build_object('id', p_booking, 'deleted', true);
END $$;
