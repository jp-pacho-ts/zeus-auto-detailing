-- Migration: 20261112040000_admin_services
-- Fix admin_user_update parameter type matching and provide admin catalog management procedures

-- 1. admin_user_update integer and bigint overloads
CREATE OR REPLACE FUNCTION admin_user_update(
  p_actor text, p_target_id text, p_name text, p_phone text, p_role text, p_is_active boolean, p_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_role public."StaffRole";
  s public.staff;
  actor_staff public.staff;
  v_other_admins integer;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_target_id IS NULL OR p_target_id = ''
     OR length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]'
     OR length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$'
     OR p_role IS NULL OR p_role NOT IN ('SUPERADMIN', 'ADMIN')
     OR p_is_active IS NULL OR p_revision IS NULL OR p_revision < 1 THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  v_role := p_role::public."StaffRole";

  SELECT * INTO actor_staff FROM public.staff WHERE id = p_actor;
  SELECT * INTO s FROM public.staff WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND OR s."removedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ZT001';
  END IF;

  IF s.revision <> p_revision THEN
    RAISE EXCEPTION 'User changed by someone else' USING ERRCODE = 'ZT002';
  END IF;

  -- Superadmin protection: non-superadmin cannot edit or deactivate a superadmin
  IF s.role = 'SUPERADMIN' AND actor_staff.role <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only a Super Admin can modify a Super Admin account' USING ERRCODE = 'ZT004';
  END IF;

  -- Superadmin cannot be deactivated
  IF s.role = 'SUPERADMIN' AND NOT p_is_active THEN
    RAISE EXCEPTION 'A Super Admin account cannot be deactivated' USING ERRCODE = 'ZT003';
  END IF;

  -- Self deactivation guard
  IF p_actor = p_target_id AND NOT p_is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = 'ZT008';
  END IF;

  -- Last admin/superadmin guard
  IF s.role IN ('ADMIN', 'SUPERADMIN') AND s."isActive" AND NOT p_is_active THEN
    SELECT count(*) INTO v_other_admins FROM public.staff
    WHERE role IN ('ADMIN', 'SUPERADMIN') AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'Cannot deactivate the last active admin' USING ERRCODE = 'ZT003';
    END IF;
  END IF;

  UPDATE public.staff
  SET name = v_name, phone = v_phone, role = v_role, "isActive" = p_is_active,
      revision = s.revision + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = p_target_id;

  IF NOT p_is_active THEN
    UPDATE public.staff_sessions
    SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED'
    WHERE "staffId" = p_target_id AND "revokedAt" IS NULL;
  END IF;

  INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId", "details")
  VALUES ('USER_UPDATED', p_actor, p_target_id, p_role || ':' || CASE WHEN p_is_active THEN 'active' ELSE 'inactive' END);

  RETURN jsonb_build_object('id', p_target_id, 'revision', s.revision + 1);
END $$;

