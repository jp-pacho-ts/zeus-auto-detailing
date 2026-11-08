BEGIN;
-- P1-39: Expenses. EXPAND ONLY: new tables, enums, functions and triggers. No existing table, function or row is touched, so the code that is
-- live while this runs keeps working. Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then
-- prisma/sql/p1-39-readonly-check.sql, then the code. NEVER edit this file after it has been applied anywhere.
--
-- What it adds
--  * expense_categories: the editable list, seeded below. A category is never deleted (hide it instead) and its name stays reserved. The two
--    derived lines on the screen ("Stock bought", "Commissions paid") are reserved names, so a typed line cannot look like them.
--  * expenses: one row per typed expense, integer centavos. A removal sets voidedAt: it hides and never erases (LE default, 2026-11-07).
--  * expense_events and expense_category_events: insert-only history, with a full snapshot per change (the name at that time), and no foreign
--    key to the row they describe.
--  * Stock bought and commissions paid are NOT copied here. They are read from supply_movements and commission_* at read time (plan s3 A), so
--    nothing can be counted twice and no live function changes.
--
-- How it is protected
--  * zeus_app gets SELECT on the four tables and EXECUTE on the six writers, nothing else. Every write is a SECURITY DEFINER function owned by
--    the migration owner (search_path pg_catalog, public, pg_temp, pg_temp LAST, every object schema-qualified). PUBLIC is revoked HERE.
--  * Each function takes its own advisory lock (746001, 2), so concurrent identical writes serialise. The service also goes through mutate(), which
--    takes the shop lock (746001, 1) first, always in that order, so the two keys cannot deadlock each other.
--  * Then it requires an active ADMIN or MANAGER actor (admin_assert_actor, from P1-37).
--  * Idempotency: the browser makes the expense and category ids. Same id and same content returns the existing row, a different content is
--    refused. An edit that already equals the requested values returns unchanged BEFORE the revision check (a retry carries the old revision).
--
-- Error codes the service maps: ZX001 not found, ZX002 stale revision, ZX006 invalid input, ZX007 duplicate category name, ZX010 category hidden,
-- ZX011 expense removed, ZX012 date out of range, ZX013 reserved category name, ZX014 last active category, ZX015 too many categories. A non-admin
-- actor is ZT004 (admin_assert_actor).
--
-- Down steps (documented only; Prisma does not run them). Rows already written cannot be un-written.
--   DROP FUNCTION admin_expense_create(text, text, date, text, bigint, text, text), admin_expense_update(text, text, integer, date, text, bigint, text, text),
--     admin_expense_void(text, text, integer, text), admin_expense_restore(text, text, integer), admin_category_create(text, text, text),
--     admin_category_update(text, text, integer, text, boolean), guard_expense_event_insert(), reject_expense_change();
--   DROP TABLE expense_category_events, expense_events, expenses, expense_categories;  DROP TYPE "ExpenseCategoryEventKind", "ExpenseEventKind";

CREATE TYPE "ExpenseEventKind" AS ENUM ('CREATED', 'EDITED', 'VOIDED', 'RESTORED');
CREATE TYPE "ExpenseCategoryEventKind" AS ENUM ('CREATED', 'RENAMED', 'HIDDEN', 'SHOWN');

-- 1. Categories
CREATE TABLE "expense_categories" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_categories_name" CHECK ("name" = btrim("name") AND length("name") BETWEEN 1 AND 40),
  CONSTRAINT "expense_categories_nameKey" CHECK ("nameKey" = lower("name")),
  CONSTRAINT "expense_categories_reserved" CHECK ("nameKey" NOT IN ('stock bought', 'commissions paid')),
  CONSTRAINT "expense_categories_revision" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "expense_categories_nameKey_key" ON "expense_categories"("nameKey");
INSERT INTO "expense_categories" ("name", "nameKey", "sortOrder") VALUES
  ('Rent', 'rent', 1), ('Utilities', 'utilities', 2), ('Salaries and wages', 'salaries and wages', 3), ('Equipment and tools', 'equipment and tools', 4),
  ('Marketing', 'marketing', 5), ('Repairs and maintenance', 'repairs and maintenance', 6), ('Other', 'other', 7);

