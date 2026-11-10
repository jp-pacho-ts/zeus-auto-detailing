-- Migration: 20261112080000_staff_weekly_payroll
-- Adds staff_payroll_adjustments for weekly salary, absences, and cash advances

CREATE TABLE IF NOT EXISTS public.staff_payroll_adjustments (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  "staffId" text NOT NULL REFERENCES public.staff(id),
  "weekStart" date NOT NULL,
  "daysAbsent" integer NOT NULL DEFAULT 0,
  "dailyRateCentavos" integer NOT NULL DEFAULT 20000,
  "cashAdvanceCentavos" bigint NOT NULL DEFAULT 0,
  "advanceNotes" text,
  "isPaid" boolean NOT NULL DEFAULT false,
  "paidAt" timestamptz(3),
  "paidByStaffId" text REFERENCES public.staff(id),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT staff_payroll_adjustments_unique UNIQUE ("staffId", "weekStart")
);

CREATE INDEX IF NOT EXISTS staff_payroll_adjustments_week_idx ON public.staff_payroll_adjustments("weekStart");
CREATE INDEX IF NOT EXISTS staff_payroll_adjustments_staff_idx ON public.staff_payroll_adjustments("staffId");

-- Helper function: admin_payroll_save_adjustment
CREATE OR REPLACE FUNCTION admin_payroll_save_adjustment(
  p_actor text,
  p_staff_id text,
  p_week_start date,
  p_days_absent integer,
  p_cash_advance_centavos bigint,
  p_advance_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_res public.staff_payroll_adjustments;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);

  IF p_staff_id IS NULL OR p_week_start IS NULL THEN
    RAISE EXCEPTION 'Missing staffId or weekStart' USING ERRCODE = 'ZT006';
  END IF;

  INSERT INTO public.staff_payroll_adjustments (
    "staffId", "weekStart", "daysAbsent", "cashAdvanceCentavos", "advanceNotes", "updatedAt"
  ) VALUES (
    p_staff_id, p_week_start, GREATEST(0, LEAST(6, COALESCE(p_days_absent, 0))), GREATEST(0, COALESCE(p_cash_advance_centavos, 0)), p_advance_notes, now()
  )
  ON CONFLICT ("staffId", "weekStart") DO UPDATE SET
    "daysAbsent" = GREATEST(0, LEAST(6, COALESCE(p_days_absent, EXCLUDED."daysAbsent"))),
    "cashAdvanceCentavos" = GREATEST(0, COALESCE(p_cash_advance_centavos, EXCLUDED."cashAdvanceCentavos")),
    "advanceNotes" = COALESCE(p_advance_notes, EXCLUDED."advanceNotes"),
    "updatedAt" = now()
  RETURNING * INTO v_res;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'staffId', v_res."staffId",
    'weekStart', v_res."weekStart",
    'daysAbsent', v_res."daysAbsent",
    'dailyRateCentavos', v_res."dailyRateCentavos",
    'cashAdvanceCentavos', v_res."cashAdvanceCentavos"::text,
    'advanceNotes', v_res."advanceNotes",
    'isPaid', v_res."isPaid",
    'paidAt', v_res."paidAt"
  );
END $$;

-- Helper function: admin_payroll_set_paid
CREATE OR REPLACE FUNCTION admin_payroll_set_paid(
  p_actor text,
  p_staff_id text,
  p_week_start date,
  p_is_paid boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_res public.staff_payroll_adjustments;
  v_week_end date := p_week_start + 6;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);

  IF p_staff_id IS NULL OR p_week_start IS NULL THEN
    RAISE EXCEPTION 'Missing staffId or weekStart' USING ERRCODE = 'ZT006';
  END IF;

  INSERT INTO public.staff_payroll_adjustments (
    "staffId", "weekStart", "isPaid", "paidAt", "paidByStaffId", "updatedAt"
  ) VALUES (
    p_staff_id, p_week_start, p_is_paid, CASE WHEN p_is_paid THEN now() ELSE NULL END, CASE WHEN p_is_paid THEN p_actor ELSE NULL END, now()
  )
  ON CONFLICT ("staffId", "weekStart") DO UPDATE SET
    "isPaid" = p_is_paid,
    "paidAt" = CASE WHEN p_is_paid THEN now() ELSE NULL END,
    "paidByStaffId" = CASE WHEN p_is_paid THEN p_actor ELSE NULL END,
    "updatedAt" = now()
  RETURNING * INTO v_res;

  -- Also update commission entries for this staff in that week:
  IF p_is_paid THEN
    UPDATE public.commission_entries e
    SET "paidAt" = COALESCE(e."paidAt", now()), "paidByStaffId" = COALESCE(e."paidByStaffId", p_actor)
    FROM public.commission_accruals a
    WHERE a."bookingId" = e."bookingId"
      AND e."staffId" = p_staff_id
      AND a."completedOn" BETWEEN p_week_start AND v_week_end;
  ELSE
    UPDATE public.commission_entries e
    SET "paidAt" = NULL, "paidByStaffId" = NULL
    FROM public.commission_accruals a
    WHERE a."bookingId" = e."bookingId"
      AND e."staffId" = p_staff_id
      AND a."completedOn" BETWEEN p_week_start AND v_week_end;
  END IF;

  RETURN jsonb_build_object(
    'id', v_res.id,
    'staffId', v_res."staffId",
    'weekStart', v_res."weekStart",
    'isPaid', v_res."isPaid",
    'paidAt', v_res."paidAt"
  );
END $$;

REVOKE ALL ON FUNCTION admin_payroll_save_adjustment(text, text, date, integer, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_payroll_set_paid(text, text, date, boolean) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_payroll_save_adjustment(text, text, date, integer, bigint, text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_payroll_set_paid(text, text, date, boolean) TO zeus_app;
    GRANT SELECT, INSERT, UPDATE ON public.staff_payroll_adjustments TO zeus_app;
  END IF;
END $$;
