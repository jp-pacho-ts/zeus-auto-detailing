BEGIN;

CREATE OR REPLACE FUNCTION admin_commission_recalculate(p_actor text, p_booking text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  before_rows jsonb;
  after_rows jsonb;
  settled boolean;
  changed boolean := false;
  line record;
  preview jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(746001,1);
  PERFORM public.admin_assert_actor(p_actor);
  SELECT * INTO b FROM public.bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZT404'; END IF;
  IF b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN
    RAISE EXCEPTION 'Only a finished booking has a commission to recalculate' USING ERRCODE = 'ZC010';
  END IF;
  PERFORM 1 FROM public.commission_entries WHERE "bookingId"=p_booking ORDER BY id FOR UPDATE;
  SELECT EXISTS (
    SELECT 1 FROM public.commission_entries e WHERE e."bookingId"=p_booking
      AND (e."paidAt" IS NOT NULL OR EXISTS (SELECT 1 FROM public.commission_adjustments a WHERE a."entryId"=e.id))
  ) INTO settled;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('staffId', e."staffId", 'name', s.name, 'rateBp', e."rateBp",
    'amountCentavos', e."amountCentavos" + COALESCE((SELECT sum(a."amountCentavos") FROM public.commission_adjustments a WHERE a."entryId"=e.id),0))
    ORDER BY e.position), '[]'::jsonb)
  INTO before_rows FROM public.commission_entries e JOIN public.staff s ON s.id=e."staffId" WHERE e."bookingId"=p_booking;

  FOR line IN
    SELECT l.id, COALESCE((s."sizeDeductions"->>b."vehicleSizeCodeSnapshot")::integer,s."expenseDeductionCentavos") AS amount
    FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId"
    WHERE l."bookingId"=p_booking AND l."removedAt" IS NULL
      AND public.commission_line_eligible(s.id,b."vehicleSizeCodeSnapshot")
    ORDER BY l."order"
  LOOP
    IF line.amount IS DISTINCT FROM public.service_cost_for_line(line.id) THEN
      changed := true;
      IF settled THEN
        preview := public.admin_booking_deduction_correct(p_actor,p_booking,line.id,line.amount,NULL);
        PERFORM public.admin_booking_deduction_correct(p_actor,p_booking,line.id,line.amount,preview->>'token');
      ELSE
        INSERT INTO public.booking_deduction_overrides ("lineId","amountCentavos") VALUES (line.id,line.amount)
        ON CONFLICT ("lineId") DO UPDATE SET "amountCentavos"=EXCLUDED."amountCentavos";
      END IF;
    END IF;
  END LOOP;

  IF settled THEN
    IF NOT changed AND NOT EXISTS (
      SELECT 1 FROM public.booking_deduction_overrides o JOIN public.booking_line_items l ON l.id=o."lineId"
      WHERE l."bookingId"=p_booking
    ) THEN
      RAISE EXCEPTION 'This commission is already paid or adjusted, so it was not changed' USING ERRCODE='ZC011';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('staffId', e."staffId", 'name', s.name, 'rateBp', e."rateBp",
      'amountCentavos', e."amountCentavos" + COALESCE((SELECT sum(a."amountCentavos") FROM public.commission_adjustments a WHERE a."entryId"=e.id),0))
      ORDER BY e.position), '[]'::jsonb)
    INTO after_rows FROM public.commission_entries e JOIN public.staff s ON s.id=e."staffId" WHERE e."bookingId"=p_booking;
    RETURN jsonb_build_object('before',before_rows,'after',after_rows);
  END IF;

  PERFORM set_config('zeus.allow_commission_reaccrue', 'on', true);
  DELETE FROM public.commission_entries WHERE "bookingId" = p_booking;
  DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
  PERFORM set_config('zeus.allow_commission_reaccrue', 'off', true);
  PERFORM public.commission_accrue(p_booking);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('staffId', e."staffId", 'name', s.name, 'rateBp', e."rateBp", 'amountCentavos', e."amountCentavos") ORDER BY e."position"), '[]'::jsonb)
    INTO after_rows FROM public.commission_entries e JOIN public.staff s ON s.id = e."staffId" WHERE e."bookingId" = p_booking;
  -- The audit CHECK allows no new action; the accrual row says who asked for it.
  INSERT INTO public.admin_audit_events (action, "bookingId", "entryCount", reason)
    VALUES ('COMMISSION_ACCRUED', p_booking, jsonb_array_length(after_rows), 'Recalculated by ' || p_actor);
  RETURN jsonb_build_object('before', before_rows, 'after', after_rows);
END $$;

COMMIT;
