BEGIN;

-- Keep the per-booking cost snapshot for commission calculations.
CREATE OR REPLACE FUNCTION public.record_service_costs_on_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  INSERT INTO public.service_cost_snapshots ("lineId","bookingId","bookingReference","serviceName","amountCentavos","expenseDate",recorded)
    SELECT l.id, NEW.id, NEW."referenceCode", l."nameSnapshot", s."expenseDeductionCentavos",
      (COALESCE(NEW."terminalAt",CURRENT_TIMESTAMP) AT TIME ZONE 'Asia/Manila')::date, false
    FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId"
    WHERE l."bookingId"=NEW.id AND l."removedAt" IS NULL
    ON CONFLICT ("lineId") DO NOTHING;
  RETURN NEW;
END $$;
-- Older app instances still read this view during deployment. Exclude all
-- automatic service costs, including snapshots written before this correction.
CREATE OR REPLACE VIEW public.expense_rows AS
 SELECT id,seq,"expenseDate","categoryId","amountCentavos",payee,note,revision,"voidedAt"::timestamptz AS "voidedAt","createdAt",
   false AS automatic, NULL::text AS "bookingId" FROM public.expenses;

COMMIT;
