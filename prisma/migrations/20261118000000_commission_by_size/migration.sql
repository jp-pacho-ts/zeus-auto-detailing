-- Commission per car size (LE 2026-11-12). A service's commission can now be a percentage per size or a fixed peso amount per
-- size, besides the shop default, no commission, or one percentage for every size. services."commissionMode" NULL keeps the
-- old meaning of "commissionRateBp" exactly, so every existing service and every finished booking is unchanged.
ALTER TABLE public.services ADD COLUMN "commissionMode" text NULL
  CONSTRAINT services_commission_mode CHECK ("commissionMode" IS NULL OR "commissionMode" IN ('SIZE_PERCENT', 'SIZE_FIXED'));
CREATE TABLE public.service_size_commissions (
  "serviceId" text NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  "sizeCode" text NOT NULL CHECK ("sizeCode" IN ('MOTOR', 'S', 'M', 'L', 'XL')),
  "rateBp" integer NULL CHECK ("rateBp" IS NULL OR "rateBp" BETWEEN 0 AND 10000),
  "fixedCentavos" bigint NULL CHECK ("fixedCentavos" IS NULL OR "fixedCentavos" BETWEEN 0 AND 100000000),
  PRIMARY KEY ("serviceId", "sizeCode")
);
REVOKE ALL ON public.service_size_commissions FROM PUBLIC;

