-- P1-20 (LE yes required; a separate live step, never a migration side effect): lets the zeus_app
-- runtime role save opening hours and closed days from the admin dashboard. Owner-run, one
-- transaction, idempotent. Adds exactly the lines that prisma/sql/runtime-role.sql now lists for
-- these three tables, so a later provisioning run leaves the same privileges:
--   time_slots        INSERT; UPDATE ("startTime", "endTime", "isActive")   (never DELETE)
--   blocked_dates     INSERT, DELETE                                          (never UPDATE)
--   schedule_configs  INSERT                                                  (never UPDATE or DELETE)
-- SELECT on all three already exists. Run as the migration owner:
--   psql "<owner URL>" -v ON_ERROR_STOP=1 -f prisma/sql/p1-20-schedule-grants.sql
--   (or: npx prisma db execute --file prisma/sql/p1-20-schedule-grants.sql --url "<owner URL>")

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    RAISE EXCEPTION 'zeus_app does not exist: provision it with prisma/sql/runtime-role.sql first';
  END IF;
  IF NOT has_table_privilege('zeus_app', 'public.time_slots', 'SELECT') THEN
    RAISE EXCEPTION 'zeus_app cannot read time_slots: this database is not the provisioned runtime database';
  END IF;
END $$;

GRANT INSERT ON public.time_slots TO zeus_app;
GRANT UPDATE ("startTime", "endTime", "isActive") ON public.time_slots TO zeus_app;
GRANT INSERT, DELETE ON public.blocked_dates TO zeus_app;
GRANT INSERT ON public.schedule_configs TO zeus_app;

-- Nothing wider than the list above.
DO $$
BEGIN
  IF has_table_privilege('zeus_app', 'public.time_slots', 'DELETE')
     OR has_table_privilege('zeus_app', 'public.time_slots', 'UPDATE')
     OR has_any_column_privilege('zeus_app', 'public.blocked_dates', 'UPDATE')
     OR has_any_column_privilege('zeus_app', 'public.schedule_configs', 'UPDATE')
     OR has_table_privilege('zeus_app', 'public.schedule_configs', 'DELETE')
     OR has_column_privilege('zeus_app', 'public.time_slots', 'dayOfWeek', 'UPDATE')
     OR has_column_privilege('zeus_app', 'public.time_slots', 'maxVehicleCapacity', 'UPDATE') THEN
    RAISE EXCEPTION 'zeus_app holds wider schedule privileges than this step allows; review before continuing';
  END IF;
END $$;

COMMIT;
