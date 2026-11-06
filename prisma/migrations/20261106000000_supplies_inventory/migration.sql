BEGIN;
-- P1-38: Supplies & Inventory. EXPAND ONLY: three new tables, two new enums and new functions. Nothing is dropped, renamed or narrowed,
-- so the code that is live while this runs keeps working. The legacy inventory_items, service_recipes and inventory_transactions
-- tables stay, unused, until a separate contract migration (P1-38b). delete_booking() is not touched. No P1-37 object is touched.
-- Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then prisma/sql/p1-38-readonly-check.sql,
-- then the code. NEVER edit this file after it has been applied anywhere.
--
-- What it adds
--  * supply_items: one row per supply (name, unit, category, current stock, reorder level, cost per unit in integer centavos). Stock is a
--    whole number between 0 and 1,000,000,000. nameKey (the lower-cased name) is unique, archived items included, so a name stays reserved.
--  * supply_movements: the insert-only history. kind is OPENING (starting stock), RECEIVE (stock in) or USE (stock used). There is no
--    ADJUST (LE 2026-11-06): stock goes down only by recording that it was used, and a wrong USE is fixed with a RECEIVE and a note.
--    The item's stock is explained by its movements: a deferred constraint trigger re-derives it from the deltas at commit.
--  * supply_audit_events: a separate insert-only audit trail for item add, edit, archive, restore and delete (PM decision 2026-11-06:
--    P1-37's admin_audit_events is not reused). It holds field NAMES only, never values, and the item name only on SUPPLY_DELETED.
--
-- How it is protected
--  * The runtime role (zeus_app) gets SELECT on supply_items and supply_movements and NOTHING on supply_audit_events. Every write is a
--    SECURITY DEFINER function owned by the migration owner (search_path pg_catalog, public, pg_temp with pg_temp LAST, every object
--    schema-qualified), EXECUTE for zeus_app only; PUBLIC is revoked HERE, not only in runtime-role.sql.
--  * Each function takes the shop lock (746001, 1), requires an active ADMIN or MANAGER actor (admin_assert_actor, from P1-37),
--    locks the item row, validates, and writes the row, its movement and its audit row in one transaction.
--  * Idempotency (the browser makes the movement id and the item id): the same id with the same content returns the existing row, and in
--    admin_supply_stock that REPLAY check runs BEFORE the revision check, because a retried form still carries the old revision. The
--    same id with different content is refused.
--
-- Error codes the service maps: ZS001 not found, ZS002 stale revision, ZS006 invalid input, ZS007 duplicate name, ZS008 not enough stock,
-- ZS010 item is archived, ZS011 more than the largest stock. A non-admin actor is ZT004 (admin_assert_actor).
--
-- Down steps (documented only; Prisma does not run them). Rows already written cannot be un-written.
--   DROP FUNCTION admin_supply_create(text, text, text, text, text, integer, integer, bigint), admin_supply_update(text, text, integer, text, text, boolean, text, integer, integer),
--     admin_supply_stock(text, text, text, integer, text, bigint, integer, text), admin_supply_remove(text, text, integer), admin_supply_restore(text, text, integer),
--     check_supply_consistency(), supply_stock_matches_history(text), guard_supply_movement_insert(), guard_supply_audit_insert(), reject_supply_change();
--   DROP TABLE supply_audit_events, supply_movements, supply_items;  DROP TYPE "SupplyAuditAction", "SupplyMovementKind";

CREATE TYPE "SupplyMovementKind" AS ENUM ('OPENING', 'RECEIVE', 'USE');
CREATE TYPE "SupplyAuditAction" AS ENUM ('SUPPLY_CREATED', 'SUPPLY_UPDATED', 'SUPPLY_ARCHIVED', 'SUPPLY_RESTORED', 'SUPPLY_DELETED');

-- 1. Items
CREATE TABLE "supply_items" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "category" TEXT,
  "unit" TEXT NOT NULL,
  "currentStock" INTEGER NOT NULL DEFAULT 0,
  "reorderLevel" INTEGER NOT NULL DEFAULT 0,
  "costPerUnitCentavos" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supply_items_name" CHECK ("name" = btrim("name") AND length("name") BETWEEN 1 AND 80),
  CONSTRAINT "supply_items_nameKey" CHECK ("nameKey" = lower("name")),
  CONSTRAINT "supply_items_category" CHECK ("category" IS NULL OR ("category" = btrim("category") AND length("category") BETWEEN 1 AND 60)),
  CONSTRAINT "supply_items_unit" CHECK ("unit" = btrim("unit") AND length("unit") BETWEEN 1 AND 20),
  CONSTRAINT "supply_items_stock_range" CHECK ("currentStock" BETWEEN 0 AND 1000000000),
  CONSTRAINT "supply_items_reorder_range" CHECK ("reorderLevel" BETWEEN 0 AND 1000000000),
  CONSTRAINT "supply_items_cost_range" CHECK ("costPerUnitCentavos" BETWEEN 0 AND 100000000),
  CONSTRAINT "supply_items_revision" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "supply_items_nameKey_key" ON "supply_items"("nameKey");

-- 2. Movements (insert-only). "seq" gives the true order inside one transaction (createdAt is the transaction time).
CREATE TABLE "supply_movements" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
  "itemId" TEXT NOT NULL,
  "kind" "SupplyMovementKind" NOT NULL,
  "delta" INTEGER NOT NULL,
  "stockAfter" INTEGER NOT NULL,
  "unitCostCentavos" INTEGER,
  "note" TEXT,
  "actorStaffId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supply_movements_delta" CHECK (("kind"::text IN ('OPENING', 'RECEIVE') AND "delta" BETWEEN 1 AND 1000000000) OR ("kind"::text = 'USE' AND "delta" BETWEEN -1000000000 AND -1)),
  CONSTRAINT "supply_movements_stockAfter" CHECK ("stockAfter" BETWEEN 0 AND 1000000000),
  CONSTRAINT "supply_movements_cost" CHECK ("unitCostCentavos" IS NULL OR ("kind"::text <> 'USE' AND "unitCostCentavos" BETWEEN 0 AND 100000000)),
  CONSTRAINT "supply_movements_note" CHECK ("note" IS NULL OR ("kind"::text <> 'OPENING' AND "note" = btrim("note") AND length("note") BETWEEN 1 AND 200))
);
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "supply_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supply_movements" ADD CONSTRAINT "supply_movements_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "supply_movements_seq_key" ON "supply_movements"("seq");
CREATE INDEX "supply_movements_itemId_seq_idx" ON "supply_movements"("itemId", "seq");

