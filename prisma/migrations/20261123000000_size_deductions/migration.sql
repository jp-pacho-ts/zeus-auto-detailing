BEGIN;
ALTER TABLE public.services ADD COLUMN "sizeDeductions" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE FUNCTION public.admin_service_set_size_deductions(p_actor text, p_service text, p_amounts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  IF jsonb_typeof(p_amounts) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid vehicle deductions' USING ERRCODE='ZT006';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_amounts)
    WHERE key NOT IN ('MOTOR','S','M','L','XL')
      OR jsonb_typeof(value) <> 'number'
      OR value::text !~ '^(0|[1-9][0-9]{0,7}|100000000)$'
  ) THEN
    RAISE EXCEPTION 'Invalid vehicle deduction amount' USING ERRCODE='ZT006';
  END IF;
  UPDATE public.services SET "sizeDeductions"=p_amounts WHERE id=p_service;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='ZT001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_service_set_size_deductions(text,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_service_costs_on_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.service_cost_snapshots ("lineId","bookingId","bookingReference","serviceName","amountCentavos","expenseDate",recorded)
    SELECT l.id, NEW.id, NEW."referenceCode", l."nameSnapshot", COALESCE((s."sizeDeductions"->>NEW."vehicleSizeCodeSnapshot")::integer, s."expenseDeductionCentavos"),
      (COALESCE(NEW."terminalAt",CURRENT_TIMESTAMP) AT TIME ZONE 'Asia/Manila')::date, false
    FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId"
    WHERE l."bookingId"=NEW.id AND l."removedAt" IS NULL
    ON CONFLICT ("lineId") DO NOTHING;
  RETURN NEW;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
   GRANT EXECUTE ON FUNCTION public.admin_service_set_size_deductions(text,text,jsonb) TO zeus_app;
 END IF;
END $$;
COMMIT;
