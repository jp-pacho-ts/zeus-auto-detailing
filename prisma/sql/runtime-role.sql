-- P1-10 M1 (ADR-003 S-06; ARCHITECTURE "Audit immutability and database principals").
-- The least-privilege runtime role zeus_app. Owner-run and idempotent; no password in this file.
--
-- Run as the migration owner after every `prisma migrate deploy`, never from the app:
--   npx prisma db execute --file prisma/sql/runtime-role.sql --url "<owner URL>"
--   (or: psql "<owner URL>" -v ON_ERROR_STOP=1 -f prisma/sql/runtime-role.sql)
-- Then set the password interactively (psql: \password zeus_app). The application's
-- DATABASE_URL uses zeus_app; the owner URL never sits in the app's environment.
--
-- It may also run once on the empty database before the first migrate deploy (Codex F2): it then
-- creates the role and grants nothing, so the migrations' conditional grants see the role. The
-- run after migrate deploy is always required. Every zeus_app privilege in this database is
-- replaced by exactly the list below, so either order ends with the same privileges. On a
-- migrated database a listed object that is missing is an error. Changing what the services
-- touch means changing this list (and its test, src/server/admin/runtime-role.integration.test.ts).

BEGIN;

-- The role: LOGIN, not superuser, no BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION, member of
-- no role (in particular not the owner), owns nothing: no object in public, not the public schema
-- and not the database (an owner keeps owner authority whatever its grants say; Codex F3).
DO $$
DECLARE m record;
BEGIN
  BEGIN
    CREATE ROLE zeus_app LOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; -- created earlier, or concurrently
  END;
  IF (SELECT rolsuper OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = 'zeus_app') THEN
    ALTER ROLE zeus_app NOSUPERUSER NOREPLICATION NOBYPASSRLS; -- needs a superuser; fails loudly otherwise
  END IF;
  ALTER ROLE zeus_app LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
  FOR m IN SELECT g.rolname FROM pg_auth_members a JOIN pg_roles g ON g.oid = a.roleid JOIN pg_roles u ON u.oid = a.member
    WHERE u.rolname = 'zeus_app' LOOP
    EXECUTE format('REVOKE %I FROM zeus_app', m.rolname);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = current_database() AND r.rolname = 'zeus_app') THEN
    RAISE EXCEPTION 'zeus_app owns the database; reassign it to the owner first (ALTER DATABASE ... OWNER TO ...)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE n.nspname = 'public' AND r.rolname = 'zeus_app') THEN
    RAISE EXCEPTION 'zeus_app owns schema public; reassign it to the owner first (ALTER SCHEMA public OWNER TO ...)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = 'public' AND r.rolname = 'zeus_app') THEN
    RAISE EXCEPTION 'zeus_app owns objects in schema public; reassign them to the owner first';
  END IF;
END $$;

-- Schema: USAGE only. Nobody but the owner creates objects in public.
REVOKE ALL ON SCHEMA public FROM zeus_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO zeus_app;

-- Start from nothing (table revokes include column privileges).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM zeus_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM zeus_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM zeus_app;

-- The exact list, one table per line. Before the first migration (no _prisma_migrations) a
-- missing object is skipped; after it, a missing object stops the script.
DO $$
DECLARE
  migrated boolean := to_regclass('public._prisma_migrations') IS NOT NULL;
  g text[];
