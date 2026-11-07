-- P1-62 A1 read-only release check. Run AFTER the migration 20261107000000_bay_containers and AFTER prisma/sql/runtime-role.sql, BEFORE the
-- new code is deployed. It is one SELECT: it changes nothing and needs no special privilege beyond reading the catalog. Run it as the
-- migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-62-readonly-check.sql
-- Every row must show ok = true. The last row is the verdict (ALL_OK or FAILED with the count). The "info" rows are numbers to compare with
-- what you noted before the migration (they must not have changed): the migration is expand-only, so bookings, occupancies, assignments and
-- the bays themselves keep their row counts.
WITH role AS (SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') AS present),
fn(sig, app_exec, definer) AS (VALUES
  -- signature, may zeus_app execute, must be SECURITY DEFINER. PUBLIC may execute none of them.
  ('admin_container_create(text, text, text, text[])', true, true),
  ('admin_container_update(text, text, timestamptz, text, text[], boolean)', true, true),
  ('admin_container_remove(text, text, timestamptz)', true, true),
  ('admin_bay_move(text, text, text, timestamptz)', true, true),
  ('check_bay_containers()', false, true),
  ('default_bay_container()', false, false),
  ('guard_container_audit_insert()', false, false),
  ('reject_bay_container_change()', false, false)),
trg(tbl, name) AS (VALUES
  ('bays', 'bays_default_container'), ('bays', 'bays_standing_rules'),
  ('bay_containers', 'bay_containers_lock'), ('bay_containers', 'bay_containers_no_delete'), ('bay_containers', 'bay_containers_standing_rules'),
  ('bay_container_audit_events', 'bay_container_audit_insert'), ('bay_container_audit_events', 'bay_container_audit_immutable'), ('bay_container_audit_events', 'bay_container_audit_no_truncate')),
checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261107000000_bay_containers' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'table ' || t, to_regclass('public.' || t) IS NOT NULL, '' FROM unnest(ARRAY['bay_containers', 'bay_container_audit_events']) t
  UNION ALL SELECT 'column bays.containerId exists and is nullable (expand only)', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bays' AND column_name = 'containerId' AND is_nullable = 'YES'), ''
  UNION ALL SELECT 'legacy object kept: ' || o, ok, 'expand-only: the live code still reads it'
    FROM (VALUES ('bay_type_queues', to_regclass('public.bay_type_queues') IS NOT NULL),
      ('bays.bayType', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bays' AND column_name = 'bayType')),
      ('bay_occupancies', to_regclass('public.bay_occupancies') IS NOT NULL), ('booking_bay_assignments', to_regclass('public.booking_bay_assignments') IS NOT NULL)) AS l(o, ok)
  UNION ALL SELECT 'every bay has a container (' || (SELECT count(*) FROM public.bays) || ' bays)', NOT EXISTS(SELECT 1 FROM public.bays WHERE "containerId" IS NULL),
    COALESCE((SELECT string_agg(id, ', ') FROM public.bays WHERE "containerId" IS NULL), '')
  UNION ALL SELECT 'at least one active container', EXISTS(SELECT 1 FROM public.bay_containers WHERE "isActive"), ''
  UNION ALL SELECT 'no active bay sits in a removed container', NOT EXISTS(SELECT 1 FROM public.bays b JOIN public.bay_containers c ON c.id = b."containerId" WHERE b."isActive" AND NOT c."isActive"), ''
  UNION ALL SELECT 'every container label lists only real queues', NOT EXISTS(SELECT 1 FROM public.bay_containers c, unnest(c."usualQueues") q WHERE NOT EXISTS(SELECT 1 FROM public.booking_queues bq WHERE bq.code = q)), ''
  UNION ALL SELECT 'the relaxed placement function no longer refuses by bay type',
    COALESCE((SELECT prosrc NOT LIKE '%does not take this queue%' AND prosrc LIKE '%Invalid open bay occupancy%' FROM pg_proc WHERE oid = 'public.validate_bay_board'::regproc), false), ''
  UNION ALL SELECT 'runtime role zeus_app exists', (SELECT present FROM role), ''
  -- No table is open to PUBLIC, and the runtime role reads containers, writes nothing, and cannot touch the audit table at all.
  UNION ALL SELECT 'PUBLIC has no privilege on ' || t, NOT has_table_privilege('public', 'public.' || t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'), ''
    FROM unnest(ARRAY['bay_containers', 'bay_container_audit_events']) t
  UNION ALL SELECT 'zeus_app reads bay_containers', (SELECT present FROM role) AND has_table_privilege('zeus_app', 'public.bay_containers', 'SELECT'), ''
  UNION ALL SELECT 'zeus_app cannot write ' || t,
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'INSERT') AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'UPDATE')
      AND NOT has_table_privilege('zeus_app', 'public.' || t, 'DELETE') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRUNCATE')
      AND NOT has_any_column_privilege('zeus_app', 'public.' || t, 'REFERENCES') AND NOT has_table_privilege('zeus_app', 'public.' || t, 'TRIGGER'), ''
    FROM unnest(ARRAY['bay_containers', 'bay_container_audit_events']) t
  UNION ALL SELECT 'zeus_app has no privilege at all on bay_container_audit_events',
    (SELECT present FROM role) AND NOT has_any_column_privilege('zeus_app', 'public.bay_container_audit_events', 'SELECT') AND NOT has_any_column_privilege('zeus_app', 'public.bay_container_audit_events', 'INSERT'), ''
  UNION ALL SELECT 'zeus_app cannot change bays.containerId (a bay moves only through admin_bay_move)',
    (SELECT present FROM role) AND NOT has_column_privilege('zeus_app', 'public.bays', 'containerId', 'UPDATE'), ''
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
  UNION ALL SELECT 'info: bay containers', true, (SELECT count(*)::text FROM public.bay_containers)
  UNION ALL SELECT 'info: bays', true, (SELECT count(*)::text FROM public.bays)
  UNION ALL SELECT 'info: bay occupancies', true, (SELECT count(*)::text FROM public.bay_occupancies)
  UNION ALL SELECT 'info: bay assignments (history)', true, (SELECT count(*)::text FROM public.booking_bay_assignments)
  UNION ALL SELECT 'info: bookings', true, (SELECT count(*)::text FROM public.bookings)
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
