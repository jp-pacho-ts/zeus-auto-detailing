-- P1-39 read-only release check. Run AFTER the migration 20261109000000_expenses and AFTER prisma/sql/runtime-role.sql, BEFORE the new code is deployed.
-- It is one SELECT: it changes nothing and needs no special privilege beyond reading the catalog. Run it as the migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-39-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count). The "info" rows are numbers to compare with what you noted
-- before the migration: the migration is expand-only, so supplies and commissions keep their row counts.
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, app_exec, definer) AS (VALUES
  -- signature, may zeus_app execute, must be SECURITY DEFINER. PUBLIC may execute none of them.
  ('admin_expense_create(text, text, date, text, bigint, text, text)', true, true),
  ('admin_expense_update(text, text, integer, date, text, bigint, text, text)', true, true),
  ('admin_expense_void(text, text, integer, text)', true, true),
  ('admin_expense_restore(text, text, integer)', true, true),
  ('admin_category_create(text, text, text)', true, true),
  ('admin_category_update(text, text, integer, text, boolean)', true, true),
  ('guard_expense_event_insert()', false, false),
  ('reject_expense_change()', false, false)),
trg(tbl, name) AS (VALUES
  ('expense_events', 'expense_event_insert'), ('expense_events', 'expense_event_immutable'), ('expense_events', 'expense_event_no_truncate'),
  ('expense_category_events', 'expense_category_event_insert'), ('expense_category_events', 'expense_category_event_immutable'), ('expense_category_events', 'expense_category_event_no_truncate'),
  ('expenses', 'expenses_no_delete'), ('expenses', 'expenses_no_truncate'), ('expense_categories', 'expense_categories_no_delete'), ('expense_categories', 'expense_categories_no_truncate')),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261109000000_expenses' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table ' || t, to_regclass('public.' || t) IS NOT NULL, '' FROM unnest(ARRAY['expense_categories', 'expenses', 'expense_events', 'expense_category_events']) t
  UNION ALL SELECT 'seeded category ' || c, EXISTS(SELECT 1 FROM public.expense_categories WHERE name = c), '' FROM unnest(ARRAY['Rent', 'Utilities', 'Salaries and wages', 'Equipment and tools', 'Marketing', 'Repairs and maintenance', 'Other']) c
  UNION ALL SELECT 'at least one active category', EXISTS(SELECT 1 FROM public.expense_categories WHERE "isActive"), ''
  UNION ALL SELECT 'no category uses a reserved name', NOT EXISTS(SELECT 1 FROM public.expense_categories WHERE "nameKey" IN ('stock bought', 'commissions paid')), ''
  UNION ALL SELECT 'every expense has a history row', NOT EXISTS(SELECT 1 FROM public.expenses e WHERE NOT EXISTS(SELECT 1 FROM public.expense_events h WHERE h."expenseId" = e.id)), ''
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  -- No table is open to PUBLIC, and the runtime role reads the four tables and writes none of them.
  UNION ALL SELECT 'PUBLIC has no privilege on ' || t, NOT has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), ''
    FROM unnest(ARRAY['expense_categories', 'expenses', 'expense_events', 'expense_category_events']) t
  UNION ALL SELECT 'zeus_app reads ' || t, (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.' || t, 'SELECT'), ''
    FROM unnest(ARRAY['expense_categories', 'expenses', 'expense_events', 'expense_category_events']) t
  UNION ALL SELECT 'zeus_app cannot write ' || t,
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'INSERT') AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'UPDATE')
      AND NOT has_table_privilege('zeus_app', 'public.' || t, 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRUNCATE')
      AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'REFERENCES') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRIGGER'), ''
    FROM unnest(ARRAY['expense_categories', 'expenses', 'expense_events', 'expense_category_events']) t
  -- The derived lines read these. No new privilege was granted on them; the old ones must still be there.
  UNION ALL SELECT 'zeus_app still reads ' || t || ' (the derived lines)', (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.' || t, 'SELECT'), ''
    FROM unnest(ARRAY['supply_movements', 'commission_entries', 'commission_adjustments']) t
  UNION ALL SELECT 'trigger ' || tbl || '.' || name || ' is enabled',
    EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid = ('public.' || tbl)::regclass AND g.tgname = name AND g.tgenabled IN ('O', 'A') AND NOT g.tgisinternal), '' FROM trg
  UNION ALL SELECT 'function ' || sig || ': exists, owner, SECURITY DEFINER, pinned search_path, ACL',
    p.oid IS NOT NULL
      AND (NOT fn.definer OR (p.prosecdef AND EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$')))
      AND pg_get_userbyid(p.proowner) = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.bookings'::regclass))
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND (NOT (SELECT present FROM role) OR has_function_privilege('zeus_app', p.oid, 'EXECUTE') = fn.app_exec),
    CASE WHEN p.oid IS NULL THEN 'missing' ELSE '' END
    FROM fn LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || fn.sig)
  UNION ALL SELECT 'every SECURITY DEFINER function in public pins search_path with pg_temp last',
    NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND NOT EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$')),
    COALESCE((SELECT string_agg(p.oid::regprocedure::text, ', ') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND NOT EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$')), '')
  -- Numbers to compare with what you noted before the migration. Never a failure by themselves.
  UNION ALL SELECT 'info: expense categories', true, (SELECT count(*)::text FROM public.expense_categories)
  UNION ALL SELECT 'info: expenses', true, (SELECT count(*)::text FROM public.expenses)
  UNION ALL SELECT 'info: supply movements', true, (SELECT count(*)::text FROM public.supply_movements)
  UNION ALL SELECT 'info: commission entries', true, (SELECT count(*)::text FROM public.commission_entries)
  UNION ALL SELECT 'info: commission adjustments', true, (SELECT count(*)::text FROM public.commission_adjustments)
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
