-- Pick-up pricing (LE 2026-11-12). Size L holds SUVs and pick-ups and XL holds full-size SUVs, pick-ups and vans. Some services
-- (the Nexus tints) price a pick-up like a sedan, so an offer may carry a pick-up price and a booking records the body type the
-- customer chose. A NULL pick-up price means pick-ups pay the normal size price, so every existing price is unchanged.
ALTER TABLE public.service_size_offers ADD COLUMN "pickupPriceCentavos" integer NULL
  CONSTRAINT catalog_offer_pickup_money CHECK ("pickupPriceCentavos" IS NULL OR ("pickupPriceCentavos" BETWEEN 0 AND 100000000 AND "sizeCode" IN ('L', 'XL')));
ALTER TABLE public.bookings ADD COLUMN "vehicleBodyType" text NULL
  CONSTRAINT booking_body_type_size CHECK ("vehicleBodyType" IS NULL
    OR ("vehicleSizeCodeSnapshot" = 'L' AND "vehicleBodyType" IN ('SUV', 'PICKUP'))
    OR ("vehicleSizeCodeSnapshot" = 'XL' AND "vehicleBodyType" IN ('SUV', 'PICKUP', 'VAN')));

-- The line check compares each line with the price the customer was charged: the pick-up price for a pick-up when the offer has
-- one, otherwise the size price. 20261112130000_catalog_line_check_at_insert with only that price expression changed.
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
       AND CASE WHEN l."priceStatus"='PRICED' THEN o.state='OFFERED' AND o."bookingMode"='FIXED_ONLINE' AND COALESCE(CASE WHEN b."vehicleBodyType"='PICKUP' THEN o."pickupPriceCentavos" END, o."unitPriceCentavos") IS NOT NULL
              AND l."unitPriceCentavos"=COALESCE(CASE WHEN b."vehicleBodyType"='PICKUP' THEN o."pickupPriceCentavos" END, o."unitPriceCentavos")
            ELSE (o.state='OFFERED' AND o."bookingMode"='QUOTE_REQUIRED' AND l."referenceUnitPriceCentavos" IS NOT DISTINCT FROM COALESCE(CASE WHEN b."vehicleBodyType"='PICKUP' THEN o."pickupPriceCentavos" END, o."unitPriceCentavos"))
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
 IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId" JOIN public.service_work_plans p ON p."offerId"=o.id JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE l."bookingId"=bid AND (l."releaseId"<>b."catalogReleaseId" OR l."vehicleCategoryId"<>b."vehicleCategoryId" OR o."sizeCode"<>b."vehicleSizeCodeSnapshot" OR l."unitPriceCentavos" IS DISTINCT FROM COALESCE(CASE WHEN b."vehicleBodyType"='PICKUP' THEN o."pickupPriceCentavos" END, o."unitPriceCentavos") OR l."nameSnapshot"<>v.name OR l.unit<>v.unit OR l.type<>v.type OR o.state<>'OFFERED' OR o."bookingMode"<>'FIXED_ONLINE' OR p.kind<>'TIMED' OR l."addedMinutes" IS DISTINCT FROM p."durationMinutes")) THEN RAISE EXCEPTION 'Catalog snapshot offer mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
 RETURN NEW;
END $$;

