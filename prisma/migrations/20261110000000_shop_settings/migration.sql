BEGIN;
-- P1-42: Settings. EXPAND ONLY: two new tables and new functions. No existing object is touched, so the code that is live while this runs keeps
-- working and simply ignores them. Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then
-- prisma/sql/p1-42-readonly-check.sql, then the code. NEVER edit this file after it has been applied anywhere.
--
-- What it adds
--  * shop_settings: exactly one row (id = 1): the maintenance switch, the optional message customers see, and the booking pause. The row starts
--    live and open, so nothing changes for customers until the admin presses a switch.
--  * shop_settings_audit_events: an insert-only audit trail, one row per setting changed: who, which setting, the value before and after.
--    P1-37's admin_audit_events is not reused: its admin_audit_shape CHECK refuses any new action (ELSE false), and changing that would touch
--    a live money table. This is the same choice as P1-38 and P1-62.
--
-- How it is protected
--  * The runtime role (zeus_app) gets SELECT on shop_settings and NOTHING on the audit table. The one write is a SECURITY DEFINER function owned by
--    the migration owner (search_path pg_catalog, public, pg_temp with pg_temp LAST, every object schema-qualified), EXECUTE for zeus_app only;
--    PUBLIC is revoked HERE, not only in runtime-role.sql. The function requires an active ADMIN or MANAGER actor (admin_assert_actor, from P1-37).
--  * It takes the shop lock (746001, 1), the lock every booking create holds, so once a pause commits no later booking can slip past it.
--  * A retry after a lost response is the same values with the old revision: it returns "changed: false" BEFORE the revision check.
--
-- Error codes the service maps: ZT001 row missing, ZT002 stale revision, ZT006 invalid input, ZT004 not an admin (admin_assert_actor).
--
-- Down steps (documented only; Prisma does not run them). Audit rows already written go with the table.
--   DROP FUNCTION admin_shop_settings_set(text, integer, boolean, text, boolean), guard_shop_settings_audit_insert(), reject_shop_settings_audit_change();
--   DROP TABLE shop_settings_audit_events, shop_settings;

-- 1. The one row.
CREATE TABLE "shop_settings" (
  "id" SMALLINT NOT NULL,
  "maintenance" BOOLEAN NOT NULL DEFAULT false,
  "maintenanceMessage" TEXT,
  "bookingPaused" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByStaffId" TEXT,
  CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_settings_one_row" CHECK ("id" = 1),
  CONSTRAINT "shop_settings_revision" CHECK ("revision" >= 1),
  CONSTRAINT "shop_settings_message" CHECK ("maintenanceMessage" IS NULL OR (length("maintenanceMessage") BETWEEN 1 AND 200 AND "maintenanceMessage" = btrim("maintenanceMessage") AND "maintenanceMessage" !~ '[[:cntrl:]]'))
);
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "shop_settings" ("id") VALUES (1);

-- 2. The audit trail. Text columns, no foreign key on the setting: it outlives anything. Not a secret in it: the message is what customers read.
CREATE TABLE "shop_settings_audit_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action" TEXT NOT NULL DEFAULT 'SETTING_CHANGED',
  "actorStaffId" TEXT NOT NULL,
  "setting" TEXT NOT NULL,
  "previousValue" TEXT,
  "newValue" TEXT,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_settings_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_settings_audit_shape" CHECK ("action" = 'SETTING_CHANGED' AND "setting" IN ('maintenance', 'maintenance_message', 'booking_paused')
    AND ("previousValue" IS NULL OR length("previousValue") <= 200) AND ("newValue" IS NULL OR length("newValue") <= 200))
);
ALTER TABLE "shop_settings_audit_events" ADD CONSTRAINT "shop_settings_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "shop_settings_audit_events_createdAt_idx" ON "shop_settings_audit_events"("createdAt");

