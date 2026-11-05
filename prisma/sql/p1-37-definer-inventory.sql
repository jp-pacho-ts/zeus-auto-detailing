-- P1-37 read-only inventory of SECURITY DEFINER functions and pinned function paths. It is ONE SELECT: it changes nothing and
-- needs no privilege beyond reading the catalog. Run it as the migration owner, on live BEFORE migration
-- 20261105000000_team_commissions (it refers to no object that migration creates, so it also runs before it) and again after:
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-37-definer-inventory.sql
-- Every SECURITY DEFINER function in the database is listed with its owner, its stored settings (proconfig) and its ACL, plus
-- every other function whose path is exactly "pg_catalog, public". The "migration 8b" column says what section 8b of the migration
-- will do to it: "no change", "alter definer: keep path, pg_temp last", or "alter function: add pg_temp". Functions owned by
-- another role, outside schema public or owned by an extension are never touched ("not touched by 8b"): look at those by hand.
-- After the migration every row must say "no change" or "not touched by 8b", and no definer in schema public may lack pg_temp last.
-- The path is read exactly as the migration reads it (Codex F5): as a list of identifiers, honouring double quotes, so a comma inside
-- a quoted schema name is not a separator. "path after 8b" is the path the migration will set. "identifiers kept" is the check that
-- the list of schema names (unquoted, ignoring pg_temp) is the same before and after; it must be true on every row.
-- "quoted comma" marks a path with a comma inside a quoted name, the case a naive comma split would have broken.
WITH f AS (
  SELECT n.nspname AS schema_name, p.oid, p.oid::regprocedure::text AS function_name, pg_get_userbyid(p.proowner) AS owner_name,
    p.prosecdef AS security_definer, p.proconfig AS settings, p.proacl::text AS acl, p.proowner,
    (SELECT substr(c, 13) FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%' LIMIT 1) AS cfg,
    EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') AS from_extension
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
),
g AS (
  SELECT f.*, ARRAY(SELECT btrim(t.m[1]) FROM regexp_matches(COALESCE(f.cfg, ''), '((?:"(?:[^"]|"")*"|[^,"])+)', 'g') WITH ORDINALITY AS t(m, n)
                    WHERE btrim(t.m[1]) <> '' ORDER BY t.n) AS tokens
  FROM f
),
h AS (
  SELECT g.*, CASE WHEN g.cfg IS NULL THEN ARRAY['pg_catalog', 'public', 'pg_temp']
                   ELSE array_append(ARRAY(SELECT x FROM unnest(g.tokens) WITH ORDINALITY u(x, i) WHERE lower(x) <> 'pg_temp' AND x <> '""' ORDER BY i), 'pg_temp') END AS predicted
  FROM g
),
k AS (
  SELECT h.*,
    -- What migration 8b does to this row: nothing when the tokens already equal the predicted path.
    CASE
      WHEN h.schema_name <> 'public' OR h.from_extension OR h.proowner <> (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user) THEN 'not touched by 8b'
      WHEN h.security_definer AND h.tokens = h.predicted THEN 'no change'
      WHEN h.security_definer THEN 'alter definer: keep path, pg_temp last'
      WHEN h.tokens = ARRAY['pg_catalog', 'public'] THEN 'alter function: add pg_temp'
      ELSE 'no change'
    END AS action
  FROM h
)
SELECT k.schema_name AS "schema", k.function_name AS "function", k.owner_name AS "owner", k.security_definer AS "securityDefiner",
  COALESCE(array_to_string(k.settings, ' | '), '(no settings)') AS "settings", COALESCE(k.acl, '(default)') AS "acl",
  k.action AS "migration 8b",
  CASE WHEN k.action LIKE 'alter%' THEN array_to_string(k.predicted, ', ') ELSE '' END AS "path after 8b",
  -- The unquoted schema names (a doubled quote is one quote; a bare name folds to lower case), pg_temp ignored, before and after.
  (SELECT COALESCE(array_agg(CASE WHEN left(x, 1) = '"' THEN replace(substr(x, 2, length(x) - 2), '""', '"') ELSE lower(x) END ORDER BY i), ARRAY[]::text[])
     FROM unnest(k.tokens) WITH ORDINALITY u(x, i) WHERE NOT (left(x, 1) <> '"' AND lower(x) = 'pg_temp') AND x <> '""')
  = (SELECT COALESCE(array_agg(CASE WHEN left(x, 1) = '"' THEN replace(substr(x, 2, length(x) - 2), '""', '"') ELSE lower(x) END ORDER BY i), ARRAY[]::text[])
     FROM unnest(k.predicted) WITH ORDINALITY u(x, i) WHERE NOT (left(x, 1) <> '"' AND lower(x) = 'pg_temp') AND x <> '""'
       AND (k.cfg IS NOT NULL)) AS "identifiers kept",
  EXISTS(SELECT 1 FROM unnest(k.tokens) x WHERE left(x, 1) = '"' AND position(',' IN x) > 0) AS "quoted comma"
FROM k
WHERE k.security_definer OR k.tokens = ARRAY['pg_catalog', 'public']
ORDER BY k.security_definer DESC, k.schema_name, k.function_name;
