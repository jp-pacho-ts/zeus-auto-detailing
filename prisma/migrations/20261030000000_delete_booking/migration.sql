BEGIN;
-- P1-29: an ADMIN can delete a booking. Narrow and additive; it relaxes protections only for one
-- audited path. The booking, its lines, bay/worker/deposit/customer-link/receipt rows go; the staff
-- audit trail stays untouched (no UPDATE or DELETE of audit rows is ever allowed) and gains one
-- BOOKING_DELETED row with no customer name, phone, email, vehicle or free text.
--
-- How it works
--  * delete_booking() is the only way in. It is SECURITY DEFINER, executable by zeus_app only; the
--    runtime role still has no DELETE on any of these tables.
--  * It takes the shop lock, requires an active ADMIN/MANAGER actor, the expected revision and the
--    typed reference code, writes the BOOKING_DELETED audit row, sets the transaction-local marker
--    zeus.deleting_booking, then deletes.
--  * The immutability triggers on the child tables keep rejecting every DELETE. Their DELETE
--    triggers are now separate and carry a WHEN clause that lets the delete through only when
--    booking_delete_authorised() is true: marker = that booking AND a BOOKING_DELETED audit row for
--    it exists in this same transaction. A marker alone, or an audit row alone, is not enough.
--  * booking_audit_events keeps its rows byte for byte. Its two foreign keys (bookingId, lineId) are
--    dropped so they can outlive the booking; the insert guard now checks existence instead.
--
-- Down steps (documented only; Prisma does not run them). Rows already deleted cannot return.
--   DROP FUNCTION delete_booking(text, text, integer, text);
--   DROP FUNCTION booking_delete_authorised(text);
--   for each of booking_line_items, booking_operations, booking_management_grants,
--     booking_management_sessions, bay_occupancies, booking_worker_assignments: DROP the
--     "*_delete" trigger and recreate the original combined trigger
--     (BEFORE UPDATE OR DELETE / BEFORE INSERT OR UPDATE OR DELETE / AFTER INSERT OR DELETE) from
--     migrations 20261018000000, 20261018130000 and 20261020000000;
--   restore guard_booking_audit_insert() from 20261018000000; restore booking_audit_shape from
--     20261022000000 (after deleting any BOOKING_DELETED rows is NOT possible: remove the check's
--     BOOKING_DELETED branch only once none exist, or leave the check as is);
--   ALTER TABLE booking_audit_events ADD CONSTRAINT booking_audit_events_bookingId_fkey FOREIGN KEY
--     ("bookingId") REFERENCES bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE, and the same for
--     "lineId" -> booking_line_items(id) (fails while audit rows of deleted bookings exist; keep the
--     FKs dropped in that case). The enum value and the "bookingReference" column stay.

ALTER TYPE "BookingAuditAction" ADD VALUE 'BOOKING_DELETED';
ALTER TABLE booking_audit_events ADD COLUMN "bookingReference" TEXT;
ALTER TABLE booking_audit_events DROP CONSTRAINT "booking_audit_events_bookingId_fkey", DROP CONSTRAINT "booking_audit_events_lineId_fkey";

-- The dropped keys are replaced by an insert-time check (same moment the old keys were enforced
-- for single-row inserts), so a new audit row still cannot name a booking or line that is absent.
CREATE OR REPLACE FUNCTION guard_booking_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Booking audit txId must be the inserting transaction'; END IF;
 IF NEW."bookingId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=NEW."bookingId") THEN RAISE EXCEPTION 'Booking audit names an unknown booking'; END IF;
 IF NEW."lineId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE id=NEW."lineId") THEN RAISE EXCEPTION 'Booking audit names an unknown line'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;

