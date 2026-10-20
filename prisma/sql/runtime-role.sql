-- P1-10 M1 (ADR-003 S-06; ARCHITECTURE "Audit immutability and database principals").
-- The least-privilege runtime role zeus_app. Owner-run and idempotent; no password in this file.
--
-- Run as the migration owner after every `prisma migrate deploy`, never from the app:
--   npx prisma db execute --file prisma/sql/runtime-role.sql --url "<owner URL>"
--   (or: psql "<owner URL>" -v ON_ERROR_STOP=1 -f prisma/sql/runtime-role.sql)
-- Then set the password interactively (psql: \password zeus_app). The application's
-- DATABASE_URL uses zeus_app; the owner URL never sits in the app's environment.
--
-- Every zeus_app privilege in this database is replaced by exactly the list below, so running it
-- again, before or after the migrations' own conditional grants, gives the same result. Changing
-- what the services touch means changing this list (and its test,
-- src/server/admin/runtime-role.integration.test.ts).

BEGIN;

-- The role: LOGIN, not superuser, no BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION, member of
-- no role (in particular not the owner), owns nothing.
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
REVOKE ALL ON FUNCTION publish_catalog(text, text, text, text) FROM PUBLIC;

-- Catalog and schedule: read only.
GRANT SELECT ON catalog_releases, catalog_head, catalog_service_versions, service_size_offers, service_work_plans,
  add_on_compatibility, vehicle_categories, services, schedule_configs, time_slots, blocked_dates, bay_type_queues TO zeus_app;

-- Queues, caps and bays (ADMIN settings).
GRANT SELECT ON booking_queues TO zeus_app;
GRANT UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId") ON booking_queues TO zeus_app;
GRANT SELECT, INSERT, DELETE ON queue_cap_overrides TO zeus_app;
GRANT UPDATE ("dailyCap", revision, "updatedAt", "updatedByStaffId") ON queue_cap_overrides TO zeus_app;
GRANT SELECT, INSERT ON bays TO zeus_app;
GRANT UPDATE (name, "nameKey", "sortOrder", "isActive", "updatedAt", "bayType") ON bays TO zeus_app;

-- Bookings: customer create inserts; staff mutations change only status, day, queue and
-- position. The receipt, customer fields and snapshots are never updated.
GRANT SELECT, INSERT ON bookings TO zeus_app;
GRANT UPDATE (status, "terminalAt", "cancellationKind", "bookingDate", "startsAt", "endsAt", "queueCode", "queuePosition",
  revision, "updatedAt") ON bookings TO zeus_app;
GRANT SELECT, INSERT ON booking_line_items TO zeus_app;
GRANT UPDATE ("workStatus", "workStatusChangedAt", "staffPriceCentavos", "staffPriceSetAt", "staffPriceSetByStaffId",
  "removedAt", "removedByStaffId") ON booking_line_items TO zeus_app;

-- Bay board: assignments, occupancy and assigned workers.
GRANT SELECT, INSERT, DELETE ON booking_bay_assignments TO zeus_app;
GRANT UPDATE ("bayId", "assignedAt", "assignedByStaffId") ON booking_bay_assignments TO zeus_app;
GRANT SELECT, INSERT, DELETE ON bay_occupancies, booking_worker_assignments TO zeus_app;

-- Audit trail: SELECT and INSERT only (S-06). The owner-owned triggers reject UPDATE, DELETE
-- and TRUNCATE as well.
GRANT SELECT, INSERT ON booking_audit_events TO zeus_app;

-- Customer create ledger and its single-use challenge record: append only.
GRANT SELECT, INSERT ON booking_operations, booking_turnstile_uses TO zeus_app;
GRANT SELECT, INSERT ON booking_management_grants, booking_management_sessions, booking_notification_outbox TO zeus_app;
GRANT UPDATE ("revokedAt") ON booking_management_grants, booking_management_sessions TO zeus_app;
GRANT UPDATE (state, attempts, "nextAttemptAt", "sentAt") ON booking_notification_outbox TO zeus_app;

-- Staff sign-in and sessions. Staff rows and passwords are set by the operator CLI with the
-- owner URL, never by the app; the app reads no staff phone numbers.
GRANT SELECT (id, email, name, role, "isActive") ON staff TO zeus_app;
GRANT SELECT ON staff_credentials TO zeus_app;
GRANT UPDATE ("passwordHash", "failedLoginCount", "lockedUntil", "updatedAt") ON staff_credentials TO zeus_app;
GRANT SELECT, INSERT ON staff_sessions TO zeus_app;
GRANT UPDATE ("revokedAt", "revokedReason", "lastSeenAt", "idleExpiresAt") ON staff_sessions TO zeus_app;

-- No privileges at all: _prisma_migrations, catalog_publishers, catalog_publication_events,
-- catalog_hold_segments, booking_assignments, slot_capacity_overrides, commission_payouts,
-- inventory_items, inventory_transactions, service_recipes, and EXECUTE on publish_catalog.

-- Owner default privileges for future tables (S-06). Each migration that adds a table revokes
-- these and grants its exact list; this script, run after it, is the final word.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zeus_app;

COMMIT;
