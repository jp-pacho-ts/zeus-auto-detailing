BEGIN;
-- P1-62 A1: bay containers. EXPAND ONLY for the data (a new table, a nullable column, a fallback trigger); the one rule that is relaxed is
-- the "bay type must take the queue" check, which the OLD code also enforces by itself, so old code live during the release keeps working.
-- Nothing is dropped or renamed. bays."bayType" and bay_type_queues stay for one release as legacy placeholders (a later contract
-- migration makes containerId NOT NULL and drops them). bookings, bay_occupancies, booking_bay_assignments and the worker and audit tables
-- are not written by this migration: every existing booking and bay assignment stays exactly as it is.
-- Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then prisma/sql/p1-62-readonly-check.sql, then
-- the code. NEVER edit this file after it has been applied anywhere.
--
-- What it adds
--  * bay_containers: a named group of bays (name, unique nameKey, sortOrder, isActive, usualQueues = the optional "usually for" label as a
--    list of queue codes, empty = no label = the board never asks, legacyBayType = which old bay type a fallback bay belongs to). Three
--    starting containers (Wash, Detailing, Paint) are made from today's bay types, labelled from bay_type_queues, and every existing bay
--    is put in the container of its old type. A bay's own row (name, sort order, active flag, version token) is not changed.
--  * bays."containerId": nullable, foreign key RESTRICT. A BEFORE INSERT trigger fills a missing value with the active container of the
--    bay's legacy type (any active container if that one is gone), so the live code that creates bays keeps working.
--  * bay_container_audit_events: a separate insert-only audit trail (container created, renamed, labelled, removed, bay moved), the P1-38
--    pattern. No P1-37 object is touched.
--  * The relaxed rule: validate_bay_board() loses its two "Bay type does not take this queue" checks. It still refuses an occupancy for a
--    booking that is not open, is not a day-queue booking, or is dated after its occupancy day, and an unknown mapped queue.
--
-- How it is protected
--  * Container writes are owner-run SECURITY DEFINER functions (search_path pg_catalog, public, pg_temp with pg_temp LAST, every object
--    schema-qualified): they take the shop lock (746001, 1), require an active ADMIN or MANAGER (admin_assert_actor, from P1-37), lock the
--    row, check the version (updatedAt) and write the row and its audit row together. zeus_app gets SELECT on bay_containers and EXECUTE on
--    the four functions, and NOTHING on the audit table and no new column privilege on bays (a bay is moved only through admin_bay_move).
--    PUBLIC is revoked HERE, not only in runtime-role.sql.
--  * A deferred check: at least one active container always exists, and an active bay never sits in a removed container. Containers are
--    never deleted; removing one deactivates it (its name stays reserved).
--  * admin_container_create takes a browser-made id: the same id with the same content returns the existing row, a different content is
--    refused, so a retry after a lost response cannot add a second container.
--
-- Error codes the service maps: ZK001 not found, ZK002 stale version, ZK004 container holds an active bay or a car, ZK005 the last active
-- container, ZK006 invalid input, ZK007 duplicate name, ZK010 container removed. A non-admin actor is ZT004.
--
-- Down steps (documented only; Prisma does not run them). Rows already written cannot be un-written.
--   restore validate_bay_board() from migration 20261020000000_bay_board (with pg_temp last, as migration 20261105000000 set it);
--   DROP TRIGGER bays_default_container ON bays; ALTER TABLE bays DROP COLUMN "containerId";
--   DROP FUNCTION admin_container_create(text, text, text, text[]), admin_container_update(text, text, timestamptz, text, text[], boolean), admin_container_remove(text, text, timestamptz),
--     admin_bay_move(text, text, text, timestamptz), default_bay_container(), check_bay_containers(), guard_container_audit_insert(), reject_bay_container_change();
--   DROP TABLE bay_container_audit_events, bay_containers; DROP TYPE "BayContainerAuditAction";

CREATE TYPE "BayContainerAuditAction" AS ENUM ('CONTAINER_CREATED', 'CONTAINER_RENAMED', 'CONTAINER_LABEL_SET', 'CONTAINER_REMOVED', 'BAY_MOVED');

