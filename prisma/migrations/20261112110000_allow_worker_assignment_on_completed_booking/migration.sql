-- Allow assigning workers to COMPLETED bookings (e.g. for late commission attribution or missing worker records)
CREATE OR REPLACE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  b public.bookings;
BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Board relations are insert/delete only'; END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(
    SELECT 1 FROM public.bookings WHERE id=OLD."bookingId" AND "snapshotVersion"::text='QUEUE_V3' AND status IN ('PENDING','CONFIRMED','IN_PROGRESS')
  ) THEN RAISE EXCEPTION 'Closed worker history cannot be changed'; END IF;
  RETURN OLD;
 END IF;

 SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
 IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' THEN
   RAISE EXCEPTION 'Assign only day-queue bookings';
 END IF;

 IF TG_TABLE_NAME='booking_worker_assignments' THEN
   -- Allow assigning workers even on COMPLETED bookings
   IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED') THEN
     RAISE EXCEPTION 'Assign only open or completed day-queue bookings';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
     RAISE EXCEPTION 'ADMIN assignment required';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN
     RAISE EXCEPTION 'Assign an active worker';
   END IF;
 ELSE
   -- Bays are only for open bookings
   IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
     RAISE EXCEPTION 'Assign only open day-queue bookings';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
     RAISE EXCEPTION 'ADMIN assignment required';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN
     RAISE EXCEPTION 'Assign an active bay';
   END IF;
 END IF;

 NEW."assignedAt":=CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;

-- Allow deleting empty commission accruals when creditedCount = 0 and no commission entries exist
CREATE OR REPLACE FUNCTION guard_commission_accrual_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Commission records are immutable'; END IF;
 IF (public.booking_delete_authorised(OLD."bookingId") OR OLD."creditedCount" = 0) AND NOT EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = OLD."bookingId") THEN
   RETURN OLD;
 END IF;
 RAISE EXCEPTION 'Commission records cannot be deleted';
END $$;

-- Update commission_accrue to safely replace 0-credited empty accruals when staff are assigned after completion
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

  -- If accrual exists and already credited detailers, do not re-accrue
  IF EXISTS (SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking AND "creditedCount" > 0) THEN RETURN 0; END IF;

  -- If empty accrual existed (0 workers previously assigned), clear it so newly assigned workers get credited
  DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking AND "creditedCount" = 0;

  SELECT (value->>'basisPoints')::integer INTO default_bp FROM public.shop_settings WHERE key = 'team_commission_default_rate';
  IF default_bp IS NULL THEN default_bp := 1000; END IF;

  SELECT sv."commissionRateBp" INTO svc_rate FROM public.services sv WHERE sv.id = b."serviceId";

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
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION commission_accrue(text) TO zeus_app;
  END IF;
END $$;
