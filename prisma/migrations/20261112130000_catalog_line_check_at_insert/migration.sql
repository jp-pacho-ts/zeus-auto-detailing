-- Set price, service status and add/remove service failed with "Something went wrong" on every booking holding a
-- service that was later edited on the Services page: admin_service_update changes the published offer in place, and this
-- check compared every line of the booking with the live offer on each line update. A line's snapshot cannot change after
-- insert (guard_booking_line_change), so it is now compared once: all lines when the booking is created, and a staff-added
-- line when it is inserted. Everything else in the function is unchanged from 20261018000000_booking_model.
CREATE OR REPLACE FUNCTION validate_booking_catalog_lines() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE bid text; b public.bookings; total bigint; minutes bigint; line_count int;
  create_count int; active_count int; active_bases int; all_referenced boolean; estimate bigint;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN bid:=NEW.id; ELSE bid:=NEW."bookingId"; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=bid;
 IF b."snapshotVersion"::text='QUEUE_V3' THEN
  SELECT count(*) FILTER (WHERE "addedByStaffId" IS NULL), count(*) FILTER (WHERE "removedAt" IS NULL),
         count(*) FILTER (WHERE "removedAt" IS NULL AND type='BASE')
    INTO create_count, active_count, active_bases FROM public.booking_line_items WHERE "bookingId"=bid;
  IF create_count NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'A day-queue booking needs 1 to 10 create lines'; END IF;
  IF active_count > 10 THEN RAISE EXCEPTION 'A day-queue booking has at most 10 active lines'; END IF;
  IF active_bases < 1 THEN RAISE EXCEPTION 'A day-queue booking needs at least one active base service'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "order"=0 AND "addedByStaffId" IS NULL AND type='BASE' AND "serviceId"=b."serviceId") THEN
   RAISE EXCEPTION 'The day-queue primary service must be the order-0 base line';
  END IF;
  -- At create the booking joins its primary service's queue (A6); staff may move it later (§14).
  IF b."createdTxId"=txid_current() AND b."queueCode" IS DISTINCT FROM (SELECT v."queueCode" FROM public.catalog_service_versions v WHERE v."releaseId"=b."catalogReleaseId" AND v."serviceId"=b."serviceId") THEN
   RAISE EXCEPTION 'A day-queue booking joins its primary service''s queue';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "removedAt" IS NULL GROUP BY "serviceId" HAVING count(*)>1) THEN
   RAISE EXCEPTION 'A service appears once per visit';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "addedByStaffId" IS NULL AND "releaseId"<>b."catalogReleaseId") THEN
   RAISE EXCEPTION 'Day-queue create lines must use the booking release';
  END IF;
  -- G7 for QUEUE_V3: same size, the line release's own name/unit/type, never NOT_OFFERED, and the
  -- A1/A2 rule (the SQL form of offerBooking() in catalog-pricing.ts).
  IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId"
     JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId"
     WHERE l."bookingId"=bid
       AND (b."createdTxId"=txid_current() OR (TG_TABLE_NAME='booking_line_items' AND TG_OP='INSERT' AND l.id=NEW.id))
       AND NOT COALESCE(l."vehicleCategoryId"=b."vehicleCategoryId" AND o."sizeCode"=b."vehicleSizeCodeSnapshot"
       AND l."nameSnapshot"=v.name AND l.unit=v.unit AND l.type=v.type AND o.state<>'NOT_OFFERED'
       AND CASE WHEN l."priceStatus"='PRICED' THEN o.state='OFFERED' AND o."bookingMode"='FIXED_ONLINE' AND o."unitPriceCentavos" IS NOT NULL
              AND l."unitPriceCentavos"=o."unitPriceCentavos"
            ELSE (o.state='OFFERED' AND o."bookingMode"='QUOTE_REQUIRED' AND l."referenceUnitPriceCentavos" IS NOT DISTINCT FROM o."unitPriceCentavos")
              OR (o.state='UNCONFIRMED' AND v.unit='PANEL' AND v."referenceUnitPriceCentavos" IS NOT NULL AND l."referenceUnitPriceCentavos"=v."referenceUnitPriceCentavos") END, false)) THEN
   RAISE EXCEPTION 'Catalog snapshot offer mismatch';
  END IF;
  -- The immutable receipt equals the create lines: priced sum, and the estimate (NULL while a
  -- for-quote create line has no reference, R21).
  SELECT COALESCE(sum("subtotalCentavos") FILTER (WHERE "priceStatus"='PRICED'), 0), bool_and("priceStatus"='PRICED' OR "referenceSubtotalCentavos" IS NOT NULL),
         sum(COALESCE("subtotalCentavos", "referenceSubtotalCentavos"))
    INTO total, all_referenced, estimate FROM public.booking_line_items WHERE "bookingId"=bid AND "addedByStaffId" IS NULL;
  IF total IS DISTINCT FROM b."receiptTotalCentavos"::bigint OR (CASE WHEN all_referenced THEN estimate END) IS DISTINCT FROM b."receiptEstimatedCentavos"::bigint THEN
   RAISE EXCEPTION 'Day-queue receipt does not match its create lines';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items s JOIN public.booking_line_items c ON c."bookingId"=s."bookingId" AND c."addedByStaffId" IS NULL
     WHERE s."bookingId"=bid AND s."addedByStaffId" IS NOT NULL AND s."order"<c."order") THEN
   RAISE EXCEPTION 'Staff-added lines follow the create lines';
  END IF;
  IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
  RETURN NEW;
 END IF;
 SELECT sum("subtotalCentavos"),sum("addedMinutes"),count(*) INTO total,minutes,line_count FROM public.booking_line_items WHERE "bookingId"=bid;
 IF b."snapshotVersion"='LEGACY_V1' THEN IF line_count<>0 THEN RAISE EXCEPTION 'Legacy snapshot cannot acquire inferred lines'; END IF; RETURN NEW; END IF;
 IF line_count NOT BETWEEN 1 AND 3 OR total IS DISTINCT FROM (b."priceSnapshot"*100)::bigint OR minutes IS DISTINCT FROM b."durationMinutes"::bigint OR NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "order"=0 AND "serviceId"=b."serviceId" AND type='BASE') THEN RAISE EXCEPTION 'Incomplete catalog snapshot totals'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId" JOIN public.service_work_plans p ON p."offerId"=o.id JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE l."bookingId"=bid AND (l."releaseId"<>b."catalogReleaseId" OR l."vehicleCategoryId"<>b."vehicleCategoryId" OR o."sizeCode"<>b."vehicleSizeCodeSnapshot" OR l."unitPriceCentavos" IS DISTINCT FROM o."unitPriceCentavos" OR l."nameSnapshot"<>v.name OR l.unit<>v.unit OR l.type<>v.type OR o.state<>'OFFERED' OR o."bookingMode"<>'FIXED_ONLINE' OR p.kind<>'TIMED' OR l."addedMinutes" IS DISTINCT FROM p."durationMinutes")) THEN RAISE EXCEPTION 'Catalog snapshot offer mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
 RETURN NEW;