-- 3. Audit (insert-only; the target is plain text with no foreign key so the trail outlives a deleted item)
CREATE TABLE "supply_audit_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action" "SupplyAuditAction" NOT NULL,
  "actorStaffId" TEXT NOT NULL,
  "targetSupplyId" TEXT NOT NULL,
  "targetLabel" TEXT,
  "changedFields" TEXT,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supply_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supply_audit_shape" CHECK (COALESCE(
    length("targetSupplyId") BETWEEN 1 AND 64
    AND ("targetLabel" IS NULL OR ("action"::text = 'SUPPLY_DELETED' AND length("targetLabel") BETWEEN 1 AND 80))
    AND ("changedFields" IS NULL OR ("action"::text = 'SUPPLY_UPDATED' AND "changedFields" ~ '^[a-zA-Z,]{1,60}$'))
    AND CASE "action"::text WHEN 'SUPPLY_UPDATED' THEN "changedFields" IS NOT NULL WHEN 'SUPPLY_DELETED' THEN "targetLabel" IS NOT NULL ELSE true END, false))
);
ALTER TABLE "supply_audit_events" ADD CONSTRAINT "supply_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "supply_audit_events_targetSupplyId_createdAt_idx" ON "supply_audit_events"("targetSupplyId", "createdAt");

-- 4. Guards: stamped times, append-only, and the history that explains the stock
CREATE FUNCTION guard_supply_movement_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN NEW."createdAt" := CURRENT_TIMESTAMP; RETURN NEW; END $$;
CREATE TRIGGER supply_movement_insert BEFORE INSERT ON supply_movements FOR EACH ROW EXECUTE FUNCTION guard_supply_movement_insert();
CREATE FUNCTION guard_supply_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Supply audit txId must be the inserting transaction'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER supply_audit_insert BEFORE INSERT ON supply_audit_events FOR EACH ROW EXECUTE FUNCTION guard_supply_audit_insert();
CREATE FUNCTION reject_supply_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Supply history and audit are append-only'; END $$;
CREATE TRIGGER supply_movement_immutable BEFORE UPDATE OR DELETE ON supply_movements FOR EACH ROW EXECUTE FUNCTION reject_supply_change();
CREATE TRIGGER supply_movement_no_truncate BEFORE TRUNCATE ON supply_movements FOR EACH STATEMENT EXECUTE FUNCTION reject_supply_change();
CREATE TRIGGER supply_audit_immutable BEFORE UPDATE OR DELETE ON supply_audit_events FOR EACH ROW EXECUTE FUNCTION reject_supply_change();
CREATE TRIGGER supply_audit_no_truncate BEFORE TRUNCATE ON supply_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_supply_change();

