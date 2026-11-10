-- Migration: allow explicit 0% / no-commission option for services
-- When a service has commissionRateBp = 0, it is explicitly excluded from earning commission.

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
  IF EXISTS (SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN RETURN 0; END IF;

  SELECT (value->>'basisPoints')::integer INTO default_bp FROM public.shop_settings WHERE key = 'team_commission_default_rate';
  IF default_bp IS NULL THEN default_bp := 1000; END IF;

  SELECT sv."commissionRateBp" INTO svc_rate FROM public.services sv WHERE sv.id = b."serviceId";

  -- The base is the price of the lines that earn commission:
  -- - If service commissionRateBp IS NULL: falls back to default category rule (commission_earns_on).
  -- - If service commissionRateBp > 0: earns commission at the specified rate.
  -- - If service commissionRateBp = 0: explicitly NO commission (excluded).
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
         ) FILTER (WHERE (sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0)), 0)::bigint,
         count(*) FILTER (WHERE ((sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0)) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
         count(*) FILTER (WHERE (sv."commissionRateBp" IS NULL AND public.commission_earns_on(sv.category)) OR (sv."commissionRateBp" IS NOT NULL AND sv."commissionRateBp" > 0))::integer
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

REVOKE ALL ON FUNCTION commission_accrue(text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app;
  END IF;
END $$;
