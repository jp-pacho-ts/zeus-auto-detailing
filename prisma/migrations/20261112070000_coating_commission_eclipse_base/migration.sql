-- 20261112070000_coating_commission_eclipse_base
-- 1. Coating services (CERAMIC_COATING / GRAPHENE): technician commission base is pegged to the IGC Eclipse Graphene
--    price for that vehicle category, less any client discount granted by the admin below the original catalog price.
-- 2. Allow worker assignments on COMPLETED bookings so staff can record detailers even after marking the job done.
-- 3. Allow replacing a creditedCount=0 commission accrual when a worker is assigned to a completed booking.

CREATE OR REPLACE FUNCTION commission_accrue(p_booking text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.bookings; total bigint; unpriced integer; eligible integer; default_bp integer; ids text[]; rates integer[]; n integer;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id = p_booking;
 IF NOT FOUND OR b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN RETURN 0; END IF;
 SELECT "defaultRateBp" INTO default_bp FROM public.commission_settings WHERE id = 1;
 IF default_bp IS NULL THEN RAISE EXCEPTION 'The commission settings row is missing' USING ERRCODE = 'ZC006'; END IF;

 -- The base is the price of the lines that earn commission (commission_earns_on).
 -- Coating packages (CERAMIC_COATING / GRAPHENE): technician commission base is pegged to the IGC Eclipse Graphene price
 -- for that vehicle category, minus any discount given below the original catalog price.
 SELECT COALESCE(sum(
          CASE
            WHEN sv.category = 'CERAMIC_COATING' AND EXISTS(
              SELECT 1 FROM public.catalog_service_versions v WHERE v."releaseId" = l."releaseId" AND v."serviceId" = l."serviceId" AND v."group" = 'GRAPHENE'
            ) THEN COALESCE(
              (
                SELECT GREATEST(0,
                  COALESCE(
                    o."unitPriceCentavos" - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                    COALESCE(l."staffPriceCentavos", l."subtotalCentavos")
                  )
                )
                FROM public.catalog_service_versions ev
                JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                LIMIT 1
              ),
              COALESCE(l."staffPriceCentavos", l."subtotalCentavos")
            )
            ELSE COALESCE(l."staffPriceCentavos", l."subtotalCentavos")
          END
        ) FILTER (WHERE public.commission_earns_on(sv.category)), 0)::bigint,
        count(*) FILTER (WHERE public.commission_earns_on(sv.category) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
        count(*) FILTER (WHERE public.commission_earns_on(sv.category))::integer
   INTO total, unpriced, eligible
   FROM public.booking_line_items l JOIN public.services sv ON sv.id = l."serviceId" WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL;

 IF total > 1000000000000 THEN RAISE EXCEPTION 'The service total is above the supported commission range' USING ERRCODE = 'ZC006'; END IF;

 IF eligible > 0 THEN
  SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"), array_agg(COALESCE(s."commissionRateBp", default_bp) ORDER BY w."assignedAt", w."staffId")
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

-- Allow worker assignments on COMPLETED bookings as well as open ones.
CREATE OR REPLACE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ DECLARE b public.bookings; BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Board relations are insert/delete only'; END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=OLD."bookingId" AND "snapshotVersion"::text='QUEUE_V3' AND status IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED')) THEN RAISE EXCEPTION 'Closed worker history cannot be changed'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED') THEN RAISE EXCEPTION 'Assign only open or completed day-queue bookings'; END IF;
 ELSE
  IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN RAISE EXCEPTION 'Assign only open day-queue bookings'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN RAISE EXCEPTION 'ADMIN assignment required'; END IF;
 IF TG_TABLE_NAME='booking_worker_assignments' THEN
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active worker'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN RAISE EXCEPTION 'Assign an active bay'; END IF;
 END IF;
 NEW."assignedAt":=CURRENT_TIMESTAMP; RETURN NEW; END $$;

-- Allow deleting a commission_accruals row when creditedCount=0 (re-accruing for late worker assignment)
CREATE OR REPLACE FUNCTION guard_commission_accrual_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Commission records are immutable'; END IF;
 IF OLD."creditedCount" = 0 OR (public.booking_delete_authorised(OLD."bookingId") AND NOT EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = OLD."bookingId")) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Commission records cannot be deleted';
END $$;