CREATE OR REPLACE FUNCTION admin_user_update(
  p_actor text, p_target_id text, p_name text, p_phone text, p_role text, p_is_active boolean, p_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RETURN public.admin_user_update(p_actor, p_target_id, p_name, p_phone, p_role, p_is_active, p_revision::integer);
END $$;

-- 2. Allow compareAtCentavos in service_size_offers
ALTER TABLE public.service_size_offers DROP CONSTRAINT IF EXISTS catalog_offer_money;
ALTER TABLE public.service_size_offers ADD CONSTRAINT catalog_offer_money CHECK (
  ("unitPriceCentavos" IS NULL OR "unitPriceCentavos" BETWEEN 0 AND 100000000)
  AND ("sourceCompareAtCentavos" IS NULL OR "sourceCompareAtCentavos" BETWEEN 0 AND 100000000)
  AND ("compareAtCentavos" IS NULL OR "compareAtCentavos" BETWEEN 0 AND 100000000)
);

-- 3. Update guard_catalog_content trigger to allow session-authorized catalog updates
CREATE OR REPLACE FUNCTION guard_catalog_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE rid text; record_json jsonb;
BEGIN
 IF current_setting('zeus.allow_catalog_edit', true) = 'on' THEN
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 record_json:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='service_work_plans' OR TG_TABLE_NAME='catalog_hold_segments' THEN
  SELECT "releaseId" INTO rid FROM public.service_size_offers WHERE id=record_json->>'offerId';
 ELSE rid:=record_json->>'releaseId'; END IF;
 IF EXISTS(SELECT 1 FROM public.catalog_releases WHERE id=rid AND state<>'DRAFT') THEN RAISE EXCEPTION 'Published catalog content is immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME IN ('service_work_plans','catalog_hold_segments') THEN
   SELECT "releaseId" INTO rid FROM public.service_size_offers WHERE id=OLD."offerId";
  ELSE rid:=to_jsonb(OLD)->>'releaseId'; END IF;
  IF EXISTS(SELECT 1 FROM public.catalog_releases WHERE id=rid AND state<>'DRAFT') THEN RAISE EXCEPTION 'Published catalog content is immutable'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

-- 4. admin_service_list
CREATE OR REPLACE FUNCTION admin_service_list(p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
  v_sizes jsonb;
  v_services jsonb;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;
  IF v_rid IS NULL THEN
    RETURN jsonb_build_object('services', '[]'::jsonb, 'vehicleCategories', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', vc.id,
      'code', vc.slug,
      'name', vc.name,
      'sortOrder', vc."sortOrder"
    ) ORDER BY vc."sortOrder" ASC
  ) INTO v_sizes
  FROM public.vehicle_categories vc;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', v."serviceId",
      'slug', v.slug,
      'name', v.name,
      'description', v.description,
      'category', v."group",
      'type', v.type,
      'unit', v.unit,
      'inclusions', v.inclusions,
      'productName', v."productName",
      'hardness', v.hardness,
      'warrantyMonths', v."warrantyMonths",
      'referenceUnitPriceCentavos', v."referenceUnitPriceCentavos",
      'sortOrder', v."sortOrder",
      'isActive', COALESCE(s."isActive", true),
      'offers', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'vehicleCategoryId', o."vehicleCategoryId",
            'sizeCode', o."sizeCode",
            'state', o.state,
            'bookingMode', o."bookingMode",
            'unitPriceCentavos', o."unitPriceCentavos",
            'compareAtCentavos', o."compareAtCentavos",
            'durationMinutes', p."durationMinutes"
          ) ORDER BY vc."sortOrder" ASC
        )
        FROM public.service_size_offers o
        JOIN public.vehicle_categories vc ON vc.id = o."vehicleCategoryId"
        LEFT JOIN public.service_work_plans p ON p."offerId" = o.id
        WHERE o."releaseId" = v_rid AND o."serviceId" = v."serviceId"
      )
    ) ORDER BY v."sortOrder" ASC, v.slug ASC
  ) INTO v_services
  FROM public.catalog_service_versions v
  LEFT JOIN public.services s ON s.id = v."serviceId"
  WHERE v."releaseId" = v_rid;

  RETURN jsonb_build_object(
    'services', COALESCE(v_services, '[]'::jsonb),
    'vehicleCategories', COALESCE(v_sizes, '[]'::jsonb)
  );
END $$;

-- 5. admin_service_update
CREATE OR REPLACE FUNCTION admin_service_update(
  p_actor text,
  p_service_id text,
  p_name text,
  p_description text,
  p_category text,
  p_offers jsonb
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
      category = v_svc_kind
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

-- 6. admin_service_create
CREATE OR REPLACE FUNCTION admin_service_create(
  p_actor text,
  p_name text,
  p_description text,
  p_category text,
  p_type text,
  p_unit text,
  p_offers jsonb
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
  v_queue_code := CASE WHEN p_category = 'WASH' THEN 'WASH' ELSE 'DETAIL' END;

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

  INSERT INTO public.services (id, name, slug, description, category, "isActive")
  VALUES (v_svc_id, p_name, v_slug, p_description, v_svc_kind, true);

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

-- 7. admin_service_toggle_active
CREATE OR REPLACE FUNCTION admin_service_toggle_active(
  p_actor text,
  p_service_id text,
  p_active boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
  v_offer RECORD;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);

  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;

  UPDATE public.services
  SET "isActive" = p_active
  WHERE id = p_service_id;

  IF NOT p_active THEN
    UPDATE public.service_size_offers
    SET state = 'NOT_OFFERED',
        "bookingMode" = 'QUOTE_REQUIRED',
        "unitPriceCentavos" = NULL,
        "compareAtCentavos" = NULL
    WHERE "releaseId" = v_rid AND "serviceId" = p_service_id;

    FOR v_offer IN SELECT id FROM public.service_size_offers WHERE "releaseId" = v_rid AND "serviceId" = p_service_id LOOP
      UPDATE public.service_work_plans SET kind = 'UNKNOWN', "durationMinutes" = NULL WHERE "offerId" = v_offer.id;
    END LOOP;
  END IF;
END $$;

-- 8. Revoke from PUBLIC and grant to zeus_app
REVOKE ALL ON FUNCTION admin_user_update(text, text, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_update(text, text, text, text, text, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_update(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_toggle_active(text, text, boolean) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_user_update(text, text, text, text, text, boolean, integer) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_user_update(text, text, text, text, text, boolean, bigint) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_list(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_update(text, text, text, text, text, jsonb) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_toggle_active(text, text, boolean) TO zeus_app;
  END IF;
END $$;