-- The stock equals the sum of the item's deltas, and every stockAfter is the running sum in true (seq) order. shortcut: this reads every
-- movement of the one item at commit, which is fine at shop scale; upgrade (a running total) only if one item ever holds thousands.
CREATE FUNCTION supply_stock_matches_history(p_item text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT i."currentStock" FROM public.supply_items i WHERE i.id = p_item), 0) = COALESCE((SELECT sum(m.delta) FROM public.supply_movements m WHERE m."itemId" = p_item), 0)
   AND NOT EXISTS(SELECT 1 FROM (SELECT m."stockAfter" AS after, sum(m.delta) OVER (ORDER BY m.seq) AS run FROM public.supply_movements m WHERE m."itemId" = p_item) t WHERE t.after <> t.run)
$$;
CREATE FUNCTION check_supply_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_item text;
BEGIN
 -- Two IFs, not one CASE: plpgsql resolves every NEW.field in an expression, and each table's row lacks the other's column.
 IF TG_TABLE_NAME = 'supply_movements' THEN v_item := NEW."itemId"; ELSE v_item := NEW.id; END IF;
 -- A deleted item has no row and no movements (a delete is allowed only when there are none), so there is nothing to check for it.
 IF EXISTS(SELECT 1 FROM public.supply_items WHERE id = v_item) AND NOT public.supply_stock_matches_history(v_item) THEN
  RAISE EXCEPTION 'The stock of a supply must equal its history' USING ERRCODE = 'ZS009';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supply_movements_consistent AFTER INSERT ON supply_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_supply_consistency();
CREATE CONSTRAINT TRIGGER supply_items_consistent AFTER INSERT OR UPDATE OF "currentStock" ON supply_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_supply_consistency();

