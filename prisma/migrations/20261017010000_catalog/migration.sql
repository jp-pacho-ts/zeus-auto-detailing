-- CreateEnum
CREATE TYPE "CatalogReleaseState" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CatalogServiceGroup" AS ENUM ('WASH', 'DETAILING', 'GRAPHENE', 'TINT', 'PPF', 'REPAINT');

-- CreateEnum
CREATE TYPE "CatalogServiceType" AS ENUM ('BASE', 'ADD_ON');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('VEHICLE', 'PANEL');

-- CreateEnum
CREATE TYPE "OfferState" AS ENUM ('OFFERED', 'NOT_OFFERED', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "CatalogBookingMode" AS ENUM ('FIXED_ONLINE', 'QUOTE_REQUIRED');

-- CreateEnum
CREATE TYPE "DurationKind" AS ENUM ('UNKNOWN', 'TIMED', 'MULTI_DAY');

-- CreateEnum
CREATE TYPE "BayHoldPolicy" AS ENUM ('UNCONFIRMED', 'CONTINUOUS', 'SEGMENTED');

-- CreateEnum
CREATE TYPE "SnapshotVersion" AS ENUM ('LEGACY_V1', 'CATALOG_V2');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "catalogFingerprint" TEXT,
ADD COLUMN     "catalogReleaseId" TEXT,
ADD COLUMN     "pricingAlgorithm" TEXT,
ADD COLUMN     "snapshotVersion" "SnapshotVersion" NOT NULL DEFAULT 'LEGACY_V1',
ADD COLUMN     "vehicleSizeCodeSnapshot" TEXT;

-- AlterTable
ALTER TABLE "services" ALTER COLUMN "durationMinutes" DROP NOT NULL,
ALTER COLUMN "price" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vehicle_categories" ALTER COLUMN "sizeMultiplier" DROP NOT NULL;

-- CreateTable
CREATE TABLE "catalog_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "state" "CatalogReleaseState" NOT NULL DEFAULT 'DRAFT',
    "sourcePath" TEXT NOT NULL,
    "sourceReceivedDate" DATE NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "reviewReference" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_head" (
    "shopId" INTEGER NOT NULL DEFAULT 1,
    "releaseId" TEXT NOT NULL,

    CONSTRAINT "catalog_head_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "catalog_service_versions" (
    "releaseId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "description" TEXT,
    "group" "CatalogServiceGroup" NOT NULL,
    "type" "CatalogServiceType" NOT NULL,
    "unit" "PriceUnit" NOT NULL,
    "inclusions" TEXT[],
    "productName" TEXT,
    "hardness" TEXT,
    "warrantyMonths" INTEGER,
    "filmThicknessMil" TEXT,
    "referenceUnitPriceCentavos" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "catalog_service_versions_pkey" PRIMARY KEY ("releaseId","serviceId")
);

-- CreateTable
CREATE TABLE "service_size_offers" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "sizeCode" TEXT NOT NULL,
    "state" "OfferState" NOT NULL,
    "bookingMode" "CatalogBookingMode" NOT NULL,
    "unitPriceCentavos" INTEGER,
    "compareAtCentavos" INTEGER,
    "sourceCompareAtCentavos" INTEGER,
    "compareAtVerified" BOOLEAN NOT NULL DEFAULT false,
    "promoStartsAt" TIMESTAMPTZ(3),
    "promoEndsAt" TIMESTAMPTZ(3),

    CONSTRAINT "service_size_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_work_plans" (
    "offerId" TEXT NOT NULL,
    "kind" "DurationKind" NOT NULL,
    "durationMinutes" INTEGER,
    "elapsedDays" INTEGER,
    "bayHoldPolicy" "BayHoldPolicy" NOT NULL DEFAULT 'UNCONFIRMED',

    CONSTRAINT "service_work_plans_pkey" PRIMARY KEY ("offerId")
);

-- CreateTable
CREATE TABLE "catalog_hold_segments" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "catalog_hold_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_on_compatibility" (
    "releaseId" TEXT NOT NULL,
    "baseServiceId" TEXT NOT NULL,
    "addOnServiceId" TEXT NOT NULL,
    "sizeCodes" TEXT[],

    CONSTRAINT "add_on_compatibility_pkey" PRIMARY KEY ("releaseId","baseServiceId","addOnServiceId")
);

