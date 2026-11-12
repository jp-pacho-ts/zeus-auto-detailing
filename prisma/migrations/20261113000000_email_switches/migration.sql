-- Email on/off switches (LE 2026-11-12): an admin can turn one kind of email off from Settings without a deploy, e.g. if it
-- misbehaves. Provider keys and the sender stay in the server environment, never here. Same pattern as 20261110000000_shop_settings:
-- the app role reads the row; the one write is an owner-run function that checks the actor and revision and writes an audit row.
ALTER TABLE "shop_settings"
  ADD COLUMN "emailConfirmation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailReminder" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailCarReady" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "emailShopAlerts" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "shop_settings_audit_events" DROP CONSTRAINT "shop_settings_audit_shape";
ALTER TABLE "shop_settings_audit_events" ADD CONSTRAINT "shop_settings_audit_shape" CHECK ("action" = 'SETTING_CHANGED'
  AND "setting" IN ('maintenance', 'maintenance_message', 'booking_paused', 'email_confirmation', 'email_reminder', 'email_car_ready', 'email_shop_alerts')
  AND ("previousValue" IS NULL OR length("previousValue") <= 200) AND ("newValue" IS NULL OR length("newValue") <= 200));

CREATE FUNCTION admin_shop_email_set(p_actor text, p_revision integer, p_kind text, p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.shop_settings; current_value boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_revision IS NULL OR p_revision < 1 OR p_enabled IS NULL OR p_kind IS NULL OR p_kind NOT IN ('confirmation', 'reminder', 'car_ready', 'shop_alerts') THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 SELECT * INTO s FROM public.shop_settings WHERE id = 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings not found' USING ERRCODE = 'ZT001'; END IF;
 current_value := CASE p_kind WHEN 'confirmation' THEN s."emailConfirmation" WHEN 'reminder' THEN s."emailReminder"
   WHEN 'car_ready' THEN s."emailCarReady" ELSE s."emailShopAlerts" END;
 -- Before the revision check: a retry after a lost response still carries the old revision.
 IF current_value = p_enabled THEN RETURN jsonb_build_object('revision', s.revision, 'changed', false); END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Settings changed' USING ERRCODE = 'ZT002'; END IF;
 UPDATE public.shop_settings SET
   "emailConfirmation" = CASE WHEN p_kind = 'confirmation' THEN p_enabled ELSE "emailConfirmation" END,
   "emailReminder" = CASE WHEN p_kind = 'reminder' THEN p_enabled ELSE "emailReminder" END,
   "emailCarReady" = CASE WHEN p_kind = 'car_ready' THEN p_enabled ELSE "emailCarReady" END,
   "emailShopAlerts" = CASE WHEN p_kind = 'shop_alerts' THEN p_enabled ELSE "emailShopAlerts" END,
   revision = s.revision + 1, "updatedAt" = CURRENT_TIMESTAMP, "updatedByStaffId" = p_actor
 WHERE id = 1;
 INSERT INTO public.shop_settings_audit_events ("actorStaffId", setting, "previousValue", "newValue")
  VALUES (p_actor, 'email_' || p_kind, CASE WHEN current_value THEN 'on' ELSE 'off' END, CASE WHEN p_enabled THEN 'on' ELSE 'off' END);
 RETURN jsonb_build_object('revision', s.revision + 1, 'changed', true);
END $$;

REVOKE ALL ON FUNCTION admin_shop_email_set(text, integer, text, boolean) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 GRANT EXECUTE ON FUNCTION admin_shop_email_set(text, integer, text, boolean) TO zeus_app;
END IF; END $$;
