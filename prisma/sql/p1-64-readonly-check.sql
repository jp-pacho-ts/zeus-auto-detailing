-- P1-64 read-only release check. Run AFTER the migration 20261108000000_staff_profiles and AFTER prisma/sql/runtime-role.sql, BEFORE the new code is
-- deployed. It is one SELECT: it changes nothing. Run it as the migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-64-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count). The "info" rows are numbers for the LE: they are counts
-- only, never a name, phone or address. Never a failure by themselves.
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, app_exec, definer) AS (VALUES
  -- signature, may zeus_app execute, must be SECURITY DEFINER. PUBLIC may execute none of them.
  ('admin_team_list_v2(text)', true, true),
  ('admin_staff_create_v2(text, text, text, text, text, integer)', true, true),
  ('admin_staff_profile_get(text, text)', true, true),
  ('admin_staff_profile_set(text, text, integer, text, text, text, text, date, date, text, text, text)', true, true),
  ('admin_staff_remove_v2(text, text, integer)', true, true),
  ('guard_removed_staff()', false, false)),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261108000000_staff_profiles' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table staff_profiles', to_regclass('public.staff_profiles') IS NOT NULL, ''
  UNION ALL SELECT 'column staff.removedAt is nullable', EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'removedAt' AND NOT attnotnull AND NOT attisdropped), ''
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  UNION ALL SELECT 'PUBLIC has no privilege on staff_profiles', NOT has_table_privilege('public', 'public.staff_profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), ''
  UNION ALL SELECT 'zeus_app has no privilege at all on staff_profiles',
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.staff_profiles', 'SELECT') AND NOT has_any_column_privilege('zeus_app', 'public.staff_profiles', 'INSERT')
      AND NOT has_any_column_privilege('zeus_app', 'public.staff_profiles', 'UPDATE') AND NOT has_any_column_privilege('zeus_app', 'public.staff_profiles', 'REFERENCES')
      AND NOT has_table_privilege('zeus_app', 'public.staff_profiles', 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.staff_profiles', 'TRUNCATE') AND NOT has_table_privilege('zeus_app', 'public.staff_profiles', 'TRIGGER'), ''
  UNION ALL SELECT 'zeus_app cannot read or write staff.removedAt or staff.phone',
    (SELECT present FROM role) AND NOT has_column_privilege('zeus_app', 'public.staff', 'removedAt', 'SELECT') AND NOT has_column_privilege('zeus_app', 'public.staff', 'removedAt', 'UPDATE')
      AND NOT has_column_privilege('zeus_app', 'public.staff', 'phone', 'SELECT') AND NOT has_column_privilege('zeus_app', 'public.staff', 'phone', 'UPDATE'), ''
  UNION ALL SELECT 'trigger staff.staff_removed_is_final is enabled',
    EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid = 'public.staff'::regclass AND g.tgname = 'staff_removed_is_final' AND g.tgenabled IN ('O', 'A') AND NOT g.tgisinternal), ''
  UNION ALL SELECT 'constraint staff_removed_is_inactive is validated',
    EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.staff'::regclass AND c.conname = 'staff_removed_is_inactive' AND c.convalidated), ''
  UNION ALL SELECT 'function ' || sig || ': exists, owner, SECURITY DEFINER, pinned search_path, ACL',
    p.oid IS NOT NULL
      AND (NOT fn.definer OR p.prosecdef)
      AND EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c ~ '^search_path=pg_catalog, ?public, ?pg_temp$')
      AND pg_get_userbyid(p.proowner) = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.bookings'::regclass))
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND (NOT (SELECT present FROM role) OR has_function_privilege('zeus_app', p.oid, 'EXECUTE') = fn.app_exec),
    CASE WHEN p.oid IS NULL THEN 'missing' ELSE '' END
    FROM fn LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || fn.sig)
  UNION ALL SELECT 'every removed row is inactive and holds no personal detail',
    NOT EXISTS(SELECT 1 FROM public.staff s WHERE s."removedAt" IS NOT NULL AND (s."isActive" OR s.phone <> '' OR s.email NOT LIKE 'removed-%@staff.invalid'
      OR EXISTS(SELECT 1 FROM public.staff_profiles p WHERE p."staffId" = s.id)
      OR EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id))), ''
  UNION ALL SELECT 'every profile belongs to a staff name', NOT EXISTS(SELECT 1 FROM public.staff_profiles p JOIN public.staff s ON s.id = p."staffId" WHERE s.role <> 'DETAILER'), ''
  UNION ALL SELECT 'info: staff names on the Team', true, (SELECT count(*)::text FROM public.staff WHERE role = 'DETAILER' AND "removedAt" IS NULL)
  UNION ALL SELECT 'info: of those, inactive from before this change (Remove still works on them)', true, (SELECT count(*)::text FROM public.staff WHERE role = 'DETAILER' AND "removedAt" IS NULL AND NOT "isActive")
  UNION ALL SELECT 'info: of those, with a sign-in', true, (SELECT count(*)::text FROM public.staff s WHERE s.role = 'DETAILER' AND s."removedAt" IS NULL AND EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id))
  UNION ALL SELECT 'info: profiles', true, (SELECT count(*)::text FROM public.staff_profiles)
  UNION ALL SELECT 'info: removed and hidden rows', true, (SELECT count(*)::text FROM public.staff WHERE "removedAt" IS NOT NULL)
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
