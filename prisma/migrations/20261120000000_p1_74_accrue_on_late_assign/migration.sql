-- P1-74 (CEO option B, 2026-11-13; Security conditions 1-3). A name added to a COMPLETED day-queue booking (late attribution, CEO
-- D-1 in P1-71) re-runs the commission accrual through this owner-run trigger, in the same transaction as the assignment. Until now
-- the app called public.commission_accrue directly, which needed a runtime-role grant that the P1-37 design forbids (the accrual is
-- executable by its owner only; three security checks enforce it). The app's direct call is removed in the same change.
-- Release order: this migration, then the code without the direct call, then prisma/sql/runtime-role.sql (which then removes the
-- EXECUTE that earlier migrations granted to zeus_app). Running the script before the code would break adding a name to a done job.
BEGIN;

-- Re-reads the booking itself (never trusts NEW for the status); accrues only a COMPLETED QUEUE_V3 booking. commission_accrue keeps
-- its own rules: paid or adjusted entries are never changed, and an unchanged crew is not credited twice. Any error propagates, so
-- the assignment rolls back with it.
CREATE OR REPLACE FUNCTION public.commission_accrue_on_late_assign() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  st text;
  snap text;
BEGIN
  SELECT b.status::text, b."snapshotVersion"::text INTO st, snap FROM public.bookings b WHERE b.id = NEW."bookingId";
  IF st = 'COMPLETED' AND snap = 'QUEUE_V3' THEN
    PERFORM public.commission_accrue(NEW."bookingId");
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.commission_accrue_on_late_assign() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    REVOKE ALL ON FUNCTION public.commission_accrue_on_late_assign() FROM zeus_app;
  END IF;
END $$;

CREATE TRIGGER commission_accrue_on_late_assign
  AFTER INSERT ON public.booking_worker_assignments
  FOR EACH ROW EXECUTE FUNCTION public.commission_accrue_on_late_assign();

COMMIT;
