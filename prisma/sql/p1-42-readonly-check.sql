-- P1-42 read-only release check. Run AFTER the migration 20261110000000_shop_settings (or the name it merged under) and AFTER
-- prisma/sql/runtime-role.sql, BEFORE the new code is deployed. It is one SELECT: it changes nothing. Run it as the migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-42-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count).
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, app_exec, definer) AS (VALUES
  -- signature, may zeus_app execute, must be SECURITY DEFINER. PUBLIC may execute none of them.
  ('admin_shop_settings_set(text, integer, boolean, text, boolean)', true, true),
  ('guard_shop_settings_audit_insert()', false, false),
  ('reject_shop_settings_audit_change()', false, false)),
trg(tbl, name) AS (VALUES
  ('shop_settings_audit_events', 'shop_settings_audit_insert'), ('shop_settings_audit_events', 'shop_settings_audit_immutable'), ('shop_settings_audit_events', 'shop_settings_audit_no_truncate')),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name LIKE '%_shop_settings' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table ' || t, to_regclass('public.' || t) IS NOT NULL, '' FROM unnest(ARRAY['shop_settings', 'shop_settings_audit_events']) t
  UNION ALL SELECT 'exactly one settings row, id 1', (SELECT count(*) = 1 AND min(id) = 1 FROM public.shop_settings), ''
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  UNION ALL SELECT 'PUBLIC has no privilege on ' || t, NOT has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), ''
    FROM unnest(ARRAY['shop_settings', 'shop_settings_audit_events']) t
  UNION ALL SELECT 'zeus_app reads shop_settings', (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.shop_settings', 'SELECT'), ''
  UNION ALL SELECT 'zeus_app cannot write ' || t,
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'INSERT') AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'UPDATE')
      AND NOT has_table_privilege('zeus_app', 'public.' || t, 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRUNCATE')
      AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'REFERENCES') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRIGGER'), ''
    FROM unnest(ARRAY['shop_settings', 'shop_settings_audit_events']) t
  UNION ALL SELECT 'zeus_app has no privilege at all on shop_settings_audit_events',
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.shop_settings_audit_events', 'SELECT') AND NOT has_any_column_privilege('zeus_app', 'public.shop_settings_audit_events', 'INSERT'), ''
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
      AND NOT EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$')), ''
  -- What customers will meet right after the release. Expected: live and open. Never a failure by itself.
  UNION ALL SELECT 'info: maintenance', true, (SELECT maintenance::text FROM public.shop_settings WHERE id = 1)
  UNION ALL SELECT 'info: booking paused in the database', true, (SELECT "bookingPaused"::text FROM public.shop_settings WHERE id = 1)
  UNION ALL SELECT 'info: audit rows', true, (SELECT count(*)::text FROM public.shop_settings_audit_events)
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