ALTER TABLE booking_audit_events DROP CONSTRAINT booking_audit_shape;
ALTER TABLE booking_audit_events ADD CONSTRAINT booking_audit_shape CHECK (COALESCE(
  (reason IS NULL OR length(reason) BETWEEN 1 AND 500) AND ("requestId" IS NULL OR length("requestId") BETWEEN 1 AND 100)
  AND (("fromRevision" IS NULL AND "toRevision" IS NULL) OR ("fromRevision" >= 1 AND "toRevision" = "fromRevision" + 1))
  AND ("fromQueueCode" IS NULL OR "fromQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$') AND ("toQueueCode" IS NULL OR "toQueueCode" ~ '^[A-Z][A-Z0-9_]{0,31}$')
  AND ("fromPosition" IS NULL OR "fromPosition" >= 1) AND ("toPosition" IS NULL OR "toPosition" >= 1)
  AND ("previousPriceCentavos" IS NULL OR "previousPriceCentavos" BETWEEN 0 AND 100000000) AND ("newPriceCentavos" IS NULL OR "newPriceCentavos" BETWEEN 0 AND 100000000)
  AND ("previousCap" IS NULL OR "previousCap" BETWEEN 0 AND 500) AND ("newCap" IS NULL OR "newCap" BETWEEN 0 AND 500)
  AND ("phoneDigest" IS NULL OR "phoneDigest" ~ '^[a-f0-9]{64}$') AND ("resultCount" IS NULL OR "resultCount" >= 0)
  AND (("bookingReference" IS NULL) OR (action::text='BOOKING_DELETED' AND "bookingReference" ~ '^[A-Za-z0-9-]{1,40}$'))
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
    WHEN 'BOOKING_DELETED' THEN "bookingId" IS NOT NULL AND "bookingReference" IS NOT NULL AND "fromStatus" IS NOT NULL AND "resultCount" IS NOT NULL AND reason IS NULL AND "phoneDigest" IS NULL AND "lineId" IS NULL
    ELSE false END, false));

CREATE FUNCTION booking_delete_authorised(bid text) RETURNS boolean LANGUAGE sql SET search_path=pg_catalog,public AS $$
 SELECT bid IS NOT NULL AND current_setting('zeus.deleting_booking', true) = bid
  AND EXISTS(SELECT 1 FROM public.booking_audit_events e WHERE e.action::text = 'BOOKING_DELETED' AND e."bookingId" = bid AND e."txId" = txid_current())
$$;

-- Split each combined trigger: UPDATE (and INSERT) rules are unchanged; DELETE is rejected unless
-- the delete-booking path is open for that booking.
DROP TRIGGER booking_line_change ON booking_line_items;
CREATE TRIGGER booking_line_change BEFORE UPDATE ON booking_line_items FOR EACH ROW EXECUTE FUNCTION guard_booking_line_change();
CREATE TRIGGER booking_line_delete BEFORE DELETE ON booking_line_items FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION guard_booking_line_change();

DROP TRIGGER booking_operation_immutable ON booking_operations;
CREATE TRIGGER booking_operation_immutable BEFORE UPDATE ON booking_operations FOR EACH ROW EXECUTE FUNCTION booking_operation_immutable();
CREATE TRIGGER booking_operation_delete BEFORE DELETE ON booking_operations FOR EACH ROW WHEN (OLD."bookingId" IS NULL OR NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION booking_operation_immutable();

DROP TRIGGER booking_management_immutable ON booking_management_grants;
CREATE TRIGGER booking_management_immutable BEFORE UPDATE ON booking_management_grants FOR EACH ROW EXECUTE FUNCTION booking_management_immutable();
CREATE TRIGGER booking_management_delete BEFORE DELETE ON booking_management_grants FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION booking_management_immutable();
DROP TRIGGER booking_management_immutable ON booking_management_sessions;
CREATE TRIGGER booking_management_immutable BEFORE UPDATE ON booking_management_sessions FOR EACH ROW EXECUTE FUNCTION booking_management_immutable();
CREATE TRIGGER booking_management_delete BEFORE DELETE ON booking_management_sessions FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION booking_management_immutable();

DROP TRIGGER board_relation_rules ON bay_occupancies;
CREATE TRIGGER board_relation_rules BEFORE INSERT OR UPDATE ON bay_occupancies FOR EACH ROW EXECUTE FUNCTION guard_board_relation();
CREATE TRIGGER board_relation_delete BEFORE DELETE ON bay_occupancies FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION guard_board_relation();
DROP TRIGGER board_relation_audit ON bay_occupancies;
CREATE CONSTRAINT TRIGGER board_relation_audit AFTER INSERT ON bay_occupancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_board_relation_audit();
CREATE CONSTRAINT TRIGGER board_relation_audit_delete AFTER DELETE ON bay_occupancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION check_board_relation_audit();

DROP TRIGGER board_relation_rules ON booking_worker_assignments;
CREATE TRIGGER board_relation_rules BEFORE INSERT OR UPDATE ON booking_worker_assignments FOR EACH ROW EXECUTE FUNCTION guard_board_relation();
CREATE TRIGGER board_relation_delete BEFORE DELETE ON booking_worker_assignments FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION guard_board_relation();
DROP TRIGGER board_relation_audit ON booking_worker_assignments;
CREATE CONSTRAINT TRIGGER board_relation_audit AFTER INSERT ON booking_worker_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_board_relation_audit();
CREATE CONSTRAINT TRIGGER board_relation_audit_delete AFTER DELETE ON booking_worker_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT booking_delete_authorised(OLD."bookingId")) EXECUTE FUNCTION check_board_relation_audit();

-- Error codes the service maps: ZD001 not found, ZD002 stale revision, ZD003 wrong reference,
-- ZD004 not an admin, ZD005 a legacy money record still points at the booking.
CREATE FUNCTION delete_booking(p_booking text, p_actor text, p_revision integer, p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.bookings; line_count integer; total bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
  RAISE EXCEPTION 'Only an admin can delete a booking' USING ERRCODE = 'ZD004';
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id = p_booking FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZD001'; END IF;
 IF b.revision <> p_revision THEN RAISE EXCEPTION 'Booking changed' USING ERRCODE = 'ZD002'; END IF;
 IF b."referenceCode" IS DISTINCT FROM p_reference THEN RAISE EXCEPTION 'Reference code does not match' USING ERRCODE = 'ZD003'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_assignments WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.commission_payouts WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.inventory_transactions WHERE "bookingId" = p_booking) THEN
  RAISE EXCEPTION 'A payout, assignment or stock record points at this booking' USING ERRCODE = 'ZD005';
 END IF;
 SELECT count(*), LEAST(sum(COALESCE("staffPriceCentavos", "subtotalCentavos")), 100000000) INTO line_count, total
   FROM public.booking_line_items WHERE "bookingId" = p_booking AND "removedAt" IS NULL;
 PERFORM set_config('zeus.deleting_booking', p_booking, true);
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
 DELETE FROM public.booking_line_items WHERE "bookingId" = p_booking;
 DELETE FROM public.bookings WHERE id = p_booking;
 PERFORM set_config('zeus.deleting_booking', '', true);
 RETURN jsonb_build_object('reference', b."referenceCode", 'status', b.status::text, 'lines', line_count);
END $$;
REVOKE ALL ON FUNCTION delete_booking(text, text, integer, text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 GRANT EXECUTE ON FUNCTION delete_booking(text, text, integer, text) TO zeus_app;
END IF; END $$;
COMMIT;
