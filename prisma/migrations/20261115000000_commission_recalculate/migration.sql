-- Commission per service and a Recalculate button (LE 2026-11-12).
-- 1. commission_accrue used the first (primary) service's rate for the whole booking, so a second service with its own
--    commission earned at the wrong rate. Each eligible line now earns at its own service rate; the rest is unchanged from
--    20261112120000_fix_superadmin_worker_assignment_on_completed.
-- 2. admin_commission_recalculate redoes one finished booking with today's service and worker rates. It refuses when any
--    entry is paid or adjusted, and returns each worker's amount before and after.
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
         ) FILTER (WHERE (sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0)), 0)::bigint,
         count(*) FILTER (WHERE ((sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0)) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
         count(*) FILTER (WHERE (sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0))::integer
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
           END)::bigint AS base, sv."commissionRateBp" AS rate
        FROM public.booking_line_items l
        JOIN public.services sv ON sv.id = l."serviceId"
       WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL AND ((sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0))
    )
    SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"),
           array_agg(CASE WHEN total > 0 THEN LEAST(10000, GREATEST(0, round(
                  (SELECT sum(lb.base * COALESCE(lb.rate, s."commissionRateBp", default_bp)) FROM lb)::numeric / total)))::integer
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

CREATE OR REPLACE FUNCTION admin_commission_recalculate(p_actor text, p_booking text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  before_rows jsonb;
  after_rows jsonb;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  SELECT * INTO b FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZT404'; END IF;
  IF b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN
    RAISE EXCEPTION 'Only a finished booking has a commission to recalculate' USING ERRCODE = 'ZC010';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_entries e WHERE e."bookingId" = p_booking
              AND (e."paidAt" IS NOT NULL OR EXISTS (SELECT 1 FROM public.commission_adjustments a WHERE a."entryId" = e.id))) THEN
    RAISE EXCEPTION 'This commission is already paid or adjusted, so it was not changed' USING ERRCODE = 'ZC011';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('staffId', e."staffId", 'name', s.name, 'rateBp', e."rateBp", 'amountCentavos', e."amountCentavos") ORDER BY e."position"), '[]'::jsonb)
    INTO before_rows FROM public.commission_entries e JOIN public.staff s ON s.id = e."staffId" WHERE e."bookingId" = p_booking;
  PERFORM set_config('zeus.allow_commission_reaccrue', 'on', true);
  DELETE FROM public.commission_entries WHERE "bookingId" = p_booking;
  DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
  PERFORM set_config('zeus.allow_commission_reaccrue', 'off', true);
  PERFORM public.commission_accrue(p_booking);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('staffId', e."staffId", 'name', s.name, 'rateBp', e."rateBp", 'amountCentavos', e."amountCentavos") ORDER BY e."position"), '[]'::jsonb)
    INTO after_rows FROM public.commission_entries e JOIN public.staff s ON s.id = e."staffId" WHERE e."bookingId" = p_booking;
  -- The audit CHECK allows no new action; the accrual row says who asked for it.
  INSERT INTO public.admin_audit_events (action, "bookingId", "entryCount", reason)
    VALUES ('COMMISSION_ACCRUED', p_booking, jsonb_array_length(after_rows), 'Recalculated by ' || p_actor);
  RETURN jsonb_build_object('before', before_rows, 'after', after_rows);
END $$;
REVOKE ALL ON FUNCTION admin_commission_recalculate(text, text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_commission_recalculate(text, text) TO zeus_app;
  END IF;
END $$;
