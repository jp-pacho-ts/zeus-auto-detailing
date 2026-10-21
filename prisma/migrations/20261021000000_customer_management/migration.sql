BEGIN;
-- The original operation/receipt remains immutable; remember authenticated no-op outcomes.
ALTER TABLE booking_operations ADD COLUMN "noChange" BOOLEAN;

-- I3: every lifecycle writer, including direct maintenance SQL, must release physical occupancy
-- when cancelling, rescheduling or changing queue. Deferred so an audited staff release can be
-- written in the same transaction after the booking's single revision bump.
CREATE FUNCTION check_booking_move_releases_occupancy() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.bay_occupancies WHERE "bookingId"=NEW.id) THEN
  RAISE EXCEPTION 'Booking day/queue changes must release bay occupancy';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_move_releases_occupancy AFTER UPDATE ON bookings
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (OLD."bookingDate" IS DISTINCT FROM NEW."bookingDate" OR OLD."queueCode" IS DISTINCT FROM NEW."queueCode" OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='CANCELLED'))
 EXECUTE FUNCTION check_booking_move_releases_occupancy();

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 -- Exact columns used by authenticated customer cancellation/day rescheduling; no contact,
 -- credential-version, queue, service, price or receipt snapshot privilege is added.
 GRANT UPDATE ("bookingDate","startsAt","endsAt",status,"cancellationKind","terminalAt","queuePosition",revision,"updatedAt") ON bookings TO zeus_app;
 GRANT DELETE ON booking_bay_assignments TO zeus_app;
END IF; END $$;
COMMIT;
