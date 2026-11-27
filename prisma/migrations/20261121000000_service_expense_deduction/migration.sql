-- Configurable flat cost per service line, recorded once when a QUEUE_V3 booking completes.
-- Completed history gets commission snapshots only; no retroactive expenses are invented.
ALTER TABLE public.services ADD COLUMN "expenseDeductionCentavos" integer NOT NULL DEFAULT 0
  CHECK ("expenseDeductionCentavos" BETWEEN 0 AND 100000000);
UPDATE public.services s SET "expenseDeductionCentavos" = 150000
 WHERE s.category = 'CERAMIC_COATING' AND EXISTS (
   SELECT 1 FROM public.catalog_service_versions v WHERE v."serviceId" = s.id AND v."group" = 'GRAPHENE');

-- Catalog imports can insert legacy coating services after this migration (including fresh installations).
-- The admin create path explicitly saves its chosen amount, including zero, in the same transaction.
CREATE FUNCTION public.service_expense_initial_default() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.category='CERAMIC_COATING' THEN NEW."expenseDeductionCentavos":=150000; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.service_expense_initial_default() FROM PUBLIC;
CREATE TRIGGER service_expense_initial_default BEFORE INSERT ON public.services FOR EACH ROW
 EXECUTE FUNCTION public.service_expense_initial_default();

CREATE TABLE public.service_cost_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq bigint NOT NULL UNIQUE DEFAULT nextval('public.expenses_seq_seq'),
  "lineId" text NOT NULL UNIQUE,
  "bookingId" text NOT NULL,
  "bookingReference" text NOT NULL,
  "serviceName" text NOT NULL,
  "amountCentavos" integer NOT NULL CHECK ("amountCentavos" BETWEEN 0 AND 100000000),
  "expenseDate" date NOT NULL,
  "categoryId" text REFERENCES public.expense_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  recorded boolean NOT NULL,
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX service_cost_snapshots_booking_idx ON public.service_cost_snapshots("bookingId");
CREATE INDEX service_cost_snapshots_date_idx ON public.service_cost_snapshots("expenseDate", seq);
REVOKE ALL ON public.service_cost_snapshots FROM PUBLIC;

INSERT INTO public.service_cost_snapshots ("lineId", "bookingId", "bookingReference", "serviceName", "amountCentavos", "expenseDate", recorded)
 SELECT l.id, b.id, b."referenceCode", l."nameSnapshot",
   CASE WHEN s.category = 'CERAMIC_COATING' AND EXISTS (
     SELECT 1 FROM public.catalog_service_versions v WHERE v."releaseId"=l."releaseId" AND v."serviceId"=l."serviceId" AND v."group"='GRAPHENE'
   ) THEN 150000 ELSE 0 END,
   (COALESCE(b."terminalAt", CURRENT_TIMESTAMP) AT TIME ZONE 'Asia/Manila')::date, false
 FROM public.booking_line_items l JOIN public.bookings b ON b.id=l."bookingId" JOIN public.services s ON s.id=l."serviceId"
 WHERE b.status='COMPLETED' AND b."snapshotVersion"='QUEUE_V3' AND l."removedAt" IS NULL;

CREATE TRIGGER service_cost_immutable BEFORE UPDATE OR DELETE ON public.service_cost_snapshots
 FOR EACH ROW EXECUTE FUNCTION public.reject_expense_change();
CREATE TRIGGER service_cost_no_truncate BEFORE TRUNCATE ON public.service_cost_snapshots
 FOR EACH STATEMENT EXECUTE FUNCTION public.reject_expense_change();

