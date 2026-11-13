-- P1-71 M1 (fix forward; no earlier migration is edited). Safe with the code that is live today, so it runs first:
--   1. admin_booking_update_details(…, bigint) (20261112100000) was a SECURITY DEFINER with no pinned search_path. It now pins
--      pg_catalog, public, pg_temp and calls the integer form by its schema.
--   2. guard_board_relation (CEO D-1, 2026-11-12): a name can still be ADDED to a completed day-queue booking (late attribution,
--      20261112120000), but a worker can no longer be REMOVED from one. P1-17's rule "closed worker history cannot be changed" is
--      back for deletes; delete_booking's own path is unaffected (its trigger skips the guard while the delete token exists).
--   3. delete_booking (20261112020000 re-created it from an older copy): the token it writes is removed again before it returns,
--      and it returns {reference, status, lines} again. SUPERADMIN stays an allowed actor.
--   4. The tokens that the broken delete_booking left behind are cleared. Each belongs to a committed transaction and can never
--      authorise anything again (booking_delete_authorised matches txid_current()); only the owner can touch the table.
--   5. P1-37 §8b re-run: later migrations re-created trigger functions with "pg_catalog, public", dropping pg_temp. The same
--      identifier-aware loop puts pg_temp last on every definer and on every function pinned to exactly "pg_catalog, public".
--   6. staff_payroll_adjustments (20261112080000) was writable by the runtime role. The app writes it only through
--      admin_payroll_save_adjustment and admin_payroll_set_paid (SECURITY DEFINER), so the role keeps SELECT only.
-- Run prisma/sql/p1-37-definer-inventory.sql (read-only) before it to see what step 5 will touch.
BEGIN;

-- 1.
CREATE OR REPLACE FUNCTION admin_booking_update_details(
  p_actor text,
  p_booking_id text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_vehicle_model text,
  p_vehicle_plate text,
  p_notes text,
  p_expected_revision bigint
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.admin_booking_update_details(
    p_actor, p_booking_id, p_customer_name, p_customer_phone, p_customer_email,
    p_vehicle_model, p_vehicle_plate, p_notes, p_expected_revision::integer
  );
$$;
REVOKE ALL ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, bigint) FROM PUBLIC;

-- 2.
CREATE OR REPLACE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  b public.bookings;
BEGIN
  PERFORM pg_advisory_xact_lock(746001,1);
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Board relations are insert/delete only';
  END IF;
  IF TG_OP='DELETE' THEN
    -- P1-17 / CEO D-1: a worker comes off an OPEN day-queue booking only. A completed job keeps its crew.
    IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(
      SELECT 1 FROM public.bookings
      WHERE id=OLD."bookingId"
        AND "snapshotVersion"::text='QUEUE_V3'
        AND status IN ('PENDING','CONFIRMED','IN_PROGRESS')
    ) THEN
      RAISE EXCEPTION 'Closed worker history cannot be changed';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
  IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' THEN
    RAISE EXCEPTION 'Assign only day-queue bookings';
  END IF;

  IF TG_TABLE_NAME='booking_worker_assignments' THEN
    -- Adding a name to a completed booking stays allowed (late commission attribution, 20261112120000).
    IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED') THEN
      RAISE EXCEPTION 'Assign only open or completed day-queue bookings';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
      RAISE EXCEPTION 'ADMIN assignment required';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN
      RAISE EXCEPTION 'Assign an active worker';
    END IF;
  ELSE
    IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
      RAISE EXCEPTION 'Assign only open day-queue bookings';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
      RAISE EXCEPTION 'ADMIN assignment required';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN
      RAISE EXCEPTION 'Assign an active bay';
    END IF;
  END IF;

  NEW."assignedAt":=CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

-- 3. The 20261105000000 body with SUPERADMIN added to the actor roles (20261112020000's intended change).
CREATE OR REPLACE FUNCTION delete_booking(p_booking text, p_actor text, p_revision integer, p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE b public.bookings; line_count integer; total bigint;
BEGIN
 -- Every input is required, before any lock or write (a NULL compares as unknown, never as different).
 IF p_booking IS NULL OR p_booking = '' OR p_actor IS NULL OR p_actor = '' OR p_revision IS NULL OR p_revision < 1 OR p_reference IS NULL OR p_reference = '' THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZD006';
 END IF;
 PERFORM pg_advisory_xact_lock(746001, 1);
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('SUPERADMIN','ADMIN','MANAGER')) THEN
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
 -- The 100,000,000 cap below is only the DISPLAY value of the existing audit column booking_audit_events."newPriceCentavos"
 -- (INTEGER, from P1-29). It is not an accounting figure; commission totals are bigint and never clipped (Codex F2).
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
 DELETE FROM public.booking_delete_tokens WHERE "txId" = txid_current() AND "bookingId" = p_booking;
 RETURN jsonb_build_object('reference', b."referenceCode", 'status', b.status::text, 'lines', line_count);
END $$;
REVOKE ALL ON FUNCTION delete_booking(text, text, integer, text) FROM PUBLIC;

-- 4. Tokens of committed transactions (this migration's own transaction has none).
DELETE FROM public.booking_delete_tokens WHERE "txId" <> txid_current();

-- 5. P1-37 §8b, unchanged (see 20261105000000_team_commissions for the full reasoning).
DO $$
DECLARE f record; cfg text; tokens text[]; kept text[]; newtokens text[]; changed integer := 0;
BEGIN
 FOR f IN
  SELECT p.oid::regprocedure AS sig, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proowner = (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user)
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  ORDER BY p.oid::regprocedure::text
 LOOP
  SELECT substr(c, 13) INTO cfg FROM unnest(COALESCE(f.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%' LIMIT 1;
  tokens := ARRAY(SELECT btrim(t.m[1]) FROM regexp_matches(COALESCE(cfg, ''), '((?:"(?:[^"]|"")*"|[^,"])+)', 'g') WITH ORDINALITY AS t(m, n)
                  WHERE btrim(t.m[1]) <> '' ORDER BY t.n);
  newtokens := NULL;
  IF f.prosecdef THEN
   IF cfg IS NULL THEN
    newtokens := ARRAY['pg_catalog', 'public', 'pg_temp'];
   ELSE
    kept := ARRAY(SELECT x FROM unnest(tokens) WITH ORDINALITY u(x, i) WHERE lower(x) <> 'pg_temp' AND x <> '""' ORDER BY i);
    newtokens := array_append(kept, 'pg_temp');
   END IF;
  ELSIF tokens = ARRAY['pg_catalog', 'public'] THEN
   newtokens := ARRAY['pg_catalog', 'public', 'pg_temp'];
  END IF;
  IF newtokens IS NOT NULL AND tokens IS DISTINCT FROM newtokens THEN
   EXECUTE format('ALTER FUNCTION %s SET search_path = %s', f.sig, array_to_string(newtokens, ', '));
   changed := changed + 1;
   RAISE NOTICE 'P1-71 8b: % % search_path "%" -> "%"', CASE WHEN f.prosecdef THEN 'SECURITY DEFINER' ELSE 'function' END, f.sig, COALESCE(cfg, '(none)'), array_to_string(newtokens, ', ');
  END IF;
 END LOOP;
 RAISE NOTICE 'P1-71 8b: % function(s) changed', changed;
END $$;

-- 6.
REVOKE ALL ON public.staff_payroll_adjustments FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    REVOKE ALL ON public.staff_payroll_adjustments FROM zeus_app;
    GRANT SELECT ON public.staff_payroll_adjustments TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, bigint), delete_booking(text, text, integer, text) TO zeus_app;
  END IF;
END $$;

COMMIT;