-- 1. Containers
CREATE TABLE "bay_containers" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "usualQueues" TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  "legacyBayType" "BayType",
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bay_containers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bay_containers_name" CHECK ("name" = btrim("name") AND length("name") BETWEEN 1 AND 40),
  CONSTRAINT "bay_containers_nameKey" CHECK ("nameKey" = lower("name")),
  CONSTRAINT "bay_containers_sortOrder" CHECK ("sortOrder" BETWEEN 0 AND 10000),
  CONSTRAINT "bay_containers_usualQueues" CHECK (cardinality("usualQueues") <= 10 AND array_position("usualQueues", NULL) IS NULL)
);
CREATE UNIQUE INDEX "bay_containers_nameKey_key" ON "bay_containers"("nameKey");

-- Three starting containers from today's bay types. A bay already named like one of them (case-insensitive) must not stop the release:
-- the container then gets " area" added.
INSERT INTO "bay_containers" ("name", "nameKey", "sortOrder", "usualQueues", "legacyBayType")
SELECT n.name, lower(n.name), v.ord,
       COALESCE((SELECT array_agg(m."queueCode" ORDER BY m."queueCode") FROM "bay_type_queues" m WHERE m."bayType" = v.t), ARRAY[]::text[]), v.t
FROM (VALUES ('Wash', 0, 'WASH'::"BayType"), ('Detailing', 1, 'DETAILING'::"BayType"), ('Paint', 2, 'PAINT'::"BayType")) v(base, ord, t)
CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS(SELECT 1 FROM "bays" y WHERE y."nameKey" = lower(v.base)) THEN v.base || ' area' ELSE v.base END AS name) n;

-- 2. bays.containerId (nullable) and the backfill. Only this column changes: the bay's name, sort order, active flag and version token do not.
ALTER TABLE "bays" ADD COLUMN "containerId" TEXT;
ALTER TABLE "bays" ADD CONSTRAINT "bays_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "bay_containers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bays_containerId_idx" ON "bays"("containerId");
UPDATE "bays" y SET "containerId" = c."id" FROM "bay_containers" c WHERE c."legacyBayType" = y."bayType";

-- The fallback for code that creates a bay without a container: the active container of the bay's legacy type, else the first active one.
CREATE FUNCTION default_bay_container() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."containerId" IS NULL THEN
  SELECT c."id" INTO NEW."containerId" FROM public.bay_containers c WHERE c."isActive"
   ORDER BY (c."legacyBayType" IS NOT DISTINCT FROM NEW."bayType") DESC, c."sortOrder", c."id" LIMIT 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bays_default_container BEFORE INSERT ON bays FOR EACH ROW EXECUTE FUNCTION default_bay_container();

-- 3. Guards on the new table: the shop lock (as every board writer), never deleted, and a deferred check of the two standing rules.
CREATE TRIGGER bay_containers_lock BEFORE INSERT OR UPDATE OR DELETE ON bay_containers FOR EACH ROW EXECUTE FUNCTION lock_bay_board();
CREATE FUNCTION reject_bay_container_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME = 'bay_containers' THEN RAISE EXCEPTION 'Bay containers cannot be deleted'; END IF;
 RAISE EXCEPTION 'Bay container audit is append-only';
END $$;
CREATE TRIGGER bay_containers_no_delete BEFORE DELETE OR TRUNCATE ON bay_containers FOR EACH STATEMENT EXECUTE FUNCTION reject_bay_container_change();
CREATE FUNCTION check_bay_containers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.bay_containers WHERE "isActive") THEN RAISE EXCEPTION 'At least one container must stay' USING ERRCODE = 'ZK005'; END IF;
 IF EXISTS(SELECT 1 FROM public.bays b JOIN public.bay_containers c ON c.id = b."containerId" WHERE b."isActive" AND NOT c."isActive") THEN
  RAISE EXCEPTION 'A removed container cannot hold an active bay' USING ERRCODE = 'ZK004';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bay_containers_standing_rules AFTER INSERT OR UPDATE ON bay_containers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_bay_containers();
CREATE CONSTRAINT TRIGGER bays_standing_rules AFTER INSERT OR UPDATE OF "containerId", "isActive" ON bays DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_bay_containers();