-- 2. Expenses. "seq" gives a stable order and cursor among rows of one day.
CREATE TABLE "expenses" (
  "id" TEXT NOT NULL,
  "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
  "expenseDate" DATE NOT NULL,
  "categoryId" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "payee" TEXT,
  "note" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voidedAt" TIMESTAMPTZ(3),
  "voidedByStaffId" TEXT,
  "createdByStaffId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expenses_date" CHECK ("expenseDate" >= DATE '2020-01-01'),
  CONSTRAINT "expenses_amount" CHECK ("amountCentavos" BETWEEN 1 AND 10000000000),
  CONSTRAINT "expenses_payee" CHECK ("payee" IS NULL OR ("payee" = btrim("payee") AND length("payee") BETWEEN 1 AND 80)),
  CONSTRAINT "expenses_note" CHECK ("note" IS NULL OR ("note" = btrim("note") AND length("note") BETWEEN 1 AND 200)),
  CONSTRAINT "expenses_revision" CHECK ("revision" >= 1),
  CONSTRAINT "expenses_void_pair" CHECK (("voidedAt" IS NULL) = ("voidedByStaffId" IS NULL))
);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voidedByStaffId_fkey" FOREIGN KEY ("voidedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "expenses_seq_key" ON "expenses"("seq");
CREATE INDEX "expenses_expenseDate_seq_idx" ON "expenses"("expenseDate", "seq");
CREATE INDEX "expenses_categoryId_expenseDate_idx" ON "expenses"("categoryId", "expenseDate");

-- 3. History (insert-only). No foreign key to the row, so the trail outlives anything.
CREATE TABLE "expense_events" (
  "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
  "expenseId" TEXT NOT NULL,
  "kind" "ExpenseEventKind" NOT NULL,
  "revision" INTEGER NOT NULL,
  "expenseDate" DATE NOT NULL,
  "categoryName" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "payee" TEXT,
  "note" TEXT,
  "reason" TEXT,
  "actorStaffId" TEXT NOT NULL,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_events_pkey" PRIMARY KEY ("seq"),
  CONSTRAINT "expense_events_reason" CHECK ("reason" IS NULL OR ("kind"::text = 'VOIDED' AND "reason" = btrim("reason") AND length("reason") BETWEEN 1 AND 200))
);
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "expense_events_expenseId_seq_idx" ON "expense_events"("expenseId", "seq");

CREATE TABLE "expense_category_events" (
  "seq" BIGINT GENERATED ALWAYS AS IDENTITY,
  "categoryId" TEXT NOT NULL,
  "kind" "ExpenseCategoryEventKind" NOT NULL,
  "name" TEXT NOT NULL,
  "actorStaffId" TEXT NOT NULL,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_category_events_pkey" PRIMARY KEY ("seq")
);
ALTER TABLE "expense_category_events" ADD CONSTRAINT "expense_category_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "expense_category_events_categoryId_seq_idx" ON "expense_category_events"("categoryId", "seq");

-- 4. Guards: stamped times, append-only history, and an expense or category is never erased (even by the owner).
CREATE FUNCTION guard_expense_event_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Expense history txId must be the inserting transaction'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_event_insert BEFORE INSERT ON expense_events FOR EACH ROW EXECUTE FUNCTION guard_expense_event_insert();
CREATE TRIGGER expense_category_event_insert BEFORE INSERT ON expense_category_events FOR EACH ROW EXECUTE FUNCTION guard_expense_event_insert();
CREATE FUNCTION reject_expense_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Expense history is append-only and expenses and categories are never erased'; END $$;
CREATE TRIGGER expense_event_immutable BEFORE UPDATE OR DELETE ON expense_events FOR EACH ROW EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expense_event_no_truncate BEFORE TRUNCATE ON expense_events FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expense_category_event_immutable BEFORE UPDATE OR DELETE ON expense_category_events FOR EACH ROW EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expense_category_event_no_truncate BEFORE TRUNCATE ON expense_category_events FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expenses_no_truncate BEFORE TRUNCATE ON expenses FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expense_categories_no_delete BEFORE DELETE ON expense_categories FOR EACH ROW EXECUTE FUNCTION reject_expense_change();
CREATE TRIGGER expense_categories_no_truncate BEFORE TRUNCATE ON expense_categories FOR EACH STATEMENT EXECUTE FUNCTION reject_expense_change();

