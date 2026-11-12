-- Tint add-ons (LE 2026-11-12): a sunroof tint is added to its film (Nexus NEX 80R, Choco Black, NEX 65) at a fixed price.
-- Until now an add-on could only attach to a wash, and only a base service could have a fixed online price, so an add-on was
-- always "for quote". Now a tint film may host add-ons, and a tint add-on with a price books at that price. Wash add-ons and
-- every other rule are unchanged; each function is its earlier text with only these conditions widened (and pg_temp last).
CREATE OR REPLACE FUNCTION guard_catalog_relations() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE p public.service_work_plans; s public.catalog_service_versions;
BEGIN
 IF TG_TABLE_NAME='service_size_offers' THEN
  IF NOT EXISTS(SELECT 1 FROM public.vehicle_categories WHERE id=NEW."vehicleCategoryId" AND slug=NEW."sizeCode") THEN RAISE EXCEPTION 'Offer size mismatch'; END IF;
 ELSIF TG_TABLE_NAME='service_work_plans' THEN
  SELECT v.* INTO s FROM public.service_size_offers o JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE o.id=NEW."offerId";
  IF EXISTS(SELECT 1 FROM public.service_size_offers WHERE id=NEW."offerId" AND "bookingMode"='FIXED_ONLINE') AND (NEW.kind<>'TIMED' OR NOT (s.type='BASE' OR (s.type='ADD_ON' AND s."group"='TINT')) OR s.unit<>'VEHICLE') THEN RAISE EXCEPTION 'Fixed offer requires known base-vehicle duration'; END IF;
  IF EXISTS(SELECT 1 FROM public.service_size_offers WHERE id=NEW."offerId" AND state='NOT_OFFERED') AND NEW.kind<>'UNKNOWN' THEN RAISE EXCEPTION 'Unavailable offer has no duration'; END IF;
 ELSIF TG_TABLE_NAME='catalog_hold_segments' THEN
  SELECT * INTO p FROM public.service_work_plans WHERE "offerId"=NEW."offerId";
  IF p.kind<>'MULTI_DAY' OR p."bayHoldPolicy"='UNCONFIRMED' OR (p."elapsedDays" IS NOT NULL AND NEW."dayOffset">=p."elapsedDays") THEN RAISE EXCEPTION 'Invalid hold plan'; END IF;
 ELSIF TG_TABLE_NAME='add_on_compatibility' THEN
  IF NOT EXISTS(SELECT 1 FROM public.catalog_service_versions WHERE "releaseId"=NEW."releaseId" AND "serviceId"=NEW."baseServiceId" AND type='BASE' AND "group" IN ('WASH', 'TINT')) OR NOT EXISTS(SELECT 1 FROM public.catalog_service_versions WHERE "releaseId"=NEW."releaseId" AND "serviceId"=NEW."addOnServiceId" AND type='ADD_ON') THEN RAISE EXCEPTION 'Invalid add-on relationship'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_catalog_offer_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE rid text;
BEGIN
 IF TG_TABLE_NAME='service_work_plans' THEN SELECT "releaseId" INTO rid FROM public.service_size_offers WHERE id=NEW."offerId"; ELSE rid:=NEW."releaseId"; END IF;
 IF EXISTS(SELECT 1 FROM public.service_size_offers o JOIN public.catalog_service_versions s ON s."releaseId"=o."releaseId" AND s."serviceId"=o."serviceId" LEFT JOIN public.service_work_plans p ON p."offerId"=o.id WHERE o."releaseId"=rid AND (p."offerId" IS NULL OR (o."bookingMode"='FIXED_ONLINE' AND (p.kind<>'TIMED' OR NOT (s.type='BASE' OR (s.type='ADD_ON' AND s."group"='TINT')) OR s.unit<>'VEHICLE')) OR (o.state='NOT_OFFERED' AND p.kind<>'UNKNOWN'))) THEN RAISE EXCEPTION 'Inconsistent offer/work plan'; END IF;
 RETURN NEW;
