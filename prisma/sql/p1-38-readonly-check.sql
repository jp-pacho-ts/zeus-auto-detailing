-- P1-38 read-only release check. Run AFTER the migration 20261106000000_supplies_inventory and AFTER prisma/sql/runtime-role.sql, BEFORE
-- the new code is deployed. It is one SELECT: it changes nothing and needs no special privilege beyond reading the catalog. Run it as the
-- migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-38-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count). The "info" rows are numbers to compare with
-- what you noted before the migration: the migration is expand-only, so the legacy inventory tables keep their row counts.
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, app_exec, definer) AS (VALUES
  -- signature, may zeus_app execute, must be SECURITY DEFINER. PUBLIC may execute none of them.
  ('admin_supply_create(text, text, text, text, text, integer, integer, bigint)', true, true),
  ('admin_supply_update(text, text, integer, text, text, boolean, text, integer, integer)', true, true),
  ('admin_supply_stock(text, text, text, integer, text, bigint, integer, text)', true, true),
  ('admin_supply_remove(text, text, integer)', true, true),
  ('admin_supply_restore(text, text, integer)', true, true),
  ('supply_stock_matches_history(text)', false, true),
  ('check_supply_consistency()', false, true),
  ('guard_supply_movement_insert()', false, false),
  ('guard_supply_audit_insert()', false, false),
  ('reject_supply_change()', false, false)),
trg(tbl, name) AS (VALUES
  ('supply_movements', 'supply_movement_insert'), ('supply_movements', 'supply_movement_immutable'), ('supply_movements', 'supply_movement_no_truncate'),
  ('supply_movements', 'supply_movements_consistent'), ('supply_items', 'supply_items_consistent'),
  ('supply_audit_events', 'supply_audit_insert'), ('supply_audit_events', 'supply_audit_immutable'), ('supply_audit_events', 'supply_audit_no_truncate')),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261106000000_supplies_inventory' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table ' || t, to_regclass('public.' || t) IS NOT NULL, '' FROM unnest(ARRAY['supply_items', 'supply_movements', 'supply_audit_events']) t
  UNION ALL SELECT 'enum SupplyMovementKind is exactly OPENING, RECEIVE, USE (no ADJUST)',
    (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) = ARRAY['OPENING', 'RECEIVE', 'USE'] FROM pg_enum e WHERE e.enumtypid = '"SupplyMovementKind"'::regtype), ''
  UNION ALL SELECT 'legacy object kept: ' || o, ok, 'expand-only: nothing legacy is dropped'
    FROM (VALUES ('inventory_items', to_regclass('public.inventory_items') IS NOT NULL), ('service_recipes', to_regclass('public.service_recipes') IS NOT NULL),
      ('inventory_transactions', to_regclass('public.inventory_transactions') IS NOT NULL)) AS l(o, ok)
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  -- No table is open to PUBLIC, and the runtime role reads items and movements, writes nothing, and cannot touch the audit table at all.
  UNION ALL SELECT 'PUBLIC has no privilege on ' || t, NOT has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), ''
    FROM unnest(ARRAY['supply_items', 'supply_movements', 'supply_audit_events']) t
  UNION ALL SELECT 'zeus_app reads ' || t, (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.' || t, 'SELECT'), '' FROM unnest(ARRAY['supply_items', 'supply_movements']) t
  UNION ALL SELECT 'zeus_app cannot write ' || t,
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'INSERT') AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'UPDATE')
      AND NOT has_table_privilege('zeus_app', 'public.' || t, 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRUNCATE')
      AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'REFERENCES') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRIGGER'), ''
    FROM unnest(ARRAY['supply_items', 'supply_movements', 'supply_audit_events']) t
  UNION ALL SELECT 'zeus_app has no privilege at all on supply_audit_events',
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.supply_audit_events', 'SELECT') AND NOT has_any_column_privilege('zeus_app', 'public.supply_audit_events', 'INSERT'), ''
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
  UNION ALL SELECT 'the stock of every item equals the sum of its history (' || (SELECT count(*) FROM public.supply_items) || ' items)',
    NOT EXISTS(SELECT 1 FROM public.supply_items i WHERE NOT public.supply_stock_matches_history(i.id)), ''
  -- Numbers to compare with what you noted before the migration. Never a failure by themselves.
  UNION ALL SELECT 'info: supply items', true, (SELECT count(*)::text FROM public.supply_items)
  UNION ALL SELECT 'info: supply movements', true, (SELECT count(*)::text FROM public.supply_movements)
  UNION ALL SELECT 'info: legacy inventory_items rows (expect 0)', true, (SELECT count(*)::text FROM public.inventory_items)
  UNION ALL SELECT 'info: legacy inventory_transactions rows (expect 0)', true, (SELECT count(*)::text FROM public.inventory_transactions)
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