-- 5. Expense writers. A uuid is the only id shape accepted from the browser. Dates: 2020-01-01 up to today in Manila.
CREATE FUNCTION admin_expense_create(p_actor text, p_id text, p_date date, p_category text, p_amount bigint, p_payee text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_payee text := NULLIF(btrim(p_payee), ''); v_note text := NULLIF(btrim(p_note), ''); x public.expenses; c public.expense_categories;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_date IS NULL OR p_category IS NULL OR p_category = ''
    OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 10000000000 OR (v_payee IS NOT NULL AND length(v_payee) > 80) OR (v_note IS NOT NULL AND length(v_note) > 200) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006';
 END IF;
 -- A retry (same id, same content) returns the row that is already there, even if the category was hidden since.
 SELECT * INTO x FROM public.expenses WHERE id = p_id;
 IF FOUND THEN
  IF x."expenseDate" = p_date AND x."categoryId" = p_category AND x."amountCentavos" = p_amount AND x.payee IS NOT DISTINCT FROM v_payee AND x.note IS NOT DISTINCT FROM v_note THEN
   RETURN jsonb_build_object('id', p_id, 'replayed', true);
  END IF;
  RAISE EXCEPTION 'That expense id was already used for something else' USING ERRCODE = 'ZX006';
 END IF;
 IF p_date < DATE '2020-01-01' OR p_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date THEN RAISE EXCEPTION 'Date out of range' USING ERRCODE = 'ZX012'; END IF;
 SELECT * INTO c FROM public.expense_categories WHERE id = p_category;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'ZX001'; END IF;
 IF NOT c."isActive" THEN RAISE EXCEPTION 'Category is hidden' USING ERRCODE = 'ZX010'; END IF;
 INSERT INTO public.expenses (id, "expenseDate", "categoryId", "amountCentavos", payee, note, "createdByStaffId") VALUES (p_id, p_date, p_category, p_amount, v_payee, v_note, p_actor);
 INSERT INTO public.expense_events ("expenseId", kind, revision, "expenseDate", "categoryName", "amountCentavos", payee, note, "actorStaffId")
  VALUES (p_id, 'CREATED', 1, p_date, c.name, p_amount, v_payee, v_note, p_actor);
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- "Set these values". If the row already equals them it returns unchanged BEFORE the revision check: a retry after a lost response still carries the
-- old revision. A hidden category is refused only when the edit moves the expense into it, so an old expense can still be corrected.
CREATE FUNCTION admin_expense_update(p_actor text, p_id text, p_revision integer, p_date date, p_category text, p_amount bigint, p_payee text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_payee text := NULLIF(btrim(p_payee), ''); v_note text := NULLIF(btrim(p_note), ''); x public.expenses; c public.expense_categories;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 OR p_date IS NULL OR p_category IS NULL OR p_category = ''
    OR p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 10000000000 OR (v_payee IS NOT NULL AND length(v_payee) > 80) OR (v_note IS NOT NULL AND length(v_note) > 200) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006';
 END IF;
 SELECT * INTO x FROM public.expenses WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'ZX001'; END IF;
 IF x."voidedAt" IS NOT NULL THEN RAISE EXCEPTION 'Expense is removed' USING ERRCODE = 'ZX011'; END IF;
 IF x."expenseDate" = p_date AND x."categoryId" = p_category AND x."amountCentavos" = p_amount AND x.payee IS NOT DISTINCT FROM v_payee AND x.note IS NOT DISTINCT FROM v_note THEN
  RETURN jsonb_build_object('revision', x.revision, 'changed', false);
 END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Expense changed' USING ERRCODE = 'ZX002'; END IF;
 IF p_date <> x."expenseDate" AND (p_date < DATE '2020-01-01' OR p_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date) THEN RAISE EXCEPTION 'Date out of range' USING ERRCODE = 'ZX012'; END IF;
 SELECT * INTO c FROM public.expense_categories WHERE id = p_category;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'ZX001'; END IF;
 IF NOT c."isActive" AND p_category <> x."categoryId" THEN RAISE EXCEPTION 'Category is hidden' USING ERRCODE = 'ZX010'; END IF;
 UPDATE public.expenses SET "expenseDate" = p_date, "categoryId" = p_category, "amountCentavos" = p_amount, payee = v_payee, note = v_note, revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
 INSERT INTO public.expense_events ("expenseId", kind, revision, "expenseDate", "categoryName", "amountCentavos", payee, note, "actorStaffId")
  VALUES (p_id, 'EDITED', x.revision + 1, p_date, c.name, p_amount, v_payee, v_note, p_actor);
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

-- Remove hides, never erases. Already removed returns changed false BEFORE the revision check (a retry after a lost response).
CREATE FUNCTION admin_expense_void(p_actor text, p_id text, p_revision integer, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_reason text := NULLIF(btrim(p_reason), ''); x public.expenses; v_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 OR (v_reason IS NOT NULL AND length(v_reason) > 200) THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006'; END IF;
 SELECT * INTO x FROM public.expenses WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'ZX001'; END IF;
 IF x."voidedAt" IS NOT NULL THEN RETURN jsonb_build_object('revision', x.revision, 'changed', false); END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Expense changed' USING ERRCODE = 'ZX002'; END IF;
 SELECT name INTO v_name FROM public.expense_categories WHERE id = x."categoryId";
 UPDATE public.expenses SET "voidedAt" = CURRENT_TIMESTAMP, "voidedByStaffId" = p_actor, revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
 INSERT INTO public.expense_events ("expenseId", kind, revision, "expenseDate", "categoryName", "amountCentavos", payee, note, reason, "actorStaffId")
  VALUES (p_id, 'VOIDED', x.revision + 1, x."expenseDate", v_name, x."amountCentavos", x.payee, x.note, v_reason, p_actor);
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

CREATE FUNCTION admin_expense_restore(p_actor text, p_id text, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE x public.expenses; v_name text;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006'; END IF;
 SELECT * INTO x FROM public.expenses WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found' USING ERRCODE = 'ZX001'; END IF;
 IF x."voidedAt" IS NULL THEN RETURN jsonb_build_object('revision', x.revision, 'changed', false); END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Expense changed' USING ERRCODE = 'ZX002'; END IF;
 SELECT name INTO v_name FROM public.expense_categories WHERE id = x."categoryId";
 UPDATE public.expenses SET "voidedAt" = NULL, "voidedByStaffId" = NULL, revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
 INSERT INTO public.expense_events ("expenseId", kind, revision, "expenseDate", "categoryName", "amountCentavos", payee, note, "actorStaffId")
  VALUES (p_id, 'RESTORED', x.revision + 1, x."expenseDate", v_name, x."amountCentavos", x.payee, x.note, p_actor);
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

-- 6. Category writers. At most 40 categories, hidden ones included; at least one stays active.
CREATE FUNCTION admin_category_create(p_actor text, p_id text, p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_name text := btrim(p_name); x public.expense_categories;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 40 THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006';
 END IF;
 SELECT * INTO x FROM public.expense_categories WHERE id = p_id;
 IF FOUND THEN
  IF x.name = v_name THEN RETURN jsonb_build_object('id', p_id, 'replayed', true); END IF;
  RAISE EXCEPTION 'That category id was already used for something else' USING ERRCODE = 'ZX006';
 END IF;
 IF lower(v_name) IN ('stock bought', 'commissions paid') THEN RAISE EXCEPTION 'That name is reserved' USING ERRCODE = 'ZX013'; END IF;
 IF EXISTS(SELECT 1 FROM public.expense_categories WHERE "nameKey" = lower(v_name)) THEN RAISE EXCEPTION 'A category with that name already exists' USING ERRCODE = 'ZX007'; END IF;
 IF (SELECT count(*) FROM public.expense_categories) >= 40 THEN RAISE EXCEPTION 'Too many categories' USING ERRCODE = 'ZX015'; END IF;
 INSERT INTO public.expense_categories (id, name, "nameKey", "sortOrder") VALUES (p_id, v_name, lower(v_name), (SELECT COALESCE(max("sortOrder"), 0) + 1 FROM public.expense_categories));
 INSERT INTO public.expense_category_events ("categoryId", kind, name, "actorStaffId") VALUES (p_id, 'CREATED', v_name, p_actor);
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- Rename and hide or show. A NULL argument leaves that field alone. Already equal returns unchanged BEFORE the revision check.
CREATE FUNCTION admin_category_update(p_actor text, p_id text, p_revision integer, p_name text, p_active boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_name text := btrim(p_name); x public.expense_categories; v_rename boolean; v_toggle boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 2);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 OR (p_name IS NOT NULL AND length(v_name) NOT BETWEEN 1 AND 40) OR (p_name IS NULL AND p_active IS NULL) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZX006';
 END IF;
 SELECT * INTO x FROM public.expense_categories WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE = 'ZX001'; END IF;
 v_rename := p_name IS NOT NULL AND v_name <> x.name;
 v_toggle := p_active IS NOT NULL AND p_active <> x."isActive";
 IF NOT v_rename AND NOT v_toggle THEN RETURN jsonb_build_object('revision', x.revision, 'changed', false); END IF;
 IF x.revision <> p_revision THEN RAISE EXCEPTION 'Category changed' USING ERRCODE = 'ZX002'; END IF;
 IF v_rename THEN
  IF lower(v_name) IN ('stock bought', 'commissions paid') THEN RAISE EXCEPTION 'That name is reserved' USING ERRCODE = 'ZX013'; END IF;
  IF EXISTS(SELECT 1 FROM public.expense_categories WHERE "nameKey" = lower(v_name) AND id <> p_id) THEN RAISE EXCEPTION 'A category with that name already exists' USING ERRCODE = 'ZX007'; END IF;
 END IF;
 IF v_toggle AND NOT p_active AND NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE "isActive" AND id <> p_id) THEN RAISE EXCEPTION 'The last category cannot be hidden' USING ERRCODE = 'ZX014'; END IF;
 UPDATE public.expense_categories SET name = CASE WHEN v_rename THEN v_name ELSE name END, "nameKey" = CASE WHEN v_rename THEN lower(v_name) ELSE "nameKey" END,
   "isActive" = COALESCE(p_active, "isActive"), revision = x.revision + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = p_id;
 IF v_rename THEN INSERT INTO public.expense_category_events ("categoryId", kind, name, "actorStaffId") VALUES (p_id, 'RENAMED', v_name, p_actor); END IF;
 IF v_toggle THEN INSERT INTO public.expense_category_events ("categoryId", kind, name, "actorStaffId") VALUES (p_id, CASE WHEN p_active THEN 'SHOWN' ELSE 'HIDDEN' END::public."ExpenseCategoryEventKind", CASE WHEN v_rename THEN v_name ELSE x.name END, p_actor); END IF;
 RETURN jsonb_build_object('revision', x.revision + 1, 'changed', true);
END $$;

-- 7. Privileges. Closed to PUBLIC here (not only in runtime-role.sql): the migration runs first, with the old code live.
REVOKE ALL ON "expense_categories", "expenses", "expense_events", "expense_category_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_expense_create(text, text, date, text, bigint, text, text), admin_expense_update(text, text, integer, date, text, bigint, text, text),
  admin_expense_void(text, text, integer, text), admin_expense_restore(text, text, integer), admin_category_create(text, text, text), admin_category_update(text, text, integer, text, boolean),
  guard_expense_event_insert(), reject_expense_change() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "expense_categories", "expenses", "expense_events", "expense_category_events" FROM zeus_app;
 GRANT SELECT ON "expense_categories", "expenses", "expense_events", "expense_category_events" TO zeus_app;
 GRANT EXECUTE ON FUNCTION admin_expense_create(text, text, date, text, bigint, text, text), admin_expense_update(text, text, integer, date, text, bigint, text, text),
  admin_expense_void(text, text, integer, text), admin_expense_restore(text, text, integer), admin_category_create(text, text, text), admin_category_update(text, text, integer, text, boolean) TO zeus_app;
END IF; END $$;
COMMIT;