BEGIN
  IF to_regprocedure('public.publish_catalog(text, text, text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION publish_catalog(text, text, text, text) FROM PUBLIC;
  ELSIF migrated THEN
    RAISE EXCEPTION 'publish_catalog(text, text, text, text) is missing: run this after prisma migrate deploy completes';
  END IF;
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    -- Catalog and schedule: read only.
    ['catalog_releases', 'SELECT'], ['catalog_head', 'SELECT'], ['catalog_service_versions', 'SELECT'],
    ['service_size_offers', 'SELECT'], ['service_work_plans', 'SELECT'], ['add_on_compatibility', 'SELECT'],
    ['vehicle_categories', 'SELECT'], ['services', 'SELECT'], ['schedule_configs', 'SELECT'], ['time_slots', 'SELECT'],
    ['blocked_dates', 'SELECT'], ['bay_type_queues', 'SELECT'],

    -- Queues, caps and bays (ADMIN settings).
    ['booking_queues', 'SELECT'],
    ['booking_queues', 'UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId")'],
    ['queue_cap_overrides', 'SELECT, INSERT, DELETE'],
    ['queue_cap_overrides', 'UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId")'],
    ['bays', 'SELECT, INSERT'],
    ['bays', 'UPDATE (name, "nameKey", "sortOrder", "isActive", "updatedAt", "bayType")'],

    -- Bookings: customer create inserts; staff mutations change only status, day, queue and
    -- position. The receipt, customer fields and snapshots are never updated.
    ['bookings', 'SELECT, INSERT'],
    ['bookings', 'UPDATE (status, "terminalAt", "cancellationKind", "bookingDate", "startsAt", "endsAt", "queueCode", "queuePosition", revision, "updatedAt")'],
    ['booking_line_items', 'SELECT, INSERT'],
    ['booking_line_items', 'UPDATE ("workStatus", "workStatusChangedAt", "staffPriceCentavos", "staffPriceSetAt", "staffPriceSetByStaffId", "removedAt", "removedByStaffId")'],

    -- Bay board: assignments, occupancy and assigned workers.
    ['booking_bay_assignments', 'SELECT, INSERT, DELETE'],
    ['booking_bay_assignments', 'UPDATE ("bayId", "assignedAt", "assignedByStaffId")'],
    ['bay_occupancies', 'SELECT, INSERT, DELETE'], ['booking_worker_assignments', 'SELECT, INSERT, DELETE'],

    -- Audit trail: SELECT and INSERT only (S-06). The owner-owned triggers reject UPDATE, DELETE
    -- and TRUNCATE as well.
    ['booking_audit_events', 'SELECT, INSERT'],

    -- Customer create ledger and its single-use challenge record: append only.
    ['booking_operations', 'SELECT, INSERT'], ['booking_turnstile_uses', 'SELECT, INSERT'],
    ['booking_management_grants', 'SELECT, INSERT'], ['booking_management_sessions', 'SELECT, INSERT'],
    ['booking_notification_outbox', 'SELECT, INSERT'],
    ['booking_management_grants', 'UPDATE ("revokedAt")'], ['booking_management_sessions', 'UPDATE ("revokedAt")'],
    ['booking_notification_outbox', 'UPDATE (state, attempts, "nextAttemptAt", "sentAt")'],

    -- Staff sign-in and sessions. Staff rows and passwords are set by the operator CLI with the
    -- owner URL, never by the app; the app reads no staff phone numbers.
    ['staff', 'SELECT (id, email, name, role, "isActive")'],
    ['staff_credentials', 'SELECT'],
    ['staff_credentials', 'UPDATE ("passwordHash", "failedLoginCount", "lockedUntil", "updatedAt")'],
    ['staff_sessions', 'SELECT, INSERT'],
    ['staff_sessions', 'UPDATE ("revokedAt", "revokedReason", "lastSeenAt", "idleExpiresAt")']
  ] LOOP
    IF to_regclass(format('public.%I', g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON public.%I TO zeus_app', g[2], g[1]);
    ELSIF migrated THEN
      RAISE EXCEPTION 'table % is missing: run this after prisma migrate deploy completes', g[1];
    END IF;
  END LOOP;
END $$;

-- No privileges at all: _prisma_migrations, catalog_publishers, catalog_publication_events,
-- catalog_hold_segments, booking_assignments, slot_capacity_overrides, commission_payouts,
-- inventory_items, inventory_transactions, service_recipes, and EXECUTE on publish_catalog.

-- Owner default privileges for future tables (S-06). Each migration that adds a table revokes
-- these and grants its exact list; this script, run after it, is the final word.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zeus_app;

COMMIT;