END $$;

-- 20261112020000_superadmin_triggers rewrote this guard to admit SUPERADMIN and dropped its other rules: a line could be deleted,

-- its sold name and price rewritten, a staff price cleared, and a cancelled or completed booking's lines changed. This is the

-- 20261105000000_team_commissions function again with SUPERADMIN added to the price rule and nothing else changed.
CREATE OR REPLACE FUNCTION guard_booking_line_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE st text;
BEGIN
 IF TG_OP = 'DELETE' OR OLD."lineVersion"::text <> 'QUEUE_V3' THEN RAISE EXCEPTION 'Booking line snapshot is append-only'; END IF;
 IF ROW(NEW.id,NEW."bookingId",NEW."order",NEW."releaseId",NEW."serviceId",NEW."vehicleCategoryId",NEW."offerId",NEW.type,NEW."nameSnapshot",NEW.unit,NEW.quantity,NEW."unitPriceCentavos",NEW."subtotalCentavos",NEW."addedMinutes",NEW."lineVersion",NEW."priceStatus",NEW."referenceUnitPriceCentavos",NEW."referenceSubtotalCentavos",NEW."addedAt",NEW."addedByStaffId")
    IS DISTINCT FROM ROW(OLD.id,OLD."bookingId",OLD."order",OLD."releaseId",OLD."serviceId",OLD."vehicleCategoryId",OLD."offerId",OLD.type,OLD."nameSnapshot",OLD.unit,OLD.quantity,OLD."unitPriceCentavos",OLD."subtotalCentavos",OLD."addedMinutes",OLD."lineVersion",OLD."priceStatus",OLD."referenceUnitPriceCentavos",OLD."referenceSubtotalCentavos",OLD."addedAt",OLD."addedByStaffId") THEN
  RAISE EXCEPTION 'Booking line snapshot is immutable';
 END IF;
 IF OLD."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable once removed'; END IF;
 IF OLD."staffPriceCentavos" IS NOT NULL AND NEW."staffPriceCentavos" IS NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable: a staff price cannot be cleared'; END IF;
 SELECT status INTO st FROM public.bookings WHERE id = OLD."bookingId";
 IF st = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled booking takes no line change'; END IF;
 -- P1-37 (LE 2026-11-06): a completed booking is final, price included. Money that arrives later is recorded as a commission
 -- adjustment, never by editing a line the commission was already counted on.
 IF st = 'COMPLETED' AND ROW(NEW."workStatus", NEW."removedAt", NEW."staffPriceCentavos") IS DISTINCT FROM ROW(OLD."workStatus", OLD."removedAt", OLD."staffPriceCentavos") THEN
  RAISE EXCEPTION 'A completed booking takes no line change';
 END IF;
 -- Codex review F1: who set a price, and when a price or status changed, move only with that
 -- value (so under its role, revision and audit checks). The database stamps the times.
 IF NEW."staffPriceCentavos" IS NOT DISTINCT FROM OLD."staffPriceCentavos" THEN
  IF ROW(NEW."staffPriceSetAt", NEW."staffPriceSetByStaffId") IS DISTINCT FROM ROW(OLD."staffPriceSetAt", OLD."staffPriceSetByStaffId") THEN
   RAISE EXCEPTION 'A line price actor or time changes only with the price';
  END IF;
 ELSE
  NEW."staffPriceSetAt" := CURRENT_TIMESTAMP;
 END IF;
 IF NEW."workStatus" IS NOT DISTINCT FROM OLD."workStatus" THEN
  IF NEW."workStatusChangedAt" IS DISTINCT FROM OLD."workStatusChangedAt" THEN RAISE EXCEPTION 'A line status time changes only with the status'; END IF;
 ELSE
  NEW."workStatusChangedAt" := CURRENT_TIMESTAMP;
 END IF;
 IF OLD."removedAt" IS NULL AND NEW."removedAt" IS NOT NULL THEN NEW."removedAt" := CURRENT_TIMESTAMP; END IF;
 IF NEW."staffPriceCentavos" IS DISTINCT FROM OLD."staffPriceCentavos" AND NOT EXISTS(SELECT 1 FROM public.staff
    WHERE id = NEW."staffPriceSetByStaffId" AND "isActive" AND role IN ('SUPERADMIN', 'ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only ADMIN sets a line price';
 END IF;
 RETURN NEW;
END $$;