-- Admin -> Services writes the pick-up price of the L and XL offers after admin_service_create or admin_service_update, in the
-- same transaction. Other sizes always get NULL.
CREATE OR REPLACE FUNCTION admin_service_set_pickup_prices(p_actor text, p_service_id text, p_offers jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_rid text;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM set_config('zeus.allow_catalog_edit', 'on', true);
  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;
  IF v_rid IS NULL THEN RAISE EXCEPTION 'No active catalog head found'; END IF;
  UPDATE public.service_size_offers o
  SET "pickupPriceCentavos" = CASE WHEN o."sizeCode" IN ('L', 'XL') THEN (
        SELECT (e->>'pickupPriceCentavos')::int FROM jsonb_array_elements(p_offers) e WHERE e->>'sizeCode' = o."sizeCode" LIMIT 1) END
  WHERE o."releaseId" = v_rid AND o."serviceId" = p_service_id;
END $$;
REVOKE ALL ON FUNCTION admin_service_set_pickup_prices(text, text, jsonb) FROM PUBLIC;

-- 20261112090000 admin_service_list with pickupPriceCentavos added to each offer.
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
    GRANT EXECUTE ON FUNCTION admin_service_list(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_service_set_pickup_prices(text, text, jsonb) TO zeus_app;
  END IF;
END $$;

-- publish_catalog compares offer rows with the reviewed manifest, which has no pick-up price (it is set later on the Services
-- page, like the promo dates). 20261018000000_booking_model with only pickupPriceCentavos added to the ignored columns.
CREATE OR REPLACE FUNCTION publish_catalog(p_release text,p_hash text,p_review text,p_reason text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor text; r public.catalog_releases; previous_id text; previous_hash text; document jsonb; s jsonb; o jsonb; actual jsonb; event_id text;
BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 SELECT staff.id INTO actor FROM public.catalog_publishers mapping JOIN public.staff staff ON staff.id=mapping."actorStaffId" WHERE mapping."databaseRole"=session_user AND staff."isActive" AND staff.role IN ('ADMIN','MANAGER') FOR UPDATE OF staff;
 IF actor IS NULL THEN RAISE EXCEPTION 'Catalog publication requires a mapped active ADMIN'; END IF;
 IF p_review IS NULL OR length(btrim(p_review))=0 OR length(p_review)>500 OR p_reason IS NULL OR length(btrim(p_reason))=0 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Review reference and reason required'; END IF;
 SELECT * INTO STRICT r FROM public.catalog_releases WHERE id=p_release FOR UPDATE;
 IF r.state<>'DRAFT' OR r."manifestSha256"<>p_hash OR p_hash<>encode(sha256(convert_to(r."manifestJson",'UTF8')),'hex') THEN RAISE EXCEPTION 'Release state or approved manifest hash mismatch'; END IF;
 document:=r."manifestJson"::jsonb;
 IF document->>'version'<>r.version OR document->>'sourceSha256'<>r."sourceSha256" OR document->>'sourcePath'<>r."sourcePath" OR document->>'sourceReceivedDate'<>r."sourceReceivedDate"::date::text THEN RAISE EXCEPTION 'Manifest provenance mismatch'; END IF;
 IF jsonb_array_length(document->'services')<>21 OR (SELECT count(*) FROM public.catalog_service_versions WHERE "releaseId"=r.id)<>21 OR (SELECT count(*) FROM public.service_size_offers WHERE "releaseId"=r.id)<>105 OR (SELECT count(*) FROM public.add_on_compatibility WHERE "releaseId"=r.id)<>6 THEN RAISE EXCEPTION 'Incomplete catalog release'; END IF;
 -- P1-02 (ADR-005 §7): every service of the release joins an active queue.
 IF EXISTS(SELECT 1 FROM public.catalog_service_versions v LEFT JOIN public.booking_queues q ON q.code=v."queueCode" WHERE v."releaseId"=r.id AND (q.code IS NULL OR NOT q."isActive")) THEN RAISE EXCEPTION 'Catalog service without an active queue'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'sizes') LOOP
  SELECT jsonb_build_object('id',id,'code',slug,'name',name,'sortOrder',"sortOrder") INTO actual FROM public.vehicle_categories WHERE id=s->>'id';
  IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'Manifest size mismatch'; END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'services') LOOP
  SELECT (to_jsonb(v)-'releaseId'-'serviceId')||jsonb_build_object('id',v."serviceId") INTO actual FROM public.catalog_service_versions v WHERE "releaseId"=r.id AND "serviceId"=s->>'id';
  IF actual IS DISTINCT FROM s-'offers' THEN RAISE EXCEPTION 'Manifest service mismatch'; END IF;
  IF jsonb_array_length(s->'offers')<>5 THEN RAISE EXCEPTION 'Missing size offer'; END IF;
  FOR o IN SELECT value FROM jsonb_array_elements(s->'offers') LOOP
   SELECT (to_jsonb(offer)-'releaseId'-'serviceId'-'promoStartsAt'-'promoEndsAt'-'pickupPriceCentavos')||jsonb_build_object('durationKind',plan.kind,'durationMinutes',plan."durationMinutes",'elapsedDays',plan."elapsedDays",'bayHoldPolicy',plan."bayHoldPolicy") INTO actual FROM public.service_size_offers offer JOIN public.service_work_plans plan ON plan."offerId"=offer.id WHERE offer.id=o->>'id' AND offer."releaseId"=r.id AND offer."serviceId"=s->>'id';
   IF actual IS DISTINCT FROM o THEN RAISE EXCEPTION 'Manifest offer mismatch'; END IF;
  END LOOP;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'compatibility') LOOP
  SELECT to_jsonb(c)-'releaseId' INTO actual FROM public.add_on_compatibility c WHERE "releaseId"=r.id AND "baseServiceId"=s->>'baseServiceId' AND "addOnServiceId"=s->>'addOnServiceId';
  IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'Manifest compatibility mismatch'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.catalog_hold_segments h JOIN public.service_size_offers o ON h."offerId"=o.id WHERE o."releaseId"=r.id) OR EXISTS(SELECT 1 FROM public.service_work_plans p JOIN public.service_size_offers o ON o.id=p."offerId" WHERE o."releaseId"=r.id AND p.kind='MULTI_DAY') THEN RAISE EXCEPTION 'Multi-day allocation is not enabled'; END IF;
 SELECT head."releaseId",old."manifestSha256" INTO previous_id,previous_hash FROM public.catalog_head head JOIN public.catalog_releases old ON old.id=head."releaseId" WHERE head."shopId"=1;
 UPDATE public.catalog_releases SET state='RETIRED' WHERE id=previous_id;
 UPDATE public.catalog_releases SET state='PUBLISHED',"reviewReference"=p_review,"publishedAt"=CURRENT_TIMESTAMP WHERE id=r.id;
 INSERT INTO public.catalog_head ("shopId","releaseId") VALUES (1,r.id) ON CONFLICT ("shopId") DO UPDATE SET "releaseId"=EXCLUDED."releaseId";
 UPDATE public.services SET "isActive"=false WHERE id NOT IN (SELECT "serviceId" FROM public.catalog_service_versions WHERE "releaseId"=r.id);
 event_id:=gen_random_uuid()::text;
 INSERT INTO public.catalog_publication_events (id,"releaseId","previousReleaseId","actorStaffId","databaseRole",action,reason,"reviewReference","sourceSha256","manifestSha256","previousManifestSha256") VALUES (event_id,r.id,previous_id,actor,session_user,CASE WHEN p_reason LIKE 'ROLLBACK:%' THEN 'ROLLBACK' ELSE 'PUBLISH' END,p_reason,p_review,r."sourceSha256",r."manifestSha256",previous_hash);
 RETURN event_id;
END $$;
