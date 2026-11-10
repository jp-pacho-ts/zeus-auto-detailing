-- 20261112090000_service_commission_and_coating_deduction
-- 1. Add commissionRateBp column to services table so each service can have its own commission percentage.
-- 2. Update admin_service_list, admin_service_update, and admin_service_create to support service commission rates.
-- 3. Automatically deduct 1,500 pesos (150,000 centavos) from the coating base price in commission_accrue.
-- 4. Apply the service's custom commission rate (falling back to staff personal rate or shop default).

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS "commissionRateBp" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_commission_rate_range'
  ) THEN
    ALTER TABLE public.services ADD CONSTRAINT "services_commission_rate_range" CHECK ("commissionRateBp" IS NULL OR "commissionRateBp" BETWEEN 0 AND 10000);
  END IF;
END $$;

-- Update admin_service_list to return commissionRateBp
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
      'commissionRateBp', s."commissionRateBp",
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

-- Update admin_service_update to persist commissionRateBp
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

-- Update admin_service_create to accept commissionRateBp
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

-- Update commission_accrue:
-- 1. Deducts 150,000 centavos (₱1,500) for coating product costs from the coating base.
-- 2. Respects the service's custom commissionRateBp.
CREATE OR REPLACE FUNCTION commission_accrue(p_booking text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  total bigint;
  unpriced integer;
  eligible integer;
  default_bp integer;
  svc_rate integer;
  ids text[];
  rates integer[];
  n integer;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id = p_booking;
 IF NOT FOUND OR b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN RETURN 0; END IF;
 SELECT "defaultRateBp" INTO default_bp FROM public.commission_settings WHERE id = 1;
 IF default_bp IS NULL THEN RAISE EXCEPTION 'The commission settings row is missing' USING ERRCODE = 'ZC006'; END IF;

 -- Look up custom commission rate for the booking's primary service:
 SELECT sv."commissionRateBp" INTO svc_rate FROM public.services sv WHERE sv.id = b."serviceId";

 -- The base is the price of the lines that earn commission (commission_earns_on OR explicit service commissionRateBp).
 -- Coating packages (CERAMIC_COATING / GRAPHENE): technician commission base is pegged to the IGC Eclipse Graphene price
 -- for that vehicle category, less ₱1,500 (150,000 centavos) chemical deduction, minus any client discount given below the original catalog price.
 SELECT COALESCE(sum(
          CASE
            WHEN sv.category = 'CERAMIC_COATING' AND EXISTS(
              SELECT 1 FROM public.catalog_service_versions v WHERE v."releaseId" = l."releaseId" AND v."serviceId" = l."serviceId" AND v."group" = 'GRAPHENE'
            ) THEN COALESCE(
              (
                SELECT GREATEST(0,
                  COALESCE(
                    GREATEST(0, o."unitPriceCentavos" - 150000) - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                    GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - 150000)
                  )
                )
                FROM public.catalog_service_versions ev
                JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                LIMIT 1
              ),
              GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - 150000)
            )
            ELSE COALESCE(l."staffPriceCentavos", l."subtotalCentavos")
          END
        ) FILTER (WHERE public.commission_earns_on(sv.category) OR sv."commissionRateBp" > 0), 0)::bigint,
        count(*) FILTER (WHERE (public.commission_earns_on(sv.category) OR sv."commissionRateBp" > 0) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
        count(*) FILTER (WHERE public.commission_earns_on(sv.category) OR sv."commissionRateBp" > 0)::integer
   INTO total, unpriced, eligible
   FROM public.booking_line_items l JOIN public.services sv ON sv.id = l."serviceId" WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL;

 IF total > 1000000000000 THEN RAISE EXCEPTION 'The service total is above the supported commission range' USING ERRCODE = 'ZC006'; END IF;

 IF eligible > 0 THEN
  SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"), array_agg(COALESCE(svc_rate, s."commissionRateBp", default_bp) ORDER BY w."assignedAt", w."staffId")
    INTO ids, rates FROM public.booking_worker_assignments w JOIN public.staff s ON s.id = w."staffId" WHERE w."bookingId" = p_booking;
 END IF;
 n := COALESCE(array_length(ids, 1), 0);
 INSERT INTO public.commission_accruals ("bookingId", "serviceTotalCentavos", "eligibleLineCount", "unpricedLineCount", "creditedCount", "completedOn")
   VALUES (p_booking, total, eligible, unpriced, n, (COALESCE(b."terminalAt", now()) AT TIME ZONE 'Asia/Manila')::date);
 IF n > 0 THEN
  INSERT INTO public.commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos")
   SELECT p_booking, ids[x.idx], x.idx, x.share_centavos, rates[x.idx], x.amount_centavos FROM public.commission_split(total, rates) x;
 END IF;
 PERFORM public.commission_consistency_check(p_booking);
 INSERT INTO public.admin_audit_events (action, "bookingId", "entryCount") VALUES ('COMMISSION_ACCRUED', p_booking, n);
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION admin_service_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_update(text, text, text, text, text, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION commission_accrue(text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_service_list(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_update(text, text, text, text, text, jsonb, int) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_create(text, text, text, text, text, text, jsonb, int) TO zeus_app;
    GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app;
  END IF;
END $$;