END $$;

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
      IF (v_svc_type = 'BASE' OR (v_svc_type = 'ADD_ON' AND p_category = 'TINT')) AND v_svc_unit = 'VEHICLE' AND v_unit_price IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION admin_service_update(
  p_actor text,
  p_service_id text,
  p_name text,
  p_description text,
  p_category text,
  p_offers jsonb,
  p_commission_rate_bp int DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
  v_offer jsonb;
  v_size_code text;
  v_unit_price int;
  v_compare_at int;
  v_state public."OfferState";
  v_svc_type public."CatalogServiceType";
  v_svc_unit public."PriceUnit";
  v_booking_mode public."CatalogBookingMode";
  v_plan_kind public."DurationKind";
  v_offer_id text;
  v_cat_group public."CatalogServiceGroup";
  v_svc_kind public."ServiceKind";
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);

  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;
  IF v_rid IS NULL THEN
    RAISE EXCEPTION 'No active catalog head found';
  END IF;

  v_cat_group := p_category::"CatalogServiceGroup";
  v_svc_kind := CASE p_category
    WHEN 'WASH' THEN 'EXTERIOR_WASH_SEAL'::"ServiceKind"
    WHEN 'DETAILING' THEN 'INTERIOR_DETAILING'::"ServiceKind"
    WHEN 'GRAPHENE' THEN 'CERAMIC_COATING'::"ServiceKind"
    WHEN 'REPAINT' THEN 'PAINT_CORRECTION'::"ServiceKind"
    ELSE 'WINDOW_TINT_PPF'::"ServiceKind"
  END;

  SELECT type, unit INTO v_svc_type, v_svc_unit
  FROM public.catalog_service_versions
  WHERE "releaseId" = v_rid AND "serviceId" = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found in active release';
  END IF;

  UPDATE public.catalog_service_versions
  SET name = p_name,
      description = p_description,
      "group" = v_cat_group
  WHERE "releaseId" = v_rid AND "serviceId" = p_service_id;

  UPDATE public.services
  SET name = p_name,
      description = p_description,
      category = v_svc_kind,
      "commissionRateBp" = p_commission_rate_bp
  WHERE id = p_service_id;

  FOR v_offer IN SELECT * FROM jsonb_array_elements(p_offers) LOOP
    v_size_code := v_offer->>'sizeCode';
    v_state := (v_offer->>'state')::"OfferState";
    
    IF v_state = 'NOT_OFFERED' THEN
      v_unit_price := NULL;
      v_compare_at := NULL;
      v_booking_mode := 'QUOTE_REQUIRED';
      v_plan_kind := 'UNKNOWN';
    ELSIF v_state = 'OFFERED' THEN
      v_unit_price := (v_offer->>'unitPriceCentavos')::int;
      v_compare_at := (v_offer->>'compareAtCentavos')::int;
      IF (v_svc_type = 'BASE' OR (v_svc_type = 'ADD_ON' AND p_category = 'TINT')) AND v_svc_unit = 'VEHICLE' AND v_unit_price IS NOT NULL THEN
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

    UPDATE public.service_size_offers
    SET state = v_state,
        "bookingMode" = v_booking_mode,
        "unitPriceCentavos" = v_unit_price,
        "compareAtCentavos" = v_compare_at
    WHERE "releaseId" = v_rid
      AND "serviceId" = p_service_id
      AND "sizeCode" = v_size_code
    RETURNING id INTO v_offer_id;

    IF v_offer_id IS NOT NULL THEN
      UPDATE public.service_work_plans
      SET kind = v_plan_kind,
          "durationMinutes" = CASE WHEN v_plan_kind = 'TIMED' THEN COALESCE("durationMinutes", 45) ELSE NULL END
      WHERE "offerId" = v_offer_id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION admin_service_update(text, text, text, text, text, jsonb, int) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb, int) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_update(text, text, text, text, text, jsonb, int) TO zeus_app;
  END IF;
END $$;