-- Whether a service earns commission on a car of this size. The accrual and the Commissions screen both use it.
CREATE OR REPLACE FUNCTION commission_line_eligible(p_service text, p_size text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE sv."commissionMode"
           WHEN 'SIZE_PERCENT' THEN COALESCE(c."rateBp", 0) > 0
           WHEN 'SIZE_FIXED' THEN COALESCE(c."fixedCentavos", 0) > 0
           ELSE (sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR COALESCE(sv."commissionRateBp", 0) > 0
         END
    FROM public.services sv
    LEFT JOIN public.service_size_commissions c ON c."serviceId" = sv.id AND c."sizeCode" = p_size
   WHERE sv.id = p_service
$$;
REVOKE ALL ON FUNCTION commission_line_eligible(text, text) FROM PUBLIC;

-- Admin -> Services: the per-size mode and amounts, written after admin_service_create or admin_service_update in the same
-- transaction. p_mode NULL clears the per-size setting (the service then uses "commissionRateBp" as before).
CREATE OR REPLACE FUNCTION admin_service_set_size_commissions(p_actor text, p_service_id text, p_mode text, p_sizes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE id = p_service_id) THEN RAISE EXCEPTION 'Service not found' USING ERRCODE = 'ZT001'; END IF;
  UPDATE public.services SET "commissionMode" = p_mode WHERE id = p_service_id;
  DELETE FROM public.service_size_commissions WHERE "serviceId" = p_service_id;
  IF p_mode IS NOT NULL THEN
    INSERT INTO public.service_size_commissions ("serviceId", "sizeCode", "rateBp", "fixedCentavos")
    SELECT p_service_id, e->>'sizeCode',
           CASE WHEN p_mode = 'SIZE_PERCENT' THEN COALESCE((e->>'rateBp')::int, 0) END,
           CASE WHEN p_mode = 'SIZE_FIXED' THEN COALESCE((e->>'fixedCentavos')::bigint, 0) END
      FROM jsonb_array_elements(COALESCE(p_sizes, '[]'::jsonb)) e;
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_service_set_size_commissions(text, text, text, jsonb) FROM PUBLIC;

-- 20261115000000_commission_recalculate with the per-size rules: a SIZE_PERCENT line earns its size's percentage of its price,
-- a SIZE_FIXED line earns its size's peso amount times the quantity (mixed into the worker's rate like the others, so it is
-- exact to within a few centavos), and eligibility comes from commission_line_eligible.
CREATE OR REPLACE FUNCTION commission_accrue(p_booking text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  total bigint;
  unpriced integer;
  eligible integer;
  default_bp integer;
  ids text[];
  rates integer[];
  existing_ids text[];
  n integer;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking;
  IF NOT FOUND OR b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN
    RETURN 0;
  END IF;

  SELECT "defaultRateBp" INTO default_bp FROM public.commission_settings WHERE id = 1;
  IF default_bp IS NULL THEN
    default_bp := 2000;
  END IF;


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
         ) FILTER (WHERE public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot")), 0)::bigint,
         count(*) FILTER (WHERE (public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot")) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
         count(*) FILTER (WHERE public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot"))::integer
    INTO total, unpriced, eligible
    FROM public.booking_line_items l
    JOIN public.services sv ON sv.id = l."serviceId"
   WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL;

  IF total > 1000000000000 THEN
    RAISE EXCEPTION 'The service total is above the supported commission range' USING ERRCODE = 'ZC006';
  END IF;

  IF eligible > 0 THEN
    -- Each service earns at its own rate (LE 2026-11-12): a worker's rate is the price-weighted mix of the line rates, where a
    -- line without a service rate uses the worker's rate, then the shop default. Rounded to a whole basis point, so the stored
    -- entries still pass commission_consistency_check. With a zero base every line weighs nothing: the worker's own rate.
    WITH lb AS (
      SELECT (CASE
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
           END)::bigint AS base, sv."commissionRateBp" AS rate, sv."commissionMode" AS mode, c."rateBp" AS size_rate,
             c."fixedCentavos" AS fixed, l.quantity AS qty
        FROM public.booking_line_items l
        JOIN public.services sv ON sv.id = l."serviceId"
        LEFT JOIN public.service_size_commissions c ON c."serviceId" = sv.id AND c."sizeCode" = b."vehicleSizeCodeSnapshot"
       WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL AND (public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot"))
    )
    SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"),
           array_agg(CASE WHEN total > 0 THEN LEAST(10000, GREATEST(0, round(
                  (SELECT sum(CASE lb.mode WHEN 'SIZE_FIXED' THEN COALESCE(lb.fixed, 0) * lb.qty * 10000
                                         WHEN 'SIZE_PERCENT' THEN lb.base * COALESCE(lb.size_rate, 0)
                                         ELSE lb.base * COALESCE(lb.rate, s."commissionRateBp", default_bp) END) FROM lb)::numeric / total)))::integer
                ELSE COALESCE(s."commissionRateBp", default_bp) END ORDER BY w."assignedAt", w."staffId")
      INTO ids, rates
      FROM public.booking_worker_assignments w
      JOIN public.staff s ON s.id = w."staffId"
     WHERE w."bookingId" = p_booking;
  END IF;
  n := COALESCE(array_length(ids, 1), 0);

  IF EXISTS (SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN
    SELECT array_agg(e."staffId" ORDER BY e."position")
      INTO existing_ids
      FROM public.commission_entries e
     WHERE e."bookingId" = p_booking;

    -- Already accrued for the exact same assigned workers
    IF existing_ids IS NOT DISTINCT FROM ids THEN
      RETURN 0;
    END IF;

    -- Never overwrite paid or manually adjusted commission entries
    IF EXISTS (
      SELECT 1 FROM public.commission_entries e
      WHERE e."bookingId" = p_booking
        AND (e."paidAt" IS NOT NULL OR EXISTS (SELECT 1 FROM public.commission_adjustments a WHERE a."entryId" = e.id))
    ) THEN
      RETURN 0;
    END IF;

    PERFORM set_config('zeus.allow_commission_reaccrue', 'on', true);
    DELETE FROM public.commission_entries WHERE "bookingId" = p_booking;
    DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
    PERFORM set_config('zeus.allow_commission_reaccrue', 'off', true);
  END IF;

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
REVOKE ALL ON FUNCTION commission_accrue(text) FROM PUBLIC;

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
      'commissionMode', s."commissionMode",
      'sizeCommissions', COALESCE((SELECT jsonb_agg(jsonb_build_object('sizeCode', c."sizeCode", 'rateBp', c."rateBp", 'fixedCentavos', c."fixedCentavos") ORDER BY c."sizeCode")
                                   FROM public.service_size_commissions c WHERE c."serviceId" = v."serviceId"), '[]'::jsonb),
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
            'pickupPriceCentavos', o."pickupPriceCentavos",
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
REVOKE ALL ON FUNCTION admin_service_list(text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_list(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_set_size_commissions(text, text, text, jsonb) TO zeus_app;
    GRANT EXECUTE ON FUNCTION commission_line_eligible(text, text) TO zeus_app;
  END IF;
END $$;
