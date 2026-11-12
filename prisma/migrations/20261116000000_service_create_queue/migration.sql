-- Admin -> Services "Add service" put every non-wash service in queue 'DETAIL', which no shop database has (the queues are WASH,
-- DETAILING_COATING, TINT_PPF and REPAINT), so creating any non-wash service failed on the queueCode foreign key. The new
-- service now joins the queue of its group. 20261112090000_service_commission_and_coating_deduction with only that line changed.
CREATE OR REPLACE FUNCTION admin_service_create(
  p_actor text,
  p_name text,
  p_description text,
  p_category text,
  p_type text,
  p_unit text,
  p_offers jsonb,
  p_commission_rate_bp int DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
  v_svc_id text;
  v_slug text;
  v_max_sort int;
  v_cat_group public."CatalogServiceGroup";
  v_svc_kind public."ServiceKind";
  v_svc_type public."CatalogServiceType";
  v_svc_unit public."PriceUnit";
  v_queue_code text;
  v_offer jsonb;
  v_size_code text;
  v_vc_id text;
  v_offer_id text;
  v_state public."OfferState";
  v_unit_price int;
  v_compare_at int;
  v_booking_mode public."CatalogBookingMode";
  v_plan_kind public."DurationKind";
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);

  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;
  IF v_rid IS NULL THEN
    RAISE EXCEPTION 'No active catalog head found';
  END IF;

  v_svc_id := gen_random_uuid()::text;
  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.services WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  END IF;

  v_cat_group := p_category::"CatalogServiceGroup";
  v_svc_type := p_type::"CatalogServiceType";
  v_svc_unit := p_unit::"PriceUnit";
  v_queue_code := CASE p_category WHEN 'WASH' THEN 'WASH' WHEN 'TINT' THEN 'TINT_PPF' WHEN 'PPF' THEN 'TINT_PPF' WHEN 'REPAINT' THEN 'REPAINT' ELSE 'DETAILING_COATING' END;

  v_svc_kind := CASE p_category
    WHEN 'WASH' THEN 'EXTERIOR_WASH_SEAL'::"ServiceKind"
    WHEN 'DETAILING' THEN 'INTERIOR_DETAILING'::"ServiceKind"
    WHEN 'GRAPHENE' THEN 'CERAMIC_COATING'::"ServiceKind"
    WHEN 'REPAINT' THEN 'PAINT_CORRECTION'::"ServiceKind"
    ELSE 'WINDOW_TINT_PPF'::"ServiceKind"
  END;

  SELECT COALESCE(max("sortOrder"), 0) + 1 INTO v_max_sort
  FROM public.catalog_service_versions
  WHERE "releaseId" = v_rid;

  INSERT INTO public.services (id, name, slug, description, category, "isActive", "commissionRateBp")
  VALUES (v_svc_id, p_name, v_slug, p_description, v_svc_kind, true, p_commission_rate_bp);

  INSERT INTO public.catalog_service_versions (
    "releaseId", "serviceId", slug, name, "sourceName", description,
    "group", type, unit, inclusions, "sortOrder", "queueCode", provenance
  ) VALUES (
    v_rid, v_svc_id, v_slug, p_name, p_name, p_description,
    v_cat_group, v_svc_type, v_svc_unit, ARRAY[]::text[], v_max_sort, v_queue_code,
    jsonb_build_object('source', 'admin_created', 'createdAt', CURRENT_TIMESTAMP)
  );

  FOR v_offer IN SELECT * FROM jsonb_array_elements(p_offers) LOOP
    v_size_code := v_offer->>'sizeCode';
    SELECT id INTO v_vc_id FROM public.vehicle_categories WHERE slug = v_size_code;
    IF v_vc_id IS NULL THEN
      CONTINUE;
    END IF;

    v_offer_id := gen_random_uuid()::text;
    v_state := (v_offer->>'state')::"OfferState";

    IF v_state = 'NOT_OFFERED' THEN
      v_unit_price := NULL;
      v_compare_at := NULL;
      v_booking_mode := 'QUOTE_REQUIRED';
      v_plan_kind := 'UNKNOWN';
    ELSIF v_state = 'OFFERED' THEN
      v_unit_price := (v_offer->>'unitPriceCentavos')::int;
      v_compare_at := (v_offer->>'compareAtCentavos')::int;
      IF v_svc_type = 'BASE' AND v_svc_unit = 'VEHICLE' AND v_unit_price IS NOT NULL THEN
        v_booking_mode := 'FIXED_ONLINE';
        v_plan_kind := 'TIMED';
      ELSE
        v_booking_mode := 'QUOTE_REQUIRED';
        v_plan_kind := 'UNKNOWN';
      END IF;
    ELSE
      v_state := 'UNCONFIRMED';
      v_unit_price := (v_offer->>'unitPriceCentavos')::int;
      v_compare_at := (v_offer->>'compareAtCentavos')::int;
      v_booking_mode := 'QUOTE_REQUIRED';
      v_plan_kind := 'UNKNOWN';
    END IF;

    INSERT INTO public.service_size_offers (
      id, "releaseId", "serviceId", "vehicleCategoryId", "sizeCode",
      state, "bookingMode", "unitPriceCentavos", "compareAtCentavos"
    ) VALUES (
      v_offer_id, v_rid, v_svc_id, v_vc_id, v_size_code,
      v_state, v_booking_mode, v_unit_price, v_compare_at
    );

    INSERT INTO public.service_work_plans (
      "offerId", kind, "durationMinutes", "bayHoldPolicy"
    ) VALUES (
      v_offer_id, v_plan_kind, CASE WHEN v_plan_kind = 'TIMED' THEN 45 ELSE NULL END, 'UNCONFIRMED'
    );
  END LOOP;

  RETURN v_svc_id;
END $$;
REVOKE ALL ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb, int) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb, int) TO zeus_app;
  END IF;
END $$;
