-- P1-37 read-only release check. Run AFTER the migration 20261105000000_team_commissions and AFTER
-- prisma/sql/runtime-role.sql, BEFORE the new code is deployed. It is one SELECT: it changes nothing and needs no
-- special privilege beyond reading the catalog. Run it as the migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-37-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count). The "info" rows are
-- numbers to compare with what you noted before the migration (they must not have changed): the migration is
-- expand-only, so staff, bookings, commission_payouts and booking_assignments keep their row counts.
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, public_ok, app_exec, definer) AS (VALUES
  -- signature, may PUBLIC execute (never), may zeus_app execute, must be SECURITY DEFINER
  ('admin_team_list(text)', false, true, true),
  ('admin_staff_create(text, text, text, text, integer)', false, true, true),
  ('admin_staff_update(text, text, text, text, text, text, integer, integer)', false, true, true),
  ('admin_staff_set_active(text, text, boolean, integer)', false, true, true),
  ('admin_staff_remove(text, text, integer)', false, true, true),
  ('admin_commission_default_set(text, integer, integer)', false, true, true),
  ('admin_commission_paid_set(text, text[], boolean)', false, true, true),
  ('admin_commission_repair(text)', false, true, true),
  ('delete_booking(text, text, integer, text)', false, true, true),
  ('commission_accrue(text)', false, false, true),
  ('commission_consistency_check(text)', false, false, true),
  ('commission_accrue_on_complete()', false, false, true),
  ('check_commission_consistency()', false, false, true),
  ('admin_assert_actor(text)', false, false, true),
  ('commission_split(bigint, integer[])', false, false, false)),
trg(tbl, name) AS (VALUES
  ('bookings', 'commission_accrue_on_complete'),
  ('admin_audit_events', 'admin_audit_insert'), ('admin_audit_events', 'admin_audit_immutable'), ('admin_audit_events', 'admin_audit_no_truncate'),
  ('commission_settings', 'commission_settings_keep'), ('commission_settings', 'commission_settings_no_truncate'),
  ('commission_accruals', 'commission_accrual_change'), ('commission_accruals', 'commission_accrual_no_truncate'), ('commission_accruals', 'commission_accruals_consistent'),
  ('commission_entries', 'commission_entry_change'), ('commission_entries', 'commission_entry_no_truncate'), ('commission_entries', 'commission_entries_consistent')),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261105000000_team_commissions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table ' || t, to_regclass('public.' || t) IS NOT NULL, ''
    FROM unnest(ARRAY['commission_settings', 'commission_accruals', 'commission_entries', 'admin_audit_events']) t
  UNION ALL SELECT 'staff column ' || c, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = c), ''
    FROM unnest(ARRAY['commissionRateBp', 'revision', 'updatedAt']) c
  UNION ALL SELECT 'legacy object kept: ' || o, ok, 'expand-only: the live code still reads it'
    FROM (VALUES ('commission_payouts', to_regclass('public.commission_payouts') IS NOT NULL),
      ('booking_assignments', to_regclass('public.booking_assignments') IS NOT NULL),
      ('staff.defaultCommissionRate', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'defaultCommissionRate'))) AS l(o, ok)
  UNION ALL SELECT 'commission_settings has exactly one valid row',
    (SELECT count(*) = 1 AND bool_and(id = 1 AND "defaultRateBp" BETWEEN 0 AND 10000) FROM public.commission_settings), ''
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  -- Runtime-role privileges (only meaningful when the role exists).
  UNION ALL SELECT 'zeus_app reads ' || t, (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.' || t, 'SELECT'), ''
    FROM unnest(ARRAY['commission_settings', 'commission_accruals', 'commission_entries']) t
  UNION ALL SELECT 'zeus_app cannot write ' || t,
    (SELECT present FROM role) AND NOT has_table_privilege('zeus_app', 'public.' || t, 'INSERT') AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'UPDATE')
      AND NOT has_table_privilege('zeus_app', 'public.' || t, 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRUNCATE'), ''
    FROM unnest(ARRAY['commission_settings', 'commission_accruals', 'commission_entries', 'admin_audit_events']) t
  UNION ALL SELECT 'zeus_app cannot read admin_audit_events',
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.admin_audit_events', 'SELECT'), ''
  UNION ALL SELECT 'zeus_app cannot write staff or read phones',
    (SELECT present FROM role) AND NOT has_table_privilege('zeus_app', 'public.staff', 'INSERT') AND NOT has_table_privilege('zeus_app', 'public.staff', 'DELETE')
      AND NOT has_any_column_privilege('zeus_app', 'public.staff', 'UPDATE') AND NOT has_column_privilege('zeus_app', 'public.staff', 'phone', 'SELECT'), ''
  UNION ALL SELECT 'trigger ' || tbl || '.' || name || ' is enabled',
    EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid = ('public.' || tbl)::regclass AND g.tgname = name AND g.tgenabled IN ('O', 'A') AND NOT g.tgisinternal), ''
    FROM trg
  UNION ALL SELECT 'function ' || sig || ': exists, owner, SECURITY DEFINER, pinned search_path, ACL',
    p.oid IS NOT NULL
      AND (NOT fn.definer OR (p.prosecdef AND EXISTS(SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%pg_catalog%public%')))
      AND pg_get_userbyid(p.proowner) = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.bookings'::regclass))
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
      AND (NOT (SELECT present FROM role) OR has_function_privilege('zeus_app', p.oid, 'EXECUTE') = fn.app_exec),
    CASE WHEN p.oid IS NULL THEN 'missing' ELSE '' END
    FROM fn LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || fn.sig)
  UNION ALL SELECT 'delete_booking() carries the commission check and the delete token logic',
    COALESCE((SELECT prosrc LIKE '%commission_entries%' AND prosrc LIKE '%booking_delete_tokens%' AND prosrc LIKE '%ZD005%' AND prosrc LIKE '%commission_accruals%'
      FROM pg_proc WHERE oid = to_regprocedure('public.delete_booking(text, text, integer, text)')), false), ''
  -- Numbers to compare with what you noted before the migration. Never a failure by themselves.
  UNION ALL SELECT 'info: staff rows', true, (SELECT count(*)::text FROM public.staff)
  UNION ALL SELECT 'info: bookings rows', true, (SELECT count(*)::text FROM public.bookings)
  UNION ALL SELECT 'info: legacy commission_payouts rows (expect 0)', true, (SELECT count(*)::text FROM public.commission_payouts)
  UNION ALL SELECT 'info: legacy booking_assignments rows', true, (SELECT count(*)::text FROM public.booking_assignments)
  UNION ALL SELECT 'info: commission default rate (basis points)', true, (SELECT "defaultRateBp"::text FROM public.commission_settings WHERE id = 1)
  UNION ALL SELECT 'info: completed bookings since commissions began with no record', true,
    (SELECT count(*)::text FROM public.bookings b WHERE b.status = 'COMPLETED' AND b."snapshotVersion" = 'QUEUE_V3'
      AND b."terminalAt" >= (SELECT "startsAt" FROM public.commission_settings WHERE id = 1) AND NOT EXISTS(SELECT 1 FROM public.commission_accruals a WHERE a."bookingId" = b.id))
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