-- 4. The relaxed placement rule. Same function and triggers as migration 20261020000000 (path with pg_temp last, as migration 20261105000000
-- set it); the two "Bay type does not take this queue" checks are gone, the rest stays.
CREATE OR REPLACE FUNCTION validate_bay_board() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.bay_type_queues m LEFT JOIN public.booking_queues q ON q.code=m."queueCode" WHERE q.code IS NULL) THEN RAISE EXCEPTION 'Unknown mapped queue'; END IF;
 IF EXISTS(SELECT 1 FROM public.bay_occupancies a JOIN public.bookings b ON b.id=a."bookingId" WHERE b."snapshotVersion"::text<>'QUEUE_V3' OR b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') OR a.date<b."bookingDate") THEN RAISE EXCEPTION 'Invalid open bay occupancy'; END IF;
 RETURN NULL; END $$;

-- 5. Audit (insert-only; the targets are plain text with no foreign key so the trail outlives anything)
CREATE TABLE "bay_container_audit_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action" "BayContainerAuditAction" NOT NULL,
  "actorStaffId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "relatedId" TEXT,
  "targetLabel" TEXT,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bay_container_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bay_container_audit_shape" CHECK (COALESCE(
    length("targetId") BETWEEN 1 AND 64 AND ("relatedId" IS NULL OR ("action"::text = 'BAY_MOVED' AND length("relatedId") BETWEEN 1 AND 64))
    AND ("targetLabel" IS NULL OR ("action"::text = 'CONTAINER_REMOVED' AND length("targetLabel") BETWEEN 1 AND 40))
    AND CASE "action"::text WHEN 'BAY_MOVED' THEN "relatedId" IS NOT NULL WHEN 'CONTAINER_REMOVED' THEN "targetLabel" IS NOT NULL ELSE true END, false))
);
ALTER TABLE "bay_container_audit_events" ADD CONSTRAINT "bay_container_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bay_container_audit_events_targetId_createdAt_idx" ON "bay_container_audit_events"("targetId", "createdAt");
CREATE FUNCTION guard_container_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Bay container audit txId must be the inserting transaction'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER bay_container_audit_insert BEFORE INSERT ON bay_container_audit_events FOR EACH ROW EXECUTE FUNCTION guard_container_audit_insert();
CREATE TRIGGER bay_container_audit_immutable BEFORE UPDATE OR DELETE ON bay_container_audit_events FOR EACH ROW EXECUTE FUNCTION reject_bay_container_change();
CREATE TRIGGER bay_container_audit_no_truncate BEFORE TRUNCATE ON bay_container_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_bay_container_change();

