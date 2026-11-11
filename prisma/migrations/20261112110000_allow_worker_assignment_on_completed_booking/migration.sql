-- Allow assigning workers to COMPLETED bookings (e.g. for late commission attribution or missing worker records)
CREATE OR REPLACE FUNCTION guard_board_relation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
  b public.bookings;
BEGIN
 PERFORM pg_advisory_xact_lock(746001,1);
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Board relations are insert/delete only'; END IF;
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='booking_worker_assignments' AND NOT EXISTS(
    SELECT 1 FROM public.bookings WHERE id=OLD."bookingId" AND "snapshotVersion"::text='QUEUE_V3' AND status IN ('PENDING','CONFIRMED','IN_PROGRESS')
  ) THEN RAISE EXCEPTION 'Closed worker history cannot be changed'; END IF;
  RETURN OLD;
 END IF;

 SELECT * INTO b FROM public.bookings WHERE id=NEW."bookingId";
 IF b.id IS NULL OR b."snapshotVersion"::text<>'QUEUE_V3' THEN
   RAISE EXCEPTION 'Assign only day-queue bookings';
 END IF;

 IF TG_TABLE_NAME='booking_worker_assignments' THEN
   -- Allow assigning workers even on COMPLETED bookings
   IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED') THEN
     RAISE EXCEPTION 'Assign only open or completed day-queue bookings';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
     RAISE EXCEPTION 'ADMIN assignment required';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."staffId" AND "isActive") THEN
     RAISE EXCEPTION 'Assign an active worker';
   END IF;
 ELSE
   -- Bays are only for open bookings
   IF b.status NOT IN ('PENDING','CONFIRMED','IN_PROGRESS') THEN
     RAISE EXCEPTION 'Assign only open day-queue bookings';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW."assignedByStaffId" AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
     RAISE EXCEPTION 'ADMIN assignment required';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.bays WHERE id=NEW."bayId" AND "isActive") THEN
     RAISE EXCEPTION 'Assign an active bay';
   END IF;
 END IF;

 NEW."assignedAt":=CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
