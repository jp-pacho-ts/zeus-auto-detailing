-- Migration: 20261112050000_fix_service_activation
-- Initialize active catalog services to isActive = true and make toggle_active purely manage services.isActive

-- 1. Initialize active catalog services to isActive = true
UPDATE public.services
SET "isActive" = true
WHERE id IN (
  SELECT "serviceId"
  FROM public.catalog_service_versions v
  JOIN public.catalog_head h ON h."releaseId" = v."releaseId"
  WHERE h."shopId" = 1
);

-- 2. Simplify admin_service_toggle_active so it toggles services.isActive cleanly without corrupting offers
CREATE OR REPLACE FUNCTION admin_service_toggle_active(
  p_actor text,
  p_service_id text,
  p_active boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);

  UPDATE public.services
  SET "isActive" = p_active
  WHERE id = p_service_id;
END $$;

REVOKE ALL ON FUNCTION admin_service_toggle_active(text, text, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_service_toggle_active(text, text, boolean) TO zeus_app;
  END IF;
END $$;