CREATE FUNCTION guard_shop_settings_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Settings audit txId must be the inserting transaction'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER shop_settings_audit_insert BEFORE INSERT ON shop_settings_audit_events FOR EACH ROW EXECUTE FUNCTION guard_shop_settings_audit_insert();
CREATE FUNCTION reject_shop_settings_audit_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Settings audit is append-only'; END $$;
CREATE TRIGGER shop_settings_audit_immutable BEFORE UPDATE OR DELETE ON shop_settings_audit_events FOR EACH ROW EXECUTE FUNCTION reject_shop_settings_audit_change();
CREATE TRIGGER shop_settings_audit_no_truncate BEFORE TRUNCATE ON shop_settings_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_shop_settings_audit_change();

-- 3. The one write. Every value is set each time; the screen sends the current values of the card it did not change.
CREATE FUNCTION admin_shop_settings_set(p_actor text, p_revision integer, p_maintenance boolean, p_message text, p_booking_paused boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.shop_settings;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_revision IS NULL OR p_revision < 1 OR p_maintenance IS NULL OR p_booking_paused IS NULL
    OR (p_message IS NOT NULL AND (length(p_message) NOT BETWEEN 1 AND 200 OR p_message <> btrim(p_message) OR p_message ~ '[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 SELECT * INTO s FROM public.shop_settings WHERE id = 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings not found' USING ERRCODE = 'ZT001'; END IF;
 -- Before the revision check: a retry after a lost response still carries the old revision.
 IF s.maintenance = p_maintenance AND s."bookingPaused" = p_booking_paused AND s."maintenanceMessage" IS NOT DISTINCT FROM p_message THEN
  RETURN jsonb_build_object('revision', s.revision, 'changed', false);
 END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Settings changed' USING ERRCODE = 'ZT002'; END IF;
 UPDATE public.shop_settings SET maintenance = p_maintenance, "maintenanceMessage" = p_message, "bookingPaused" = p_booking_paused,
   revision = s.revision + 1, "updatedAt" = CURRENT_TIMESTAMP, "updatedByStaffId" = p_actor WHERE id = 1;
 IF s.maintenance <> p_maintenance THEN
  INSERT INTO public.shop_settings_audit_events ("actorStaffId", setting, "previousValue", "newValue")
   VALUES (p_actor, 'maintenance', CASE WHEN s.maintenance THEN 'maintenance' ELSE 'live' END, CASE WHEN p_maintenance THEN 'maintenance' ELSE 'live' END);
 END IF;
 IF s."maintenanceMessage" IS DISTINCT FROM p_message THEN
  INSERT INTO public.shop_settings_audit_events ("actorStaffId", setting, "previousValue", "newValue") VALUES (p_actor, 'maintenance_message', s."maintenanceMessage", p_message);
 END IF;
 IF s."bookingPaused" <> p_booking_paused THEN
  INSERT INTO public.shop_settings_audit_events ("actorStaffId", setting, "previousValue", "newValue")
   VALUES (p_actor, 'booking_paused', CASE WHEN s."bookingPaused" THEN 'paused' ELSE 'open' END, CASE WHEN p_booking_paused THEN 'paused' ELSE 'open' END);
 END IF;
 RETURN jsonb_build_object('revision', s.revision + 1, 'changed', true);
END $$;

-- 4. Privileges. Closed to PUBLIC here (not only in runtime-role.sql): the migration runs first, with the old code live.
REVOKE ALL ON "shop_settings", "shop_settings_audit_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_shop_settings_set(text, integer, boolean, text, boolean), guard_shop_settings_audit_insert(), reject_shop_settings_audit_change() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "shop_settings", "shop_settings_audit_events" FROM zeus_app;
 GRANT SELECT ON "shop_settings" TO zeus_app;
 GRANT EXECUTE ON FUNCTION admin_shop_settings_set(text, integer, boolean, text, boolean) TO zeus_app;
END IF; END $$;
COMMIT;