-- 6. Functions. A uuid is the only id shape accepted from the browser. The version of a container or bay is its updatedAt, compared to the
-- millisecond (the board sends it back as an ISO string).
CREATE FUNCTION admin_container_create(p_actor text, p_id text, p_name text, p_queues text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_name text := btrim(p_name); v_queues text[] := COALESCE(p_queues, ARRAY[]::text[]); x public.bay_containers;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 40
    OR cardinality(v_queues) > 10 OR array_position(v_queues, NULL) IS NOT NULL
    OR (SELECT count(DISTINCT q) FROM unnest(v_queues) q) <> cardinality(v_queues)
    OR EXISTS(SELECT 1 FROM unnest(v_queues) q WHERE NOT EXISTS(SELECT 1 FROM public.booking_queues bq WHERE bq.code = q)) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZK006';
 END IF;
 -- A retry (same id, same content) returns the container that is already there.
 SELECT * INTO x FROM public.bay_containers WHERE id = p_id;
 IF FOUND THEN
  IF x.name = v_name AND x."usualQueues" = v_queues THEN RETURN jsonb_build_object('id', p_id, 'replayed', true); END IF;
  RAISE EXCEPTION 'That container id was already used for something else' USING ERRCODE = 'ZK006';
 END IF;
 IF EXISTS(SELECT 1 FROM public.bay_containers WHERE "nameKey" = lower(v_name)) OR EXISTS(SELECT 1 FROM public.bays WHERE "nameKey" = lower(v_name)) THEN
  RAISE EXCEPTION 'A container or bay with that name already exists' USING ERRCODE = 'ZK007';
 END IF;
 INSERT INTO public.bay_containers (id, name, "nameKey", "sortOrder", "usualQueues")
  VALUES (p_id, v_name, lower(v_name), LEAST(COALESCE((SELECT max("sortOrder") + 1 FROM public.bay_containers), 0), 10000), v_queues);
 INSERT INTO public.bay_container_audit_events (action, "actorStaffId", "targetId") VALUES ('CONTAINER_CREATED', p_actor, p_id);
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- Rename and/or set the label. A NULL name leaves the name alone; p_set_queues says whether p_queues (possibly empty) replaces the label.
CREATE FUNCTION admin_container_update(p_actor text, p_id text, p_expected timestamptz, p_name text, p_queues text[], p_set_queues boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.bay_containers; v_name text := btrim(p_name); v_queues text[] := COALESCE(p_queues, ARRAY[]::text[]); v_rename boolean; v_label boolean; v_at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_expected IS NULL OR (p_name IS NOT NULL AND (v_name = '' OR length(v_name) > 40)) OR (p_name IS NULL AND NOT COALESCE(p_set_queues, false))
    OR (COALESCE(p_set_queues, false) AND (cardinality(v_queues) > 10 OR array_position(v_queues, NULL) IS NOT NULL
        OR (SELECT count(DISTINCT q) FROM unnest(v_queues) q) <> cardinality(v_queues)
        OR EXISTS(SELECT 1 FROM unnest(v_queues) q WHERE NOT EXISTS(SELECT 1 FROM public.booking_queues bq WHERE bq.code = q)))) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZK006';
 END IF;
 SELECT * INTO x FROM public.bay_containers WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Container not found' USING ERRCODE = 'ZK001'; END IF;
 IF date_trunc('milliseconds', x."updatedAt") <> date_trunc('milliseconds', p_expected) THEN RAISE EXCEPTION 'Container changed' USING ERRCODE = 'ZK002'; END IF;
 IF NOT x."isActive" THEN RAISE EXCEPTION 'Container was removed' USING ERRCODE = 'ZK010'; END IF;
 v_rename := p_name IS NOT NULL AND v_name <> x.name;
 v_label := COALESCE(p_set_queues, false) AND v_queues <> x."usualQueues";
 IF NOT v_rename AND NOT v_label THEN RETURN jsonb_build_object('changed', false); END IF;
 IF v_rename AND lower(v_name) <> x."nameKey" AND (EXISTS(SELECT 1 FROM public.bay_containers WHERE "nameKey" = lower(v_name) AND id <> p_id) OR EXISTS(SELECT 1 FROM public.bays WHERE "nameKey" = lower(v_name))) THEN
  RAISE EXCEPTION 'A container or bay with that name already exists' USING ERRCODE = 'ZK007';
 END IF;
 v_at := GREATEST(date_trunc('milliseconds', clock_timestamp()), x."updatedAt" + interval '1 millisecond');
 UPDATE public.bay_containers SET name = CASE WHEN v_rename THEN v_name ELSE name END, "nameKey" = CASE WHEN v_rename THEN lower(v_name) ELSE "nameKey" END,
   "usualQueues" = CASE WHEN v_label THEN v_queues ELSE "usualQueues" END, "updatedAt" = v_at WHERE id = p_id;
 IF v_rename THEN INSERT INTO public.bay_container_audit_events (action, "actorStaffId", "targetId") VALUES ('CONTAINER_RENAMED', p_actor, p_id); END IF;
 IF v_label THEN INSERT INTO public.bay_container_audit_events (action, "actorStaffId", "targetId") VALUES ('CONTAINER_LABEL_SET', p_actor, p_id); END IF;
 RETURN jsonb_build_object('changed', true);
END $$;

-- Remove = deactivate: only a container with no active bay (so no car), never the last active one. Its name stays reserved.
CREATE FUNCTION admin_container_remove(p_actor text, p_id text, p_expected timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.bay_containers;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_expected IS NULL THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZK006'; END IF;
 SELECT * INTO x FROM public.bay_containers WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Container not found' USING ERRCODE = 'ZK001'; END IF;
 IF date_trunc('milliseconds', x."updatedAt") <> date_trunc('milliseconds', p_expected) THEN RAISE EXCEPTION 'Container changed' USING ERRCODE = 'ZK002'; END IF;
 IF NOT x."isActive" THEN RETURN jsonb_build_object('changed', false); END IF;
-- The last active container is never removed, whatever it holds; any other one only when it holds no active bay and no car.
 IF NOT EXISTS(SELECT 1 FROM public.bay_containers WHERE "isActive" AND id <> p_id) THEN RAISE EXCEPTION 'At least one container must stay' USING ERRCODE = 'ZK005'; END IF;
 IF EXISTS(SELECT 1 FROM public.bays b WHERE b."containerId" = p_id AND (b."isActive" OR EXISTS(SELECT 1 FROM public.bay_occupancies o WHERE o."bayId" = b.id))) THEN
  RAISE EXCEPTION 'Move or remove its bays first' USING ERRCODE = 'ZK004';
 END IF;
 UPDATE public.bay_containers SET "isActive" = false, "updatedAt" = GREATEST(date_trunc('milliseconds', clock_timestamp()), x."updatedAt" + interval '1 millisecond') WHERE id = p_id;
 INSERT INTO public.bay_container_audit_events (action, "actorStaffId", "targetId", "targetLabel") VALUES ('CONTAINER_REMOVED', p_actor, p_id, x.name);
 RETURN jsonb_build_object('changed', true);
END $$;

-- Move a bay to any active container (a car in it stays in it). The bay's own version token (updatedAt) moves too.
CREATE FUNCTION admin_bay_move(p_actor text, p_bay text, p_container text, p_expected timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE y public.bays; c public.bay_containers;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_bay IS NULL OR p_bay = '' OR p_container IS NULL OR p_container = '' OR p_expected IS NULL THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZK006'; END IF;
 SELECT * INTO y FROM public.bays WHERE id = p_bay FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bay not found' USING ERRCODE = 'ZK001'; END IF;
 SELECT * INTO c FROM public.bay_containers WHERE id = p_container FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Container not found' USING ERRCODE = 'ZK001'; END IF;
 IF date_trunc('milliseconds', y."updatedAt") <> date_trunc('milliseconds', p_expected) THEN RAISE EXCEPTION 'Bay changed' USING ERRCODE = 'ZK002'; END IF;
 IF NOT c."isActive" THEN RAISE EXCEPTION 'Container was removed' USING ERRCODE = 'ZK010'; END IF;
 IF y."containerId" IS NOT DISTINCT FROM p_container THEN RETURN jsonb_build_object('changed', false); END IF;
 UPDATE public.bays SET "containerId" = p_container, "updatedAt" = GREATEST(date_trunc('milliseconds', clock_timestamp()), y."updatedAt" + interval '1 millisecond') WHERE id = p_bay;
 INSERT INTO public.bay_container_audit_events (action, "actorStaffId", "targetId", "relatedId") VALUES ('BAY_MOVED', p_actor, p_bay, p_container);
 RETURN jsonb_build_object('changed', true);
END $$;

-- 7. Privileges. Closed to PUBLIC here (not only in runtime-role.sql): the migration runs first, with the old code live.
REVOKE ALL ON "bay_containers", "bay_container_audit_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_container_create(text, text, text, text[]), admin_container_update(text, text, timestamptz, text, text[], boolean), admin_container_remove(text, text, timestamptz),
  admin_bay_move(text, text, text, timestamptz), check_bay_containers(), default_bay_container(), guard_container_audit_insert(), reject_bay_container_change() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "bay_containers", "bay_container_audit_events" FROM zeus_app;
 GRANT SELECT ON "bay_containers" TO zeus_app;
 GRANT EXECUTE ON FUNCTION admin_container_create(text, text, text, text[]), admin_container_update(text, text, timestamptz, text, text[], boolean), admin_container_remove(text, text, timestamptz),
  admin_bay_move(text, text, text, timestamptz) TO zeus_app;
END IF; END $$;
COMMIT;
