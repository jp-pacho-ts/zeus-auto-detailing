BEGIN;

CREATE TABLE public.booking_deduction_overrides (
  "lineId" text PRIMARY KEY,
  "amountCentavos" integer NOT NULL CHECK ("amountCentavos" BETWEEN 0 AND 100000000)
);
REVOKE ALL ON public.booking_deduction_overrides FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.service_cost_for_line(p_line text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE(o."amountCentavos", c."amountCentavos", s."expenseDeductionCentavos")
 FROM public.booking_line_items l
 JOIN public.services s ON s.id=l."serviceId"
 LEFT JOIN public.booking_deduction_overrides o ON o."lineId"=l.id
 LEFT JOIN public.service_cost_snapshots c ON c."lineId"=l.id
 WHERE l.id=p_line
$$;

-- Use the same percentage, size, Eclipse-reference, and rounding rules as accrual.
-- This helper only reads; it cannot rewrite a paid entry.
CREATE FUNCTION public.booking_deduction_calculate(p_booking text, p_line text, p_amount integer)
RETURNS TABLE(staff_id text, amount bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  total bigint;
  unpriced integer;
  eligible integer;
  default_bp integer;
  ids text[];
  rates integer[];
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id=p_booking;
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
                     GREATEST(0, o."unitPriceCentavos" - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END)) - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                     GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
                   )
                 )
                 FROM public.catalog_service_versions ev
                 JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                 LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                 WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                 LIMIT 1
               ),
               GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
             )
             ELSE GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
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
                     GREATEST(0, o."unitPriceCentavos" - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END)) - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                     GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
                   )
                 )
                 FROM public.catalog_service_versions ev
                 JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                 LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                 WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                 LIMIT 1
               ),
               GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
             )
             ELSE GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - (CASE WHEN l.id=p_line THEN p_amount ELSE public.service_cost_for_line(l.id) END))
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
  RETURN QUERY SELECT ids[x.idx], x.amount_centavos FROM public.commission_split(total, rates) x WHERE ids IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.booking_deduction_calculate(text,text,integer) FROM PUBLIC;

CREATE FUNCTION public.admin_booking_deduction_correct(p_actor text, p_booking text, p_line text, p_amount integer, p_expected text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rows jsonb;
  v_token text;
  v_old integer;
  v_row record;
BEGIN
  PERFORM pg_advisory_xact_lock(746001,1);
  PERFORM public.admin_assert_actor(p_actor);
  IF p_amount IS NULL OR p_amount NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Invalid deduction amount' USING ERRCODE='ZT006';
  END IF;
  PERFORM 1 FROM public.bookings WHERE id=p_booking AND status='COMPLETED' AND "snapshotVersion"='QUEUE_V3' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completed booking required' USING ERRCODE='ZC010'; END IF;
  PERFORM 1 FROM public.booking_line_items WHERE id=p_line AND "bookingId"=p_booking AND "removedAt" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service line not found' USING ERRCODE='ZT001'; END IF;
  v_old := public.service_cost_for_line(p_line);

  PERFORM 1 FROM public.commission_entries WHERE "bookingId"=p_booking ORDER BY id FOR UPDATE;

  WITH prior AS (SELECT * FROM public.booking_deduction_calculate(p_booking, p_line, v_old)),
       target AS (SELECT * FROM public.booking_deduction_calculate(p_booking, p_line, p_amount)),
       amounts AS (
    SELECT e.id AS "entryId", s.name, e."staffId", e.position,
           e."amountCentavos" + a.total AS "previousCentavos",
           CASE WHEN e."paidAt" IS NOT NULL THEN e."amountCentavos" ELSE 0 END + a.paid AS "paidCentavos",
           e."amountCentavos" + a.total + target.amount - prior.amount AS "correctedCentavos",
           target.amount - prior.amount AS "differenceCentavos"
    FROM public.commission_entries e
    JOIN public.staff s ON s.id=e."staffId"
    JOIN prior ON prior.staff_id=e."staffId"
    JOIN target ON target.staff_id=e."staffId"
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(d."amountCentavos"),0)::bigint AS total,
             COALESCE(sum(d."amountCentavos") FILTER (WHERE d."paidAt" IS NOT NULL),0)::bigint AS paid
      FROM public.commission_adjustments d WHERE d."entryId"=e.id
    ) a
    WHERE e."bookingId"=p_booking
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(amounts)-'position' ORDER BY position), '[]'::jsonb) INTO v_rows FROM amounts;
  IF jsonb_array_length(v_rows)=0 OR jsonb_array_length(v_rows) <> (
    SELECT count(*) FROM public.booking_worker_assignments WHERE "bookingId"=p_booking
  ) THEN
    RAISE EXCEPTION 'Recorded workers must match the assigned crew' USING ERRCODE='ZC012';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE (r->>'correctedCentavos')::bigint < 0) THEN
    RAISE EXCEPTION 'Correction would take commission below zero' USING ERRCODE='ZC006';
  END IF;
  v_token := md5(jsonb_build_array(p_booking,p_line,v_old,p_amount,v_rows)::text);
  IF p_expected IS NOT NULL THEN
    IF v_token <> p_expected THEN
      RAISE EXCEPTION 'Preview changed' USING ERRCODE='ZT002';
    END IF;
    IF v_old <> p_amount THEN
      FOR v_row IN SELECT * FROM jsonb_to_recordset(v_rows) AS r("entryId" text,"differenceCentavos" bigint)
      LOOP
        IF v_row."differenceCentavos" <> 0 THEN
          PERFORM public.admin_commission_adjust(p_actor,gen_random_uuid()::text,v_row."entryId",v_row."differenceCentavos",
            format('Booking service deduction changed from %s to %s centavos (line %s)',v_old,p_amount,p_line));
        END IF;
      END LOOP;
      INSERT INTO public.booking_deduction_overrides ("lineId","amountCentavos") VALUES (p_line,p_amount)
      ON CONFLICT ("lineId") DO UPDATE SET "amountCentavos"=EXCLUDED."amountCentavos";
    END IF;
  END IF;
  RETURN jsonb_build_object('token',v_token,'previousDeductionCentavos',v_old,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.admin_booking_deduction_correct(text,text,text,integer,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
   GRANT EXECUTE ON FUNCTION public.admin_booking_deduction_correct(text,text,text,integer,text) TO zeus_app;
 END IF;
END $$;

COMMIT;