-- 5. Functions. A uuid is the only id shape accepted from the browser.
CREATE FUNCTION admin_supply_create(p_actor text, p_id text, p_name text, p_category text, p_unit text, p_reorder integer, p_cost integer, p_start bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_name text := btrim(p_name); v_cat text := NULLIF(btrim(p_category), ''); v_unit text := btrim(p_unit); v_start bigint := COALESCE(p_start, 0); x public.supply_items; v_open integer;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 80
    OR (v_cat IS NOT NULL AND length(v_cat) > 60) OR v_unit IS NULL OR length(v_unit) NOT BETWEEN 1 AND 20
    OR p_reorder IS NULL OR p_reorder NOT BETWEEN 0 AND 1000000000 OR p_cost IS NULL OR p_cost NOT BETWEEN 0 AND 100000000 OR v_start NOT BETWEEN 0 AND 1000000000 THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZS006';
 END IF;
 -- A retry (same id, same content) returns the row that is already there.
 SELECT * INTO x FROM public.supply_items WHERE id = p_id;
 IF FOUND THEN
  SELECT m.delta INTO v_open FROM public.supply_movements m WHERE m."itemId" = p_id AND m.kind = 'OPENING';
  IF x.name = v_name AND x.category IS NOT DISTINCT FROM v_cat AND x.unit = v_unit AND x."reorderLevel" = p_reorder AND x."costPerUnitCentavos" = p_cost AND COALESCE(v_open, 0) = v_start THEN
   RETURN jsonb_build_object('id', p_id, 'replayed', true);
  END IF;
  RAISE EXCEPTION 'That item id was already used for something else' USING ERRCODE = 'ZS006';
 END IF;
 IF EXISTS(SELECT 1 FROM public.supply_items WHERE "nameKey" = lower(v_name)) THEN RAISE EXCEPTION 'An item with that name already exists' USING ERRCODE = 'ZS007'; END IF;
 INSERT INTO public.supply_items (id, name, "nameKey", category, unit, "currentStock", "reorderLevel", "costPerUnitCentavos") VALUES (p_id, v_name, lower(v_name), v_cat, v_unit, v_start, p_reorder, p_cost);
 IF v_start > 0 THEN
  INSERT INTO public.supply_movements ("itemId", kind, delta, "stockAfter", "unitCostCentavos", "actorStaffId") VALUES (p_id, 'OPENING', v_start, v_start, NULL, p_actor);
 END IF;
 INSERT INTO public.supply_audit_events (action, "actorStaffId", "targetSupplyId") VALUES ('SUPPLY_CREATED', p_actor, p_id);
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- Edits. A NULL argument leaves the field alone; p_clear_category clears the category. Nothing changes (no revision bump) when no value differs.
CREATE FUNCTION admin_supply_update(p_actor text, p_id text, p_revision integer, p_name text, p_category text, p_clear_category boolean, p_unit text, p_reorder integer, p_cost integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.supply_items; v_name text := btrim(p_name); v_cat text := NULLIF(btrim(p_category), ''); v_unit text := btrim(p_unit); changed text[] := ARRAY[]::text[];
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 OR (p_name IS NOT NULL AND (v_name = '' OR length(v_name) > 80))
    OR (p_category IS NOT NULL AND (v_cat IS NULL OR length(v_cat) > 60)) OR (p_unit IS NOT NULL AND (v_unit = '' OR length(v_unit) > 20))
    OR (p_reorder IS NOT NULL AND p_reorder NOT BETWEEN 0 AND 1000000000) OR (p_cost IS NOT NULL AND p_cost NOT BETWEEN 0 AND 100000000) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZS006';
 END IF;
 SELECT * INTO x FROM public.supply_items WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = 'ZS001'; END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Item changed' USING ERRCODE = 'ZS002'; END IF;
 IF NOT x."isActive" THEN RAISE EXCEPTION 'Item is archived' USING ERRCODE = 'ZS010'; END IF;
 IF p_name IS NOT NULL AND v_name <> x.name THEN changed := array_append(changed, 'name'); END IF;
 IF (p_clear_category AND x.category IS NOT NULL) OR (NOT COALESCE(p_clear_category, false) AND p_category IS NOT NULL AND v_cat IS DISTINCT FROM x.category) THEN changed := array_append(changed, 'category'); END IF;
 IF p_unit IS NOT NULL AND v_unit <> x.unit THEN changed := array_append(changed, 'unit'); END IF;
 IF p_reorder IS NOT NULL AND p_reorder <> x."reorderLevel" THEN changed := array_append(changed, 'reorderLevel'); END IF;
 IF p_cost IS NOT NULL AND p_cost <> x."costPerUnitCentavos" THEN changed := array_append(changed, 'costPerUnit'); END IF;
 IF cardinality(changed) = 0 THEN RETURN jsonb_build_object('revision', x.revision, 'changed', false); END IF;
 IF p_name IS NOT NULL AND lower(v_name) <> x."nameKey" AND EXISTS(SELECT 1 FROM public.supply_items WHERE "nameKey" = lower(v_name) AND id <> p_id) THEN
  RAISE EXCEPTION 'An item with that name already exists' USING ERRCODE = 'ZS007';
 END IF;
 UPDATE public.supply_items SET
   name = COALESCE(v_name, name), "nameKey" = lower(COALESCE(v_name, name)),
   category = CASE WHEN p_clear_category THEN NULL WHEN p_category IS NOT NULL THEN v_cat ELSE category END,
   unit = COALESCE(v_unit, unit), "reorderLevel" = COALESCE(p_reorder, "reorderLevel"), "costPerUnitCentavos" = COALESCE(p_cost, "costPerUnitCentavos"),
   revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = p_id;
 INSERT INTO public.supply_audit_events (action, "actorStaffId", "targetSupplyId", "changedFields") VALUES ('SUPPLY_UPDATED', p_actor, p_id, array_to_string(changed, ','));
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

-- Stock in (RECEIVE) or used (USE). p_id is the movement id made by the browser. The REPLAY check comes first, before the revision check: a
-- retried form still carries the old revision. Stock arithmetic is bigint so nothing overflows before the 1,000,000,000 ceiling answers.
CREATE FUNCTION admin_supply_stock(p_actor text, p_id text, p_item text, p_revision integer, p_kind text, p_qty bigint, p_cost integer, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_note text := NULLIF(btrim(p_note), ''); m public.supply_movements; x public.supply_items; v_after bigint; v_delta bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_item IS NULL OR p_item = '' OR p_revision IS NULL OR p_revision < 1
    OR p_kind IS NULL OR p_kind NOT IN ('RECEIVE', 'USE') OR p_qty IS NULL OR p_qty NOT BETWEEN 1 AND 1000000000
    OR (p_cost IS NOT NULL AND (p_kind <> 'RECEIVE' OR p_cost NOT BETWEEN 0 AND 100000000)) OR (v_note IS NOT NULL AND length(v_note) > 200) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZS006';
 END IF;
 SELECT * INTO m FROM public.supply_movements WHERE id = p_id;
 IF FOUND THEN
  IF m."itemId" = p_item AND m.kind::text = p_kind AND abs(m.delta) = p_qty AND m."unitCostCentavos" IS NOT DISTINCT FROM p_cost AND m.note IS NOT DISTINCT FROM v_note AND m."actorStaffId" = p_actor THEN
   RETURN jsonb_build_object('id', p_id, 'replayed', true);
  END IF;
  RAISE EXCEPTION 'That movement id was already used for something else' USING ERRCODE = 'ZS006';
 END IF;
 SELECT * INTO x FROM public.supply_items WHERE id = p_item FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = 'ZS001'; END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Item changed' USING ERRCODE = 'ZS002'; END IF;
 IF NOT x."isActive" THEN RAISE EXCEPTION 'Item is archived' USING ERRCODE = 'ZS010'; END IF;
 v_delta := CASE p_kind WHEN 'RECEIVE' THEN p_qty ELSE -p_qty END;
 v_after := x."currentStock"::bigint + v_delta;
 IF v_after > 1000000000 THEN RAISE EXCEPTION 'That is more than the largest stock we can hold' USING ERRCODE = 'ZS011'; END IF;
 IF v_after < 0 THEN RAISE EXCEPTION 'Not enough stock. Only % left.', x."currentStock" USING ERRCODE = 'ZS008'; END IF;
 INSERT INTO public.supply_movements (id, "itemId", kind, delta, "stockAfter", "unitCostCentavos", note, "actorStaffId")
  VALUES (p_id, p_item, p_kind::public."SupplyMovementKind", v_delta::integer, v_after::integer, p_cost, v_note, p_actor);
 UPDATE public.supply_items SET "currentStock" = v_after::integer, "costPerUnitCentavos" = COALESCE(p_cost, "costPerUnitCentavos"), revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_item;
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- Delete: erased when the item has no movements at all (its name stays in the audit row), otherwise archived. Decided under the item lock.
CREATE FUNCTION admin_supply_remove(p_actor text, p_id text, p_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.supply_items;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZS006'; END IF;
 SELECT * INTO x FROM public.supply_items WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = 'ZS001'; END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Item changed' USING ERRCODE = 'ZS002'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.supply_movements WHERE "itemId" = p_id) THEN
  INSERT INTO public.supply_audit_events (action, "actorStaffId", "targetSupplyId", "targetLabel") VALUES ('SUPPLY_DELETED', p_actor, p_id, x.name);
  DELETE FROM public.supply_items WHERE id = p_id;
  RETURN 'DELETED';
 END IF;
 IF x."isActive" THEN
  UPDATE public.supply_items SET "isActive" = false, revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
  INSERT INTO public.supply_audit_events (action, "actorStaffId", "targetSupplyId") VALUES ('SUPPLY_ARCHIVED', p_actor, p_id);
 END IF;
 RETURN 'ARCHIVED';
END $$;

CREATE FUNCTION admin_supply_restore(p_actor text, p_id text, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.supply_items;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZS006'; END IF;
 SELECT * INTO x FROM public.supply_items WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = 'ZS001'; END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Item changed' USING ERRCODE = 'ZS002'; END IF;
 IF x."isActive" THEN RETURN jsonb_build_object('revision', x.revision, 'changed', false); END IF;
 UPDATE public.supply_items SET "isActive" = true, revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
 INSERT INTO public.supply_audit_events (action, "actorStaffId", "targetSupplyId") VALUES ('SUPPLY_RESTORED', p_actor, p_id);
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

-- 6. Privileges. Closed to PUBLIC here (not only in runtime-role.sql): the migration runs first, with the old code live.
REVOKE ALL ON "supply_items", "supply_movements", "supply_audit_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_supply_create(text, text, text, text, text, integer, integer, bigint), admin_supply_update(text, text, integer, text, text, boolean, text, integer, integer),
  admin_supply_stock(text, text, text, integer, text, bigint, integer, text), admin_supply_remove(text, text, integer), admin_supply_restore(text, text, integer),
  check_supply_consistency(), supply_stock_matches_history(text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "supply_items", "supply_movements", "supply_audit_events" FROM zeus_app;
 GRANT SELECT ON "supply_items", "supply_movements" TO zeus_app;
 GRANT EXECUTE ON FUNCTION admin_supply_create(text, text, text, text, text, integer, integer, bigint), admin_supply_update(text, text, integer, text, text, boolean, text, integer, integer),
  admin_supply_stock(text, text, text, integer, text, bigint, integer, text), admin_supply_remove(text, text, integer), admin_supply_restore(text, text, integer) TO zeus_app;
END IF; END $$;
COMMIT;
