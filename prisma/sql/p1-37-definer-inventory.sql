-- P1-37 read-only inventory of SECURITY DEFINER functions and pinned function paths. It is ONE SELECT: it changes nothing and
-- needs no privilege beyond reading the catalog. Run it as the migration owner, on live BEFORE migration
-- 20261105000000_team_commissions (it refers to no object that migration creates, so it also runs before it) and again after:
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-37-definer-inventory.sql
-- Every SECURITY DEFINER function in the database is listed with its owner, its stored settings (proconfig) and its ACL, plus
-- every other function whose path is exactly "pg_catalog, public". The last column says what section 8b of the migration
-- will do to it: "no change", "alter definer: keep path, pg_temp last", or "alter function: add pg_temp". Functions owned by
-- another role, outside schema public or owned by an extension are never touched ("not touched by 8b"): look at those by hand.
-- After the migration every row must say "no change" or "not touched by 8b", and no definer in schema public may lack pg_temp last.
WITH f AS (
  SELECT n.nspname AS schema_name, p.oid, p.oid::regprocedure::text AS function_name, pg_get_userbyid(p.proowner) AS owner_name,
    p.prosecdef AS security_definer, p.proconfig AS settings, p.proacl::text AS acl, p.proowner,
    (SELECT regexp_replace(substr(c, 13), '\s', '', 'g') FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%' LIMIT 1) AS path_compact,
    EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') AS from_extension
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
)
SELECT schema_name AS "schema", function_name AS "function", owner_name AS "owner", security_definer AS "securityDefiner",
  COALESCE(array_to_string(settings, ' | '), '(no settings)') AS "settings", COALESCE(acl, '(default)') AS "acl",
  CASE
    WHEN schema_name <> 'public' OR from_extension OR proowner <> (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user) THEN 'not touched by 8b'
    WHEN security_definer AND path_compact ~ '(^|,)pg_temp$' AND path_compact !~ 'pg_temp,' THEN 'no change'
    WHEN security_definer THEN 'alter definer: keep path, pg_temp last'
    WHEN path_compact = 'pg_catalog,public' THEN 'alter function: add pg_temp'
    ELSE 'no change'
  END AS "migration 8b"
FROM f
WHERE security_definer OR path_compact = 'pg_catalog,public'
ORDER BY security_definer DESC, schema_name, function_name;