CREATE FUNCTION public.admin_service_set_expense_deduction(p_actor text, p_service text, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  IF p_amount IS NULL OR p_amount NOT BETWEEN 0 AND 100000000 THEN
    RAISE EXCEPTION 'Invalid service expense amount' USING ERRCODE='ZT006';
  END IF;
  UPDATE public.services SET "expenseDeductionCentavos"=p_amount WHERE id=p_service;
  IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='ZT001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_service_set_expense_deduction(text,text,integer) FROM PUBLIC;

CREATE FUNCTION public.service_cost_for_line(p_line text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT COALESCE((SELECT c."amountCentavos" FROM public.service_cost_snapshots c WHERE c."lineId"=l.id), s."expenseDeductionCentavos")
 FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId" WHERE l.id=p_line
$$;
REVOKE ALL ON FUNCTION public.service_cost_for_line(text) FROM PUBLIC;

CREATE FUNCTION public.record_service_costs_on_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE category_id text;
BEGIN
  -- Keep the configured amounts stable across category creation and the snapshot insert.
  PERFORM s.id FROM public.services s WHERE EXISTS (
    SELECT 1 FROM public.booking_line_items l WHERE l."bookingId"=NEW.id AND l."removedAt" IS NULL AND l."serviceId"=s.id
  ) ORDER BY s.id FOR SHARE OF s;
  IF EXISTS (SELECT 1 FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId"
             WHERE l."bookingId"=NEW.id AND l."removedAt" IS NULL AND s."expenseDeductionCentavos">0) THEN
    INSERT INTO public.expense_categories (name,"nameKey","sortOrder") VALUES ('Service costs','service costs',8)
      ON CONFLICT ("nameKey") DO UPDATE SET name=expense_categories.name RETURNING id INTO category_id;
  END IF;
  INSERT INTO public.service_cost_snapshots ("lineId","bookingId","bookingReference","serviceName","amountCentavos","expenseDate","categoryId",recorded)
    SELECT l.id, NEW.id, NEW."referenceCode", l."nameSnapshot", s."expenseDeductionCentavos",
      (COALESCE(NEW."terminalAt",CURRENT_TIMESTAMP) AT TIME ZONE 'Asia/Manila')::date, category_id, true
    FROM public.booking_line_items l JOIN public.services s ON s.id=l."serviceId"
    WHERE l."bookingId"=NEW.id AND l."removedAt" IS NULL
    ON CONFLICT ("lineId") DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_service_costs_on_completion() FROM PUBLIC;
-- BEFORE status update so the existing AFTER commission trigger sees exactly the recorded cost.
CREATE TRIGGER service_costs_on_completion BEFORE UPDATE OF status ON public.bookings FOR EACH ROW
 WHEN (OLD.status IS DISTINCT FROM 'COMPLETED' AND NEW.status='COMPLETED' AND NEW."snapshotVersion"='QUEUE_V3')
 EXECUTE FUNCTION public.record_service_costs_on_completion();

-- Shared read model: automatic rows participate in pagination, categories, monthly charts and profit exactly once.
CREATE VIEW public.expense_rows AS
 SELECT id,seq,"expenseDate","categoryId","amountCentavos",payee,note,revision,"voidedAt","createdAt",
   false AS automatic, NULL::text AS "bookingId" FROM public.expenses
 UNION ALL
 SELECT id,seq,"expenseDate","categoryId","amountCentavos"::bigint,NULL::text,
   "serviceName" || ' · ' || "bookingReference",1,NULL::timestamptz,"createdAt",true,"bookingId"
 FROM public.service_cost_snapshots WHERE recorded AND "amountCentavos">0;
REVOKE ALL ON public.expense_rows FROM PUBLIC;

CREATE OR REPLACE FUNCTION commission_accrue(p_booking text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  total bigint;
  unpriced integer;
  eligible integer;
  default_bp integer;
  ids text[];
  rates integer[];
  existing_ids text[];
  n integer;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = p_booking;
  IF NOT FOUND OR b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN
    RETURN 0;
  END IF;

  SELECT "defaultRateBp" INTO default_bp FROM public.commission_settings WHERE id = 1;
  IF default_bp IS NULL THEN
    default_bp := 2000;
  END IF;


  SELECT COALESCE(sum(
           CASE
             WHEN sv.category = 'CERAMIC_COATING' AND EXISTS(
               SELECT 1 FROM public.catalog_service_versions v WHERE v."releaseId" = l."releaseId" AND v."serviceId" = l."serviceId" AND v."group" = 'GRAPHENE'
             ) THEN COALESCE(
               (
                 SELECT GREATEST(0,
                   COALESCE(
                     GREATEST(0, o."unitPriceCentavos" - public.service_cost_for_line(l.id)) - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                     GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
                   )
                 )
                 FROM public.catalog_service_versions ev
                 JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                 LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                 WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                 LIMIT 1
               ),
               GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
             )
             ELSE GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
           END
         ) FILTER (WHERE public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot")), 0)::bigint,
         count(*) FILTER (WHERE (public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot")) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
         count(*) FILTER (WHERE public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot"))::integer
    INTO total, unpriced, eligible
    FROM public.booking_line_items l
    JOIN public.services sv ON sv.id = l."serviceId"
   WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL;

  IF total > 1000000000000 THEN
    RAISE EXCEPTION 'The service total is above the supported commission range' USING ERRCODE = 'ZC006';
  END IF;

  IF eligible > 0 THEN
    -- Each service earns at its own rate (LE 2026-11-12): a worker's rate is the price-weighted mix of the line rates, where a
    -- line without a service rate uses the worker's rate, then the shop default. Rounded to a whole basis point, so the stored
    -- entries still pass commission_consistency_check. With a zero base every line weighs nothing: the worker's own rate.
    WITH lb AS (
      SELECT (CASE
             WHEN sv.category = 'CERAMIC_COATING' AND EXISTS(
               SELECT 1 FROM public.catalog_service_versions v WHERE v."releaseId" = l."releaseId" AND v."serviceId" = l."serviceId" AND v."group" = 'GRAPHENE'
             ) THEN COALESCE(
               (
                 SELECT GREATEST(0,
                   COALESCE(
                     GREATEST(0, o."unitPriceCentavos" - public.service_cost_for_line(l.id)) - GREATEST(0, COALESCE(l."subtotalCentavos", l."referenceSubtotalCentavos", o_orig."unitPriceCentavos", 0) - COALESCE(l."staffPriceCentavos", l."subtotalCentavos", 0)),
                     GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
                   )
                 )
                 FROM public.catalog_service_versions ev
                 JOIN public.service_size_offers o ON o."releaseId" = ev."releaseId" AND o."serviceId" = ev."serviceId" AND o."vehicleCategoryId" = l."vehicleCategoryId"
                 LEFT JOIN public.service_size_offers o_orig ON o_orig."id" = l."offerId"
                 WHERE ev."releaseId" = l."releaseId" AND ev.slug = 'eclipse-graphene'
                 LIMIT 1
               ),
               GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
             )
             ELSE GREATEST(0, COALESCE(l."staffPriceCentavos", l."subtotalCentavos") - public.service_cost_for_line(l.id))
           END)::bigint AS base, sv."commissionRateBp" AS rate, sv."commissionMode" AS mode, c."rateBp" AS size_rate,
             c."fixedCentavos" AS fixed, l.quantity AS qty
        FROM public.booking_line_items l
        JOIN public.services sv ON sv.id = l."serviceId"
        LEFT JOIN public.service_size_commissions c ON c."serviceId" = sv.id AND c."sizeCode" = b."vehicleSizeCodeSnapshot"
       WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL AND (public.commission_line_eligible(sv.id, b."vehicleSizeCodeSnapshot"))
    )
    SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"),
           array_agg(CASE WHEN total > 0 THEN LEAST(10000, GREATEST(0, round(
                  (SELECT sum(CASE lb.mode WHEN 'SIZE_FIXED' THEN COALESCE(lb.fixed, 0) * lb.qty * 10000
                                         WHEN 'SIZE_PERCENT' THEN lb.base * COALESCE(lb.size_rate, 0)
                                         ELSE lb.base * COALESCE(lb.rate, s."commissionRateBp", default_bp) END) FROM lb)::numeric / total)))::integer
                ELSE COALESCE(s."commissionRateBp", default_bp) END ORDER BY w."assignedAt", w."staffId")
      INTO ids, rates
      FROM public.booking_worker_assignments w
      JOIN public.staff s ON s.id = w."staffId"
     WHERE w."bookingId" = p_booking;
  END IF;
  n := COALESCE(array_length(ids, 1), 0);

  IF EXISTS (SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN
    SELECT array_agg(e."staffId" ORDER BY e."position")
      INTO existing_ids
      FROM public.commission_entries e
     WHERE e."bookingId" = p_booking;

    -- Already accrued for the exact same assigned workers
    IF existing_ids IS NOT DISTINCT FROM ids THEN
      RETURN 0;
    END IF;

    -- Never overwrite paid or manually adjusted commission entries
    IF EXISTS (
      SELECT 1 FROM public.commission_entries e
      WHERE e."bookingId" = p_booking
        AND (e."paidAt" IS NOT NULL OR EXISTS (SELECT 1 FROM public.commission_adjustments a WHERE a."entryId" = e.id))
    ) THEN
      RETURN 0;
    END IF;

    PERFORM set_config('zeus.allow_commission_reaccrue', 'on', true);
    DELETE FROM public.commission_entries WHERE "bookingId" = p_booking;
    DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
    PERFORM set_config('zeus.allow_commission_reaccrue', 'off', true);
  END IF;

  INSERT INTO public.commission_accruals ("bookingId", "serviceTotalCentavos", "eligibleLineCount", "unpricedLineCount", "creditedCount", "completedOn")
    VALUES (p_booking, total, eligible, unpriced, n, (COALESCE(b."terminalAt", now()) AT TIME ZONE 'Asia/Manila')::date);
  IF n > 0 THEN
    INSERT INTO public.commission_entries ("bookingId", "staffId", "position", "baseCentavos", "rateBp", "amountCentavos")
      SELECT p_booking, ids[x.idx], x.idx, x.share_centavos, rates[x.idx], x.amount_centavos FROM public.commission_split(total, rates) x;
  END IF;
  PERFORM public.commission_consistency_check(p_booking);
  INSERT INTO public.admin_audit_events (action, "bookingId", "entryCount") VALUES ('COMMISSION_ACCRUED', p_booking, n);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION commission_accrue(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION admin_service_list(p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_rid text;
  v_sizes jsonb;
  v_services jsonb;
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  SELECT "releaseId" INTO v_rid FROM public.catalog_head WHERE "shopId" = 1;
  IF v_rid IS NULL THEN
    RETURN jsonb_build_object('services', '[]'::jsonb, 'vehicleCategories', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', vc.id,
      'code', vc.slug,
      'name', vc.name,
      'sortOrder', vc."sortOrder"
    ) ORDER BY vc."sortOrder" ASC
  ) INTO v_sizes
  FROM public.vehicle_categories vc;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', v."serviceId",
      'slug', v.slug,
      'name', v.name,
      'description', v.description,
      'category', v."group",
      'type', v.type,
      'unit', v.unit,
      'inclusions', v.inclusions,
      'productName', v."productName",
      'hardness', v.hardness,
      'warrantyMonths', v."warrantyMonths",
      'referenceUnitPriceCentavos', v."referenceUnitPriceCentavos",
      'sortOrder', v."sortOrder",
      'isActive', COALESCE(s."isActive", true),
      'expenseDeductionCentavos', s."expenseDeductionCentavos",
      'commissionRateBp', s."commissionRateBp",
      'commissionMode', s."commissionMode",
      'sizeCommissions', COALESCE((SELECT jsonb_agg(jsonb_build_object('sizeCode', c."sizeCode", 'rateBp', c."rateBp", 'fixedCentavos', c."fixedCentavos") ORDER BY c."sizeCode")
                                   FROM public.service_size_commissions c WHERE c."serviceId" = v."serviceId"), '[]'::jsonb),
      'offers', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'vehicleCategoryId', o."vehicleCategoryId",
            'sizeCode', o."sizeCode",
            'state', o.state,
            'bookingMode', o."bookingMode",
            'unitPriceCentavos', o."unitPriceCentavos",
            'compareAtCentavos', o."compareAtCentavos",
            'pickupPriceCentavos', o."pickupPriceCentavos",
            'durationMinutes', p."durationMinutes"
          ) ORDER BY vc."sortOrder" ASC
        )
        FROM public.service_size_offers o
        JOIN public.vehicle_categories vc ON vc.id = o."vehicleCategoryId"
        LEFT JOIN public.service_work_plans p ON p."offerId" = o.id
        WHERE o."releaseId" = v_rid AND o."serviceId" = v."serviceId"
      )
    ) ORDER BY v."sortOrder" ASC, v.slug ASC
  ) INTO v_services
  FROM public.catalog_service_versions v
  LEFT JOIN public.services s ON s.id = v."serviceId"
  WHERE v."releaseId" = v_rid;

  RETURN jsonb_build_object(
    'services', COALESCE(v_services, '[]'::jsonb),
    'vehicleCategories', COALESCE(v_sizes, '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION admin_service_list(text) FROM PUBLIC;


DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
   GRANT SELECT ON public.expense_rows TO zeus_app;
   GRANT EXECUTE ON FUNCTION public.admin_service_set_expense_deduction(text,text,integer) TO zeus_app;
 END IF;
END $$;