-- CreateTable
CREATE TABLE "booking_line_items" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "releaseId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "vehicleCategoryId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "type" "CatalogServiceType" NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unit" "PriceUnit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCentavos" INTEGER NOT NULL,
    "subtotalCentavos" INTEGER NOT NULL,
    "addedMinutes" INTEGER NOT NULL,

    CONSTRAINT "booking_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_publishers" (
    "databaseRole" TEXT NOT NULL,
    "actorStaffId" TEXT NOT NULL,

    CONSTRAINT "catalog_publishers_pkey" PRIMARY KEY ("databaseRole")
);

-- CreateTable
CREATE TABLE "catalog_publication_events" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "previousReleaseId" TEXT,
    "actorStaffId" TEXT NOT NULL,
    "databaseRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewReference" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "previousManifestSha256" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_publication_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_releases_version_key" ON "catalog_releases"("version");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_head_releaseId_key" ON "catalog_head"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_service_versions_releaseId_slug_key" ON "catalog_service_versions"("releaseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "service_size_offers_releaseId_serviceId_vehicleCategoryId_key" ON "service_size_offers"("releaseId", "serviceId", "vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "service_size_offers_id_releaseId_serviceId_vehicleCategoryI_key" ON "service_size_offers"("id", "releaseId", "serviceId", "vehicleCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_hold_segments_offerId_dayOffset_startTime_key" ON "catalog_hold_segments"("offerId", "dayOffset", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "booking_line_items_bookingId_order_key" ON "booking_line_items"("bookingId", "order");

-- CreateIndex
CREATE INDEX "catalog_publication_events_releaseId_createdAt_idx" ON "catalog_publication_events"("releaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_head" ADD CONSTRAINT "catalog_head_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_service_versions" ADD CONSTRAINT "catalog_service_versions_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_service_versions" ADD CONSTRAINT "catalog_service_versions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_size_offers" ADD CONSTRAINT "service_size_offers_releaseId_serviceId_fkey" FOREIGN KEY ("releaseId", "serviceId") REFERENCES "catalog_service_versions"("releaseId", "serviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_size_offers" ADD CONSTRAINT "service_size_offers_vehicleCategoryId_fkey" FOREIGN KEY ("vehicleCategoryId") REFERENCES "vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_work_plans" ADD CONSTRAINT "service_work_plans_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "service_size_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_hold_segments" ADD CONSTRAINT "catalog_hold_segments_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "service_work_plans"("offerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on_compatibility" ADD CONSTRAINT "add_on_compatibility_releaseId_baseServiceId_fkey" FOREIGN KEY ("releaseId", "baseServiceId") REFERENCES "catalog_service_versions"("releaseId", "serviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on_compatibility" ADD CONSTRAINT "add_on_compatibility_releaseId_addOnServiceId_fkey" FOREIGN KEY ("releaseId", "addOnServiceId") REFERENCES "catalog_service_versions"("releaseId", "serviceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_line_items" ADD CONSTRAINT "booking_line_items_offerId_releaseId_serviceId_vehicleCate_fkey" FOREIGN KEY ("offerId", "releaseId", "serviceId", "vehicleCategoryId") REFERENCES "service_size_offers"("id", "releaseId", "serviceId", "vehicleCategoryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_publishers" ADD CONSTRAINT "catalog_publishers_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_publication_events" ADD CONSTRAINT "catalog_publication_events_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_publication_events" ADD CONSTRAINT "catalog_publication_events_previousReleaseId_fkey" FOREIGN KEY ("previousReleaseId") REFERENCES "catalog_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_publication_events" ADD CONSTRAINT "catalog_publication_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cross-row/domain constraints supplement Prisma's generated foreign keys.
ALTER TABLE catalog_head ADD CONSTRAINT catalog_single_shop CHECK ("shopId"=1);
ALTER TABLE catalog_releases ADD CONSTRAINT catalog_hashes CHECK ("sourceSha256" ~ '^[a-f0-9]{64}$' AND "manifestSha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE catalog_service_versions ADD CONSTRAINT catalog_service_bounds CHECK (("referenceUnitPriceCentavos" IS NULL OR "referenceUnitPriceCentavos" BETWEEN 0 AND 100000000) AND ("warrantyMonths" IS NULL OR "warrantyMonths">0));
ALTER TABLE service_size_offers ADD CONSTRAINT catalog_offer_money CHECK (("unitPriceCentavos" IS NULL OR "unitPriceCentavos" BETWEEN 0 AND 100000000) AND ("sourceCompareAtCentavos" IS NULL OR "sourceCompareAtCentavos" BETWEEN 0 AND 100000000) AND "compareAtCentavos" IS NULL AND NOT "compareAtVerified");
ALTER TABLE service_size_offers ADD CONSTRAINT catalog_offer_state CHECK ((state <> 'OFFERED' OR "unitPriceCentavos" IS NOT NULL) AND (state <> 'NOT_OFFERED' OR ("unitPriceCentavos" IS NULL AND "sourceCompareAtCentavos" IS NULL)) AND ("bookingMode" <> 'FIXED_ONLINE' OR state='OFFERED') AND "sizeCode" IN ('MOTOR','S','M','L','XL'));
ALTER TABLE service_work_plans ADD CONSTRAINT catalog_work_plan CHECK ((kind='UNKNOWN' AND "durationMinutes" IS NULL AND "elapsedDays" IS NULL AND "bayHoldPolicy"='UNCONFIRMED') OR (kind='TIMED' AND "durationMinutes" BETWEEN 1 AND 540 AND "elapsedDays" IS NULL AND "bayHoldPolicy"='UNCONFIRMED') OR (kind='MULTI_DAY' AND "durationMinutes" IS NULL AND ("elapsedDays" IS NULL OR "elapsedDays" BETWEEN 1 AND 365)));
ALTER TABLE catalog_hold_segments ADD CONSTRAINT catalog_segment_bounds CHECK ("dayOffset" BETWEEN 0 AND 364 AND "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "startTime"<"endTime");
ALTER TABLE add_on_compatibility ADD CONSTRAINT catalog_no_self_addon CHECK ("baseServiceId"<>"addOnServiceId" AND "sizeCodes"=ARRAY['S','M','L','XL']::text[]);
ALTER TABLE booking_line_items ADD CONSTRAINT catalog_line_bounds CHECK ("order" BETWEEN 0 AND 2 AND quantity BETWEEN 1 AND 20 AND (unit<>'VEHICLE' OR quantity=1) AND (type<>'ADD_ON' OR quantity=1) AND "unitPriceCentavos" BETWEEN 0 AND 100000000 AND "subtotalCentavos" BETWEEN 0 AND 100000000 AND "subtotalCentavos"::bigint=quantity::bigint*"unitPriceCentavos" AND "addedMinutes" BETWEEN 0 AND 540 AND (("order"=0 AND type='BASE') OR ("order">0 AND type='ADD_ON')));
ALTER TABLE bookings ADD CONSTRAINT catalog_snapshot_shape CHECK (("snapshotVersion"='LEGACY_V1' AND "catalogReleaseId" IS NULL AND "catalogFingerprint" IS NULL AND "pricingAlgorithm" IS NULL AND "vehicleSizeCodeSnapshot" IS NULL) OR ("snapshotVersion"='CATALOG_V2' AND "catalogReleaseId" IS NOT NULL AND "catalogFingerprint" ~ '^[a-f0-9]{64}$' AND "pricingAlgorithm"='php-service-size-v2' AND "vehicleSizeCodeSnapshot" IN ('MOTOR','S','M','L','XL')));

CREATE FUNCTION guard_catalog_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE rid text; record_json jsonb;
BEGIN
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
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['catalog_service_versions','service_size_offers','service_work_plans','catalog_hold_segments','add_on_compatibility'] LOOP EXECUTE format('CREATE TRIGGER immutable_content BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_content()',t); END LOOP; END $$;
CREATE FUNCTION guard_catalog_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'Published release is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.state<>'DRAFT' AND (to_jsonb(NEW)-'state')<>(to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'Published release is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_release BEFORE UPDATE OR DELETE ON catalog_releases FOR EACH ROW EXECUTE FUNCTION guard_catalog_release();
CREATE FUNCTION reject_catalog_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Catalog publication audit is append-only'; END $$;
CREATE TRIGGER catalog_audit_immutable BEFORE UPDATE OR DELETE ON catalog_publication_events FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit_change();
CREATE TRIGGER catalog_audit_no_truncate BEFORE TRUNCATE ON catalog_publication_events FOR EACH STATEMENT EXECUTE FUNCTION reject_catalog_audit_change();
CREATE FUNCTION guard_catalog_relations() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.service_work_plans; s public.catalog_service_versions;
BEGIN
 IF TG_TABLE_NAME='service_size_offers' THEN
  IF NOT EXISTS(SELECT 1 FROM public.vehicle_categories WHERE id=NEW."vehicleCategoryId" AND slug=NEW."sizeCode") THEN RAISE EXCEPTION 'Offer size mismatch'; END IF;
 ELSIF TG_TABLE_NAME='service_work_plans' THEN
  SELECT v.* INTO s FROM public.service_size_offers o JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE o.id=NEW."offerId";
  IF EXISTS(SELECT 1 FROM public.service_size_offers WHERE id=NEW."offerId" AND "bookingMode"='FIXED_ONLINE') AND (NEW.kind<>'TIMED' OR s.type<>'BASE' OR s.unit<>'VEHICLE') THEN RAISE EXCEPTION 'Fixed offer requires known base-vehicle duration'; END IF;
  IF EXISTS(SELECT 1 FROM public.service_size_offers WHERE id=NEW."offerId" AND state='NOT_OFFERED') AND NEW.kind<>'UNKNOWN' THEN RAISE EXCEPTION 'Unavailable offer has no duration'; END IF;
 ELSIF TG_TABLE_NAME='catalog_hold_segments' THEN
  SELECT * INTO p FROM public.service_work_plans WHERE "offerId"=NEW."offerId";
  IF p.kind<>'MULTI_DAY' OR p."bayHoldPolicy"='UNCONFIRMED' OR (p."elapsedDays" IS NOT NULL AND NEW."dayOffset">=p."elapsedDays") THEN RAISE EXCEPTION 'Invalid hold plan'; END IF;
 ELSIF TG_TABLE_NAME='add_on_compatibility' THEN
  IF NOT EXISTS(SELECT 1 FROM public.catalog_service_versions WHERE "releaseId"=NEW."releaseId" AND "serviceId"=NEW."baseServiceId" AND type='BASE' AND "group"='WASH') OR NOT EXISTS(SELECT 1 FROM public.catalog_service_versions WHERE "releaseId"=NEW."releaseId" AND "serviceId"=NEW."addOnServiceId" AND type='ADD_ON') THEN RAISE EXCEPTION 'Invalid add-on relationship'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_offer_relations BEFORE INSERT OR UPDATE ON service_size_offers FOR EACH ROW EXECUTE FUNCTION guard_catalog_relations();
CREATE TRIGGER catalog_plan_relations BEFORE INSERT OR UPDATE ON service_work_plans FOR EACH ROW EXECUTE FUNCTION guard_catalog_relations();
CREATE TRIGGER catalog_hold_relations BEFORE INSERT OR UPDATE ON catalog_hold_segments FOR EACH ROW EXECUTE FUNCTION guard_catalog_relations();
CREATE TRIGGER catalog_addon_relations BEFORE INSERT OR UPDATE ON add_on_compatibility FOR EACH ROW EXECUTE FUNCTION guard_catalog_relations();

-- The authenticated database login is mapped by the migration owner, never supplied by a client.
CREATE FUNCTION publish_catalog(p_release text,p_hash text,p_review text,p_reason text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 FOR s IN SELECT value FROM jsonb_array_elements(document->'sizes') LOOP
  SELECT jsonb_build_object('id',id,'code',slug,'name',name,'sortOrder',"sortOrder") INTO actual FROM public.vehicle_categories WHERE id=s->>'id';
  IF actual IS DISTINCT FROM s THEN RAISE EXCEPTION 'Manifest size mismatch'; END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(document->'services') LOOP
  SELECT (to_jsonb(v)-'releaseId'-'serviceId')||jsonb_build_object('id',v."serviceId") INTO actual FROM public.catalog_service_versions v WHERE "releaseId"=r.id AND "serviceId"=s->>'id';
  IF actual IS DISTINCT FROM s-'offers' THEN RAISE EXCEPTION 'Manifest service mismatch'; END IF;
  IF jsonb_array_length(s->'offers')<>5 THEN RAISE EXCEPTION 'Missing size offer'; END IF;
  FOR o IN SELECT value FROM jsonb_array_elements(s->'offers') LOOP
   SELECT (to_jsonb(offer)-'releaseId'-'serviceId'-'promoStartsAt'-'promoEndsAt')||jsonb_build_object('durationKind',plan.kind,'durationMinutes',plan."durationMinutes",'elapsedDays',plan."elapsedDays",'bayHoldPolicy',plan."bayHoldPolicy") INTO actual FROM public.service_size_offers offer JOIN public.service_work_plans plan ON plan."offerId"=offer.id WHERE offer.id=o->>'id' AND offer."releaseId"=r.id AND offer."serviceId"=s->>'id';
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
REVOKE ALL ON FUNCTION publish_catalog(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON catalog_publishers,catalog_publication_events FROM PUBLIC;
-- Known runtime role cannot publish or modify catalog data. Role provisioning stays explicit.
DO $$ DECLARE t text; BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 FOREACH t IN ARRAY ARRAY['catalog_releases','catalog_head','catalog_service_versions','service_size_offers','service_work_plans','catalog_hold_segments','add_on_compatibility','booking_line_items','catalog_publishers','catalog_publication_events'] LOOP EXECUTE format('REVOKE ALL ON public.%I FROM zeus_app',t); END LOOP;
 GRANT SELECT ON catalog_releases,catalog_head,catalog_service_versions,service_size_offers,service_work_plans,add_on_compatibility TO zeus_app;
 REVOKE ALL ON FUNCTION publish_catalog(text,text,text,text) FROM zeus_app;
 END IF; END $$;
-- Immutable historical financial snapshots. Lifecycle edits may change time/status only.
CREATE FUNCTION guard_booking_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."snapshotVersion",NEW."catalogReleaseId",NEW."vehicleSizeCodeSnapshot",NEW."catalogFingerprint",NEW."pricingAlgorithm",NEW."vehicleCategoryId",NEW."serviceId",NEW."durationMinutes",NEW."priceSnapshot",NEW."serviceNameSnapshot",NEW."vehicleCategoryNameSnapshot",NEW."idempotencyKey",NEW."requestHash") IS DISTINCT FROM ROW(OLD."snapshotVersion",OLD."catalogReleaseId",OLD."vehicleSizeCodeSnapshot",OLD."catalogFingerprint",OLD."pricingAlgorithm",OLD."vehicleCategoryId",OLD."serviceId",OLD."durationMinutes",OLD."priceSnapshot",OLD."serviceNameSnapshot",OLD."vehicleCategoryNameSnapshot",OLD."idempotencyKey",OLD."requestHash") THEN RAISE EXCEPTION 'Booking financial snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_booking_snapshot_immutable BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_snapshot();
CREATE TRIGGER catalog_line_immutable BEFORE UPDATE OR DELETE ON booking_line_items FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit_change();
CREATE FUNCTION validate_booking_catalog_lines() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE bid text; b public.bookings; total bigint; minutes bigint; line_count int;
BEGIN
 IF TG_TABLE_NAME='bookings' THEN bid:=NEW.id; ELSE bid:=NEW."bookingId"; END IF;
 SELECT * INTO b FROM public.bookings WHERE id=bid;
 SELECT sum("subtotalCentavos"),sum("addedMinutes"),count(*) INTO total,minutes,line_count FROM public.booking_line_items WHERE "bookingId"=bid;
 IF b."snapshotVersion"='LEGACY_V1' THEN IF line_count<>0 THEN RAISE EXCEPTION 'Legacy snapshot cannot acquire inferred lines'; END IF; RETURN NEW; END IF;
 IF line_count NOT BETWEEN 1 AND 3 OR total IS DISTINCT FROM (b."priceSnapshot"*100)::bigint OR minutes IS DISTINCT FROM b."durationMinutes"::bigint OR NOT EXISTS(SELECT 1 FROM public.booking_line_items WHERE "bookingId"=bid AND "order"=0 AND "serviceId"=b."serviceId" AND type='BASE') THEN RAISE EXCEPTION 'Incomplete catalog snapshot totals'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l JOIN public.service_size_offers o ON o.id=l."offerId" JOIN public.service_work_plans p ON p."offerId"=o.id JOIN public.catalog_service_versions v ON v."releaseId"=o."releaseId" AND v."serviceId"=o."serviceId" WHERE l."bookingId"=bid AND (l."releaseId"<>b."catalogReleaseId" OR l."vehicleCategoryId"<>b."vehicleCategoryId" OR o."sizeCode"<>b."vehicleSizeCodeSnapshot" OR l."unitPriceCentavos" IS DISTINCT FROM o."unitPriceCentavos" OR l."nameSnapshot"<>v.name OR l.unit<>v.unit OR l.type<>v.type OR o.state<>'OFFERED' OR o."bookingMode"<>'FIXED_ONLINE' OR p.kind<>'TIMED' OR l."addedMinutes" IS DISTINCT FROM p."durationMinutes")) THEN RAISE EXCEPTION 'Catalog snapshot offer mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=bid AND l."order"<>(SELECT count(*)-1 FROM public.booking_line_items prev WHERE prev."bookingId"=bid AND prev."order"<=l."order")) THEN RAISE EXCEPTION 'Noncontiguous snapshot lines'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER catalog_booking_lines AFTER INSERT ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_booking_catalog_lines();
CREATE CONSTRAINT TRIGGER catalog_line_totals AFTER INSERT ON booking_line_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_booking_catalog_lines();
-- Explicit non-null requirements avoid PostgreSQL CHECK's UNKNOWN acceptance.
ALTER TABLE service_work_plans ADD CONSTRAINT catalog_timed_minutes_present CHECK (kind<>'TIMED' OR "durationMinutes" IS NOT NULL);
ALTER TABLE bookings ADD CONSTRAINT catalog_snapshot_fields_present CHECK ("snapshotVersion"<>'CATALOG_V2' OR ("catalogReleaseId" IS NOT NULL AND "catalogFingerprint" IS NOT NULL AND "pricingAlgorithm" IS NOT NULL AND "vehicleSizeCodeSnapshot" IS NOT NULL));
CREATE FUNCTION guard_catalog_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='vehicle_categories' AND EXISTS(SELECT 1 FROM public.service_size_offers o JOIN public.catalog_releases r ON r.id=o."releaseId" WHERE o."vehicleCategoryId"=OLD.id AND r.state<>'DRAFT') THEN RAISE EXCEPTION 'Published size identity is immutable'; END IF;
 IF TG_TABLE_NAME='services' AND (NEW.id<>OLD.id OR NEW.slug<>OLD.slug) AND EXISTS(SELECT 1 FROM public.catalog_service_versions v JOIN public.catalog_releases r ON r.id=v."releaseId" WHERE v."serviceId"=OLD.id AND r.state<>'DRAFT') THEN RAISE EXCEPTION 'Published service identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER catalog_size_identity BEFORE UPDATE ON vehicle_categories FOR EACH ROW EXECUTE FUNCTION guard_catalog_identity();
CREATE TRIGGER catalog_service_identity BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION guard_catalog_identity();
CREATE FUNCTION validate_catalog_offer_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE rid text;
BEGIN
 IF TG_TABLE_NAME='service_work_plans' THEN SELECT "releaseId" INTO rid FROM public.service_size_offers WHERE id=NEW."offerId"; ELSE rid:=NEW."releaseId"; END IF;
 IF EXISTS(SELECT 1 FROM public.service_size_offers o JOIN public.catalog_service_versions s ON s."releaseId"=o."releaseId" AND s."serviceId"=o."serviceId" LEFT JOIN public.service_work_plans p ON p."offerId"=o.id WHERE o."releaseId"=rid AND (p."offerId" IS NULL OR (o."bookingMode"='FIXED_ONLINE' AND (p.kind<>'TIMED' OR s.type<>'BASE' OR s.unit<>'VEHICLE')) OR (o.state='NOT_OFFERED' AND p.kind<>'UNKNOWN'))) THEN RAISE EXCEPTION 'Inconsistent offer/work plan'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER catalog_offer_plan AFTER INSERT OR UPDATE ON service_size_offers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_catalog_offer_plan();
CREATE CONSTRAINT TRIGGER catalog_plan_offer AFTER INSERT OR UPDATE ON service_work_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_catalog_offer_plan();
CREATE CONSTRAINT TRIGGER catalog_service_plan AFTER INSERT OR UPDATE ON catalog_service_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_catalog_offer_plan();