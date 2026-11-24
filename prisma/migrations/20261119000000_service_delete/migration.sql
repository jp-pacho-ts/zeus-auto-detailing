-- Permanent removal is separate from deactivation. Never erase booking history,
-- recipes, compatibility rules, or service versions from other catalog releases.
CREATE FUNCTION admin_service_delete(p_actor text, p_service_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);
  IF EXISTS (SELECT 1 FROM public.staff WHERE id=p_actor AND "removedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Only an active admin can do this' USING ERRCODE='ZT004';
  END IF;
  IF p_service_id IS NULL OR btrim(p_service_id)='' THEN
    RAISE EXCEPTION 'Missing service' USING ERRCODE='ZT006';
  END IF;

  PERFORM 1 FROM public.services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE='ZT001';
  END IF;
  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId"=1;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE "serviceId"=p_service_id)
     OR EXISTS (SELECT 1 FROM public.booking_line_items WHERE "serviceId"=p_service_id)
     OR EXISTS (SELECT 1 FROM public.service_recipes WHERE "serviceId"=p_service_id)
     OR EXISTS (SELECT 1 FROM public.add_on_compatibility WHERE "baseServiceId"=p_service_id OR "addOnServiceId"=p_service_id)
     OR EXISTS (SELECT 1 FROM public.catalog_service_versions WHERE "serviceId"=p_service_id AND "releaseId" IS DISTINCT FROM v_rid) THEN
    RAISE EXCEPTION 'Service has linked records; deactivate it instead' USING ERRCODE='ZT003';
  END IF;

  -- The same narrowly scoped catalog-edit mechanism as the existing admin writers.
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);
  DELETE FROM public.catalog_hold_segments WHERE "offerId" IN (SELECT id FROM public.service_size_offers WHERE "serviceId"=p_service_id);
  DELETE FROM public.service_work_plans WHERE "offerId" IN (SELECT id FROM public.service_size_offers WHERE "serviceId"=p_service_id);
  DELETE FROM public.service_size_offers WHERE "serviceId"=p_service_id;
  DELETE FROM public.catalog_service_versions WHERE "serviceId"=p_service_id;
  DELETE FROM public.services WHERE id=p_service_id;
  -- service_size_commissions has ON DELETE CASCADE. All other FKs remain RESTRICT.
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'Service has linked records; deactivate it instead' USING ERRCODE='ZT003';
END $$;

REVOKE ALL ON FUNCTION admin_service_delete(text,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_service_delete(text,text) TO zeus_app;
  END IF;
END $$;
