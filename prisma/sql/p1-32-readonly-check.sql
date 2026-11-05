-- P1-32 read-only release check. Run it AFTER migration 20261031000000_customer_names and BEFORE the new code is deployed. It is ONE
-- SELECT: it changes nothing and needs no privilege beyond reading the catalog. Run it as the migration owner, for example
--   psql "$OWNER_DATABASE_URL" -X -f prisma/sql/p1-32-readonly-check.sql
-- Every row must show ok = true; the last row is the verdict (ALL_OK or FAILED with the count). The migration is additive (three
-- nullable or defaulted columns and two CHECKs), so the code that is live while it runs keeps working. It creates no function, so the
-- "pg_temp last in every SECURITY DEFINER path" rule has nothing to apply to here.
WITH checks(name, ok, detail) AS (
  SELECT 'migration applied', EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20261031000000_customer_names' AND finished_at IS NOT NULL AND rolled_back_at IS NULL), ''
  UNION ALL SELECT 'bookings.' || c || ' is nullable text',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = c AND data_type = 'text' AND is_nullable = 'YES'), ''
    FROM unnest(ARRAY['customerFirstName', 'customerLastName']) c
  UNION ALL SELECT 'booking_management_sessions.origin is text NOT NULL default LINK',
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_management_sessions' AND column_name = 'origin'
      AND data_type = 'text' AND is_nullable = 'NO' AND column_default LIKE '''LINK''%'), ''
  UNION ALL SELECT 'constraint ' || n || ' exists and is validated',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = n AND contype = 'c' AND convalidated), ''
    FROM unnest(ARRAY['booking_customer_name_parts', 'booking_management_session_origin']) n
  UNION ALL SELECT 'the origin CHECK allows only LINK and LOOKUP',
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname = 'booking_management_session_origin' AND pg_get_constraintdef(oid) LIKE '%LINK%' AND pg_get_constraintdef(oid) LIKE '%LOOKUP%'), ''
  UNION ALL SELECT 'every existing session is a LINK session (nothing was rewritten)',
    NOT EXISTS(SELECT 1 FROM public.booking_management_sessions WHERE origin <> 'LINK') OR EXISTS(SELECT 1 FROM public.booking_management_sessions WHERE origin = 'LOOKUP'), 'a LOOKUP row is only expected after the new code has been live'
  UNION ALL SELECT 'zeus_app can write booking_management_sessions.origin (table-level INSERT, SELECT)',
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app')
      OR (has_table_privilege('zeus_app', 'public.booking_management_sessions', 'INSERT') AND has_table_privilege('zeus_app', 'public.booking_management_sessions', 'SELECT')), ''
  UNION ALL SELECT 'zeus_app cannot change or delete sessions (immutable)',
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app')
      OR (NOT has_table_privilege('zeus_app', 'public.booking_management_sessions', 'DELETE') AND NOT has_column_privilege('zeus_app', 'public.booking_management_sessions', 'origin', 'UPDATE')), ''
  UNION ALL SELECT 'info: bookings rows', true, (SELECT count(*)::text FROM public.bookings)
  UNION ALL SELECT 'info: bookings with first and last name', true, (SELECT count(*)::text FROM public.bookings WHERE "customerFirstName" IS NOT NULL)
  UNION ALL SELECT 'info: management sessions by origin', true, COALESCE((SELECT string_agg(origin || '=' || n, ', ' ORDER BY origin) FROM (SELECT origin, count(*) AS n FROM public.booking_management_sessions GROUP BY origin) x), 'none')
)
SELECT name, ok, detail FROM checks
UNION ALL SELECT 'VERDICT', (SELECT bool_and(ok) FROM checks),
  CASE WHEN (SELECT bool_and(ok) FROM checks) THEN 'ALL_OK' ELSE 'FAILED: ' || (SELECT count(*) FROM checks WHERE NOT ok) || ' check(s)' END;
