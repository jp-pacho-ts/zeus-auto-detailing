BEGIN;
-- P1-37: Team and commissions. EXPAND ONLY: nothing is dropped, renamed or narrowed, so the code that is live
-- while this runs (which selects every column of "staff") keeps working. The legacy commission_payouts table and
-- staff."defaultCommissionRate" stay, unused, until a separate contract migration (P1-37b) removes them after the
-- new code is live. Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then
-- prisma/sql/p1-37-readonly-check.sql, then the code.
-- ONE EXCEPTION to "expand only" (review R2-5): section 7b tightens the existing guard_booking_line_change(): a staff price change on
-- a COMPLETED booking is now refused by the database. While the OLD code is still live (migration first), an admin who prices a line
-- on a completed booking gets a raw database error instead of the plain refusal. Release note: do that step right before the code
-- goes live, or ship migration and code together. Nothing else in this migration changes what the live code does.
--
-- What it adds
--  * staff: "commissionRateBp" (NULL = use the default), "revision", "updatedAt".
--  * commission_settings: one row, the default percentage in basis points (2000 = 20.00%, LE 2026-11-07; the old schema carried
--    1000 = 10.00%; the LE changes it in the screen) and the moment commissions began. RULE (LE 2026-11-07): only lines whose
--    service category is CERAMIC_COATING, PAINT_CORRECTION, INTERIOR_DETAILING or WINDOW_TINT_PPF earn commission; the car wash
--    (EXTERIOR_WASH_SEAL, the catalogue's WASH group, add-ons included) earns none. The list is ONE function, commission_earns_on().
--    The catalogue publishes services.category from the group: WASH -> EXTERIOR_WASH_SEAL, DETAILING (interior, exterior, engine, full
--    detailing, headlight restoration) -> INTERIOR_DETAILING, GRAPHENE -> CERAMIC_COATING, TINT and PPF -> WINDOW_TINT_PPF,
--    REPAINT -> PAINT_CORRECTION (prisma/catalog/catalog.mjs). Every line has a service, so there is no line without a category.
--    schema already carried; the LE changes it in the screen) and "startsAt", the moment commissions began.
--  * commission_accruals: one immutable header per completed QUEUE_V3 booking (the service total at completion,
--    how many people were credited, how many services had no final price). Money columns are BIGINT centavos with a
--    CHECK range of 0 to 1,000,000,000,000 (10 billion pesos): a booking can hold many lines of up to 100,000,000
--    centavos each, and the total is never clipped (a total above the range fails visibly instead).
--  * commission_entries: one row per credited person (their equal share of the total, the percentage used, the
--    amount, and the paid state). Every column except the paid state is immutable; nothing is ever deleted.
--  * commission_adjustments: insert-only signed corrections to one entry (a late price), ADMIN only, with a reason; see the adjustments block after commission_entries.
--  * admin_audit_events: a generic, insert-only audit table for staff and money writes (P1-38 to P1-40 reuse it).
--    It stores NO name, phone or email, with one exception: STAFF_REMOVED keeps the removed person's name in
--    "targetLabel" (the row they leave behind has to be recognisable after the person row is gone).
--
-- How it is protected
--  * The runtime role (zeus_app) gets SELECT on the three commission tables and NOTHING on admin_audit_events,
--    and no new privilege at all on staff. Every write is a SECURITY DEFINER function owned by the migration
--    owner (search_path pg_catalog, public, pg_temp with pg_temp LAST, every application object schema-qualified,
--    EXECUTE for zeus_app only), the same model as delete_booking() in P1-29. Section 8b applies the same
--    pg_temp-last path to the functions earlier migrations created (Codex F1: a temporary type could otherwise run
--    code with the owner's rights).
--  * Each ADMIN function takes the shop lock (746001, 1) first, requires an active ADMIN or MANAGER actor
--    (ZT004), checks the expected revision, and writes its rows and its audit row in one transaction.
--  * The accrual is a trigger on bookings, so every completion path (setBookingStatus, P1-34 finishBooking,
--    a future one) records the same thing. It runs only on the transition into COMPLETED for a QUEUE_V3 booking
--    and is idempotent (the header primary key). If it fails, the completion still commits, a
--    COMMISSION_ACCRUAL_FAILED audit row (SQLSTATE only, no personal data) is written, and
--    admin_commission_repair() redoes the missing records. Emergency switch (owner only):
--      ALTER TABLE bookings DISABLE TRIGGER commission_accrue_on_complete;
--  * A deferred constraint trigger re-verifies, independently of the accrual code (and of commission_split), the canonical
--    allocation: positions 1..n, each share is the equal split of the total (floor(total / n), plus one centavo for the
--    first total mod n positions), each amount is within one centavo of its exact share, and the leftover centavos sit on
--    the largest remainders (Codex F4). It also checks that the shares add up to the
--    total and the amounts add up to the rounded total.
--  * delete_booking() is replaced with the same signature, SECURITY DEFINER, pinned search_path and ACL, plus one
--    more ZD005 test: a booking with commission entries (money) cannot be deleted.
--
-- Error codes the services map: ZT001 not found, ZT002 stale revision, ZT003 target not allowed (not a detailer,
-- or a field that only the operator may change), ZT004 not an admin, ZT005 open jobs, ZT006 invalid input,
-- ZT007 duplicate email, ZT008 acting on yourself, ZC006 invalid commission input, ZC009 inconsistent records.
--
-- Down steps (documented only; Prisma does not run them). Rows already written cannot be un-written.
--   ALTER TABLE bookings DISABLE TRIGGER commission_accrue_on_complete;  (the switch; DROP TRIGGER to remove)
--   DROP TRIGGER commission_accrue_on_complete ON bookings;
--   DROP FUNCTION commission_accrue_on_complete(), commission_accrue(text), commission_consistency_check(text),
--     check_commission_consistency(), guard_commission_entry_change(), guard_commission_accrual_change(),
--     commission_split(bigint, integer[]), admin_assert_actor(text), admin_team_list(text),
--     admin_staff_create(text, text, text, text, integer),
--     admin_staff_update(text, text, text, text, text, text, integer, integer),
--     admin_staff_set_active(text, text, boolean, integer), admin_staff_remove(text, text, integer),
--     admin_commission_default_set(text, integer, integer), admin_commission_paid_set(text, text[], boolean),
--     admin_commission_repair(text), admin_commission_adjust(text, text, text, bigint, text), guard_commission_adjustment_change(),
--     reject_commission_truncate(), commission_earns_on("ServiceKind");
--   restore guard_booking_line_change() from migration 20261018000000_booking_model (section 7b changes one rule in it);
--   restore delete_booking(text, text, integer, text) from migration 20261030000000_delete_booking;
--   DROP TABLE commission_adjustments, commission_entries, commission_accruals, commission_settings, admin_audit_events;
--   DROP TYPE "AdminAuditAction";  ALTER TABLE staff DROP COLUMN "commissionRateBp", DROP COLUMN revision, DROP COLUMN "updatedAt";
--   (the last two only after no commission rows exist; the live code never reads the new objects).

-- 1. Staff
ALTER TABLE "staff" ADD COLUMN "commissionRateBp" INTEGER, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "updatedAt" TIMESTAMPTZ(3);
ALTER TABLE "staff" ADD CONSTRAINT "staff_commission_rate_range" CHECK ("commissionRateBp" IS NULL OR "commissionRateBp" BETWEEN 0 AND 10000);

-- 2. Generic audit trail (insert-only; written only by the functions below)
CREATE TYPE "AdminAuditAction" AS ENUM ('STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_DEACTIVATED', 'STAFF_REACTIVATED', 'STAFF_REMOVED',
  'COMMISSION_DEFAULT_SET', 'COMMISSION_RATE_SET', 'COMMISSION_ACCRUED', 'COMMISSION_ACCRUAL_FAILED', 'COMMISSION_PAID', 'COMMISSION_UNPAID', 'COMMISSION_ADJUSTED');

CREATE TABLE "admin_audit_events" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action" "AdminAuditAction" NOT NULL,
  "actorStaffId" TEXT,
  "targetStaffId" TEXT,
  "targetLabel" TEXT,
  "bookingId" TEXT,
  "entryCount" INTEGER,
  "previousValue" TEXT,
  "newValue" TEXT,
  "reason" TEXT,
  "requestId" TEXT,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);
-- The target staff and booking are plain ids with no foreign key, so the trail can outlive a removed person or
-- a deleted booking (the actor keeps its key: an actor is an ADMIN, and an ADMIN is never removed by the app).
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "admin_audit_events_action_createdAt_idx" ON "admin_audit_events"("action", "createdAt");
CREATE INDEX "admin_audit_events_actorStaffId_createdAt_idx" ON "admin_audit_events"("actorStaffId", "createdAt");

ALTER TABLE "admin_audit_events" ADD CONSTRAINT admin_audit_shape CHECK (COALESCE(
  ("reason" IS NULL OR length("reason") BETWEEN 1 AND 500)
  AND ("requestId" IS NULL OR length("requestId") BETWEEN 1 AND 100)
  AND ("targetLabel" IS NULL OR ("action"::text = 'STAFF_REMOVED' AND length("targetLabel") BETWEEN 1 AND 80))
  AND ("entryCount" IS NULL OR "entryCount" >= 0)
  AND ("previousValue" IS NULL OR length("previousValue") <= 40) AND ("newValue" IS NULL OR length("newValue") <= 40)
  AND CASE "action"::text
    WHEN 'STAFF_CREATED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "targetLabel" IS NULL
    WHEN 'STAFF_UPDATED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "newValue" ~ '^[a-z,]{1,40}$'
    WHEN 'STAFF_DEACTIVATED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL
    WHEN 'STAFF_REACTIVATED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL
    WHEN 'STAFF_REMOVED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "targetLabel" IS NOT NULL AND "newValue" = 'DELETED'
    WHEN 'COMMISSION_DEFAULT_SET' THEN "actorStaffId" IS NOT NULL AND "previousValue" ~ '^[0-9]{1,5}$' AND "newValue" ~ '^[0-9]{1,5}$'
    WHEN 'COMMISSION_RATE_SET' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "previousValue" ~ '^([0-9]{1,5}|DEFAULT)$' AND "newValue" ~ '^([0-9]{1,5}|DEFAULT)$'
    WHEN 'COMMISSION_ACCRUED' THEN "actorStaffId" IS NULL AND "bookingId" IS NOT NULL AND "entryCount" IS NOT NULL
    WHEN 'COMMISSION_ACCRUAL_FAILED' THEN "actorStaffId" IS NULL AND "bookingId" IS NOT NULL AND "reason" ~ '^SQLSTATE [0-9A-Z]{5}$'
    WHEN 'COMMISSION_PAID' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "bookingId" IS NOT NULL AND "newValue" ~ '^-?[0-9]{1,13}$'
    WHEN 'COMMISSION_UNPAID' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "bookingId" IS NOT NULL AND "newValue" ~ '^-?[0-9]{1,13}$'
    WHEN 'COMMISSION_ADJUSTED' THEN "actorStaffId" IS NOT NULL AND "targetStaffId" IS NOT NULL AND "bookingId" IS NOT NULL AND "reason" IS NOT NULL AND "newValue" ~ '^-?[0-9]{1,13}$'
    ELSE false END, false));

-- txId is the inserting transaction and createdAt is stamped by the database, never by a caller.
CREATE FUNCTION guard_admin_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'Admin audit txId must be the inserting transaction'; END IF;
 IF NEW."targetStaffId" IS NOT NULL AND NEW."action"::text <> 'STAFF_REMOVED' AND NOT EXISTS(SELECT 1 FROM public.staff WHERE id = NEW."targetStaffId") THEN
  RAISE EXCEPTION 'Admin audit names an unknown staff member';
 END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_audit_insert BEFORE INSERT ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION guard_admin_audit_insert();
CREATE FUNCTION reject_admin_audit_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Admin audit is append-only'; END $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_change();
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_audit_change();

-- 3. Settings (one row)
CREATE TABLE "commission_settings" (
  "id" SMALLINT NOT NULL,
  "defaultRateBp" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByStaffId" TEXT,
  CONSTRAINT "commission_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_settings_one_row" CHECK ("id" = 1),
  CONSTRAINT "commission_settings_rate_range" CHECK ("defaultRateBp" BETWEEN 0 AND 10000)
);
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "commission_settings" ("id", "defaultRateBp") VALUES (1, 2000);
CREATE FUNCTION guard_commission_settings_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'The commission settings row cannot be deleted'; END $$;
CREATE TRIGGER commission_settings_keep BEFORE DELETE ON commission_settings FOR EACH ROW EXECUTE FUNCTION guard_commission_settings_change();
CREATE TRIGGER commission_settings_no_truncate BEFORE TRUNCATE ON commission_settings FOR EACH STATEMENT EXECUTE FUNCTION guard_commission_settings_change();

-- 4. Accrual headers and entries
CREATE TABLE "commission_accruals" (
  "bookingId" TEXT NOT NULL,
  "serviceTotalCentavos" BIGINT NOT NULL, -- the commission BASE: the price of the lines that earn commission only
  "eligibleLineCount" INTEGER NOT NULL, -- how many active lines earn commission; 0 = nothing in the booking earns (car wash only)
  "unpricedLineCount" INTEGER NOT NULL, -- lines that earn commission and had no price at completion
  "creditedCount" INTEGER NOT NULL,
  "completedOn" DATE NOT NULL,
  "accruedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  CONSTRAINT "commission_accruals_pkey" PRIMARY KEY ("bookingId"),
  CONSTRAINT "commission_accruals_total_range" CHECK ("serviceTotalCentavos" BETWEEN 0 AND 1000000000000),
  CONSTRAINT "commission_accruals_counts" CHECK ("unpricedLineCount" >= 0 AND "eligibleLineCount" >= 0 AND "unpricedLineCount" <= "eligibleLineCount" AND "creditedCount" BETWEEN 0 AND 50 AND ("eligibleLineCount" > 0 OR ("creditedCount" = 0 AND "serviceTotalCentavos" = 0)))
);
ALTER TABLE "commission_accruals" ADD CONSTRAINT "commission_accruals_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "commission_accruals_completedOn_idx" ON "commission_accruals"("completedOn");

CREATE TABLE "commission_entries" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "bookingId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "position" SMALLINT NOT NULL,
  "baseCentavos" BIGINT NOT NULL,
  "rateBp" INTEGER NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "paidByStaffId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_entries_base_range" CHECK ("baseCentavos" BETWEEN 0 AND 1000000000000),
  CONSTRAINT "commission_entries_rate_range" CHECK ("rateBp" BETWEEN 0 AND 10000),
  CONSTRAINT "commission_entries_amount_range" CHECK ("amountCentavos" BETWEEN 0 AND 1000000000000),
  CONSTRAINT "commission_entries_position" CHECK ("position" BETWEEN 1 AND 50),
  CONSTRAINT "commission_entries_paid_pair" CHECK (("paidAt" IS NULL) = ("paidByStaffId" IS NULL))
);
CREATE UNIQUE INDEX "commission_entries_bookingId_staffId_key" ON "commission_entries"("bookingId", "staffId");
CREATE INDEX "commission_entries_staffId_idx" ON "commission_entries"("staffId");
CREATE INDEX "commission_entries_paidAt_idx" ON "commission_entries"("paidAt");
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "commission_accruals"("bookingId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_paidByStaffId_fkey" FOREIGN KEY ("paidByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Entries change only their paid state; they are never deleted.
CREATE FUNCTION guard_commission_entry_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commission entries cannot be deleted'; END IF;
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId" OR NEW."staffId" IS DISTINCT FROM OLD."staffId"
    OR NEW."position" IS DISTINCT FROM OLD."position" OR NEW."baseCentavos" IS DISTINCT FROM OLD."baseCentavos"
    OR NEW."rateBp" IS DISTINCT FROM OLD."rateBp" OR NEW."amountCentavos" IS DISTINCT FROM OLD."amountCentavos"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
  RAISE EXCEPTION 'Commission entries are immutable except for payment';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commission_entry_change BEFORE UPDATE OR DELETE ON commission_entries FOR EACH ROW EXECUTE FUNCTION guard_commission_entry_change();
CREATE FUNCTION reject_commission_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Commission records cannot be truncated'; END $$;
CREATE TRIGGER commission_entry_no_truncate BEFORE TRUNCATE ON commission_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_commission_truncate();

-- Adjustments (LE 2026-11-06, review F1). A completed booking's price is final, and the accrual snapshot never changes.
-- If money must still reach a commission later (for example a coating that had no price when the job was completed), the
-- ADMIN records a signed, whole-centavo adjustment against one person's entry, with a reason. It is a new insert-only row
-- with its own paid state; the entry and the header are untouched. An entry plus its adjustments can never go below zero.
CREATE TABLE "commission_adjustments" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "entryId" TEXT NOT NULL,
  "amountCentavos" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorStaffId" TEXT NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "paidByStaffId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_adjustments_amount" CHECK ("amountCentavos" <> 0 AND "amountCentavos" BETWEEN -1000000000000 AND 1000000000000),
  CONSTRAINT "commission_adjustments_reason" CHECK (length("reason") BETWEEN 1 AND 200),
  CONSTRAINT "commission_adjustments_paid_pair" CHECK (("paidAt" IS NULL) = ("paidByStaffId" IS NULL))
);
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "commission_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_paidByStaffId_fkey" FOREIGN KEY ("paidByStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "commission_adjustments_entryId_idx" ON "commission_adjustments"("entryId");
CREATE INDEX "commission_adjustments_paidAt_idx" ON "commission_adjustments"("paidAt");
CREATE FUNCTION guard_commission_adjustment_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commission adjustments cannot be deleted'; END IF;
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."entryId" IS DISTINCT FROM OLD."entryId" OR NEW."amountCentavos" IS DISTINCT FROM OLD."amountCentavos"
    OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."actorStaffId" IS DISTINCT FROM OLD."actorStaffId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."txId" IS DISTINCT FROM OLD."txId" THEN
  RAISE EXCEPTION 'Commission adjustments are immutable except for payment';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER commission_adjustment_change BEFORE UPDATE OR DELETE ON commission_adjustments FOR EACH ROW EXECUTE FUNCTION guard_commission_adjustment_change();
CREATE TRIGGER commission_adjustment_no_truncate BEFORE TRUNCATE ON commission_adjustments FOR EACH STATEMENT EXECUTE FUNCTION reject_commission_truncate();

-- A header never changes. It can go only with its booking through delete_booking(), and only when no entry exists.
CREATE FUNCTION guard_commission_accrual_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Commission records are immutable'; END IF;
 IF public.booking_delete_authorised(OLD."bookingId") AND NOT EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = OLD."bookingId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Commission records cannot be deleted';
END $$;
CREATE TRIGGER commission_accrual_change BEFORE UPDATE OR DELETE ON commission_accruals FOR EACH ROW EXECUTE FUNCTION guard_commission_accrual_change();
CREATE TRIGGER commission_accrual_no_truncate BEFORE TRUNCATE ON commission_accruals FOR EACH STATEMENT EXECUTE FUNCTION reject_commission_truncate();

-- 5. The rule. One pure function; the accrual and the tests use it. See .team/handoffs/P1-37.md section 4.
--   shares: floor(B/n) each, the first (B mod n) people one centavo more, in the fixed order of the input;
--   num_i = share_i * rate_i (basis points); T = floor((sum num_i + 5000) / 10000), whole centavos, half up;
--   each person gets floor(num_i / 10000); the L = T - sum of floors leftover centavos (0 <= L <= n) go one each to
--   the largest remainders (num_i mod 10000), ties to the earlier position. The amounts add up to exactly T.
CREATE FUNCTION commission_split(p_base bigint, p_rates integer[]) RETURNS TABLE(idx integer, share_centavos bigint, amount_centavos bigint)
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n integer := COALESCE(array_length(p_rates, 1), 0);
BEGIN
 IF n = 0 THEN RETURN; END IF;
 IF p_base IS NULL OR p_base < 0 OR p_base > 1000000000000 OR EXISTS(SELECT 1 FROM unnest(p_rates) r WHERE r IS NULL OR r < 0 OR r > 10000) THEN
  RAISE EXCEPTION 'Invalid commission base or rate' USING ERRCODE = 'ZC006';
 END IF;
 RETURN QUERY
 WITH shares AS (
   SELECT g AS i, (p_base / n + CASE WHEN g <= p_base % n THEN 1 ELSE 0 END)::bigint AS bs, p_rates[g]::bigint AS r
   FROM generate_series(1, n) AS g),
 fr AS (SELECT s.i, s.bs, s.bs * s.r AS num FROM shares s),
 tot AS (SELECT div(sum(f.num) + 5000, 10000)::bigint AS t, sum(f.num / 10000)::bigint AS fl FROM fr f),
 ranked AS (SELECT f.i, f.bs, f.num / 10000 AS fl, row_number() OVER (ORDER BY f.num % 10000 DESC, f.i ASC) AS rk FROM fr f)
 SELECT k.i, k.bs, k.fl + CASE WHEN k.rk <= (SELECT t.t - t.fl FROM tot t) THEN 1 ELSE 0 END
 FROM ranked k ORDER BY k.i;
END $$;
REVOKE ALL ON FUNCTION commission_split(bigint, integer[]) FROM PUBLIC;

-- 6. Consistency check, the accrual, and its trigger
-- Re-verifies one booking's records from the stored rows alone: the entry count matches the header; the shares add up
-- to the total; the amounts add up to the rounded total; each amount is within one centavo of its exact share.
CREATE FUNCTION commission_consistency_check(p_booking text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE h public.commission_accruals; c integer; s_base bigint; s_amt bigint; s_num bigint;
BEGIN
 SELECT * INTO h FROM public.commission_accruals WHERE "bookingId" = p_booking;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = p_booking) THEN RAISE EXCEPTION 'Commission entries without a record' USING ERRCODE = 'ZC009'; END IF;
  RETURN;
 END IF;
 SELECT count(*), COALESCE(sum("baseCentavos"), 0)::bigint, COALESCE(sum("amountCentavos"), 0)::bigint, COALESCE(sum("baseCentavos"::bigint * "rateBp"), 0)::bigint
   INTO c, s_base, s_amt, s_num FROM public.commission_entries WHERE "bookingId" = p_booking;
 IF c <> h."creditedCount" THEN RAISE EXCEPTION 'Commission entry count does not match its record' USING ERRCODE = 'ZC009'; END IF;
 IF c > 0 AND s_base <> h."serviceTotalCentavos" THEN RAISE EXCEPTION 'Commission shares do not add up to the service total' USING ERRCODE = 'ZC009'; END IF;
 IF c > 0 AND s_amt <> div(s_num + 5000, 10000)::bigint THEN RAISE EXCEPTION 'Commission amounts do not add up to the rounded total' USING ERRCODE = 'ZC009'; END IF;
 IF EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = p_booking AND ("amountCentavos" < div("baseCentavos"::bigint * "rateBp", 10000)::bigint OR "amountCentavos" > div("baseCentavos"::bigint * "rateBp", 10000)::bigint + 1)) THEN
  RAISE EXCEPTION 'A commission amount is not within one centavo of its exact share' USING ERRCODE = 'ZC009';
 END IF;
 IF c > 0 THEN
  -- The canonical allocation (Codex F4), written here independently of commission_split so a mistake in one cannot hide in the
  -- other. Positions are exactly 1..c, and each share is the equal split: floor(total / c), plus one centavo for each of the
  -- first (total mod c) positions. Sums alone would accept shares of 100 and 0 for a total of 100 shared by two people.
  IF (SELECT count(DISTINCT "position") FROM public.commission_entries WHERE "bookingId" = p_booking) <> c
     OR EXISTS(SELECT 1 FROM public.commission_entries e WHERE e."bookingId" = p_booking
       AND (e."position" > c OR e."baseCentavos" <> h."serviceTotalCentavos" / c + CASE WHEN e."position" <= h."serviceTotalCentavos" % c THEN 1 ELSE 0 END)) THEN
   RAISE EXCEPTION 'Commission shares are not the equal split of the service total' USING ERRCODE = 'ZC009';
  END IF;
  -- The leftover centavos go to the largest remainders (ties to the earlier position): no person left without the extra
  -- centavo may have a larger remainder than a person who received it. (How many received it follows from the sums above.)
  IF EXISTS(SELECT 1 FROM public.commission_entries x JOIN public.commission_entries y ON y."bookingId" = x."bookingId" AND y."id" <> x."id"
     WHERE x."bookingId" = p_booking
       AND x."amountCentavos" = div(x."baseCentavos"::bigint * x."rateBp", 10000)::bigint + 1
       AND y."amountCentavos" = div(y."baseCentavos"::bigint * y."rateBp", 10000)::bigint
       AND ((y."baseCentavos"::bigint * y."rateBp") % 10000 > (x."baseCentavos"::bigint * x."rateBp") % 10000
         OR ((y."baseCentavos"::bigint * y."rateBp") % 10000 = (x."baseCentavos"::bigint * x."rateBp") % 10000 AND y."position" < x."position"))) THEN
   RAISE EXCEPTION 'Leftover centavos were not given to the largest remainders' USING ERRCODE = 'ZC009';
  END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION commission_consistency_check(text) FROM PUBLIC;

CREATE FUNCTION check_commission_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN PERFORM public.commission_consistency_check(NEW."bookingId"); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION check_commission_consistency() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER commission_entries_consistent AFTER INSERT ON commission_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commission_consistency();
CREATE CONSTRAINT TRIGGER commission_accruals_consistent AFTER INSERT ON commission_accruals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commission_consistency();

-- THE list of what earns commission (LE 2026-11-07). The only place it is written: change it here (a new migration with CREATE OR
-- REPLACE FUNCTION) and the accrual, the repair and the screen all follow. It affects only bookings completed after the change.
CREATE FUNCTION commission_earns_on(p_kind public."ServiceKind") RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p_kind::text IN ('CERAMIC_COATING', 'PAINT_CORRECTION', 'INTERIOR_DETAILING', 'WINDOW_TINT_PPF')
$$;
REVOKE ALL ON FUNCTION commission_earns_on(public."ServiceKind") FROM PUBLIC;

-- Records one completed QUEUE_V3 booking. Reads only database state: the active lines, the assigned workers (the
-- people the Bay board credited), their rates and the default. Returns the number of people credited; 0 when the
-- booking is not eligible, was already recorded, or had nobody assigned (a header with creditedCount 0 is written
-- in that last case, so "nobody credited" is visible).
CREATE FUNCTION commission_accrue(p_booking text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.bookings; total bigint; unpriced integer; eligible integer; default_bp integer; ids text[]; rates integer[]; n integer;
BEGIN
 SELECT * INTO b FROM public.bookings WHERE id = p_booking;
 IF NOT FOUND OR b.status <> 'COMPLETED' OR b."snapshotVersion" <> 'QUEUE_V3' THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM public.commission_accruals WHERE "bookingId" = p_booking) THEN RETURN 0; END IF;
 SELECT "defaultRateBp" INTO default_bp FROM public.commission_settings WHERE id = 1;
 IF default_bp IS NULL THEN RAISE EXCEPTION 'The commission settings row is missing' USING ERRCODE = 'ZC006'; END IF;
 -- The base is the price of the lines that earn commission (commission_earns_on, the one list); the price expression is the one
 -- delete_booking() uses for its audit total. A car wash line adds nothing to the base and is not counted as unpriced.
 SELECT COALESCE(sum(COALESCE(l."staffPriceCentavos", l."subtotalCentavos")) FILTER (WHERE public.commission_earns_on(sv.category)), 0)::bigint,
        count(*) FILTER (WHERE public.commission_earns_on(sv.category) AND l."staffPriceCentavos" IS NULL AND l."subtotalCentavos" IS NULL)::integer,
        count(*) FILTER (WHERE public.commission_earns_on(sv.category))::integer
   INTO total, unpriced, eligible
   FROM public.booking_line_items l JOIN public.services sv ON sv.id = l."serviceId" WHERE l."bookingId" = p_booking AND l."removedAt" IS NULL;
 -- Never clipped (Codex F2): a booking may hold many priced lines, each up to 100,000,000 centavos, so the total is a bigint
 -- and the columns allow up to 1,000,000,000,000 (10 billion pesos). Above that the accrual FAILS visibly (audited,
 -- shown on the screen, repairable) instead of silently paying less.
 IF total > 1000000000000 THEN RAISE EXCEPTION 'The service total is above the supported commission range' USING ERRCODE = 'ZC006'; END IF;
 -- Nothing in the booking earns commission (a car wash only): nobody is credited, whoever was assigned.
 IF eligible > 0 THEN
  SELECT array_agg(w."staffId" ORDER BY w."assignedAt", w."staffId"), array_agg(COALESCE(s."commissionRateBp", default_bp) ORDER BY w."assignedAt", w."staffId")
    INTO ids, rates FROM public.booking_worker_assignments w JOIN public.staff s ON s.id = w."staffId" WHERE w."bookingId" = p_booking;
 END IF;
 n := COALESCE(array_length(ids, 1), 0);
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

-- Fires only on the transition into COMPLETED for a QUEUE_V3 booking (nothing else on bookings reaches it). A failure
-- is caught: the completion still commits, and the failure is audited with the SQLSTATE only.
CREATE FUNCTION commission_accrue_on_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 BEGIN
  PERFORM public.commission_accrue(NEW.id);
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.admin_audit_events (action, "bookingId", "reason") VALUES ('COMMISSION_ACCRUAL_FAILED', NEW.id, 'SQLSTATE ' || SQLSTATE);
 END;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION commission_accrue_on_complete() FROM PUBLIC;
CREATE TRIGGER commission_accrue_on_complete AFTER UPDATE OF status ON bookings FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'COMPLETED' AND NEW.status = 'COMPLETED' AND NEW."snapshotVersion" = 'QUEUE_V3')
  EXECUTE FUNCTION commission_accrue_on_complete();

-- 7. ADMIN functions. Each: shop lock first, an active ADMIN or MANAGER actor, validation, the expected revision, the
-- write and its audit row in one transaction. Only DETAILER people can be changed (ADMIN and MANAGER accounts, their
-- passwords and role changes stay with the operator CLI, ADR-003); an ADMIN or MANAGER row accepts only a rate.
CREATE FUNCTION admin_assert_actor(p_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF p_actor IS NULL OR p_actor = '' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only an admin can do this' USING ERRCODE = 'ZT004';
 END IF;
END $$;
REVOKE ALL ON FUNCTION admin_assert_actor(text) FROM PUBLIC;

CREATE FUNCTION admin_team_list(p_actor text)
RETURNS TABLE(id text, name text, phone text, email text, role text, "isActive" boolean, "commissionRateBp" integer, "hasCredential" boolean, "openJobs" integer, "hasHistory" boolean, revision integer, "createdAt" timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.admin_assert_actor(p_actor);
 RETURN QUERY
 SELECT s.id, s.name, s.phone, s.email, s.role::text, s."isActive", s."commissionRateBp",
   EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id),
   (SELECT count(DISTINCT b.id)::integer FROM public.booking_worker_assignments w JOIN public.bookings b ON b.id = w."bookingId"
     WHERE w."staffId" = s.id AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')),
   -- Advisory only (the screen words its Remove dialog with it). admin_staff_remove() decides by trying the delete.
   (EXISTS(SELECT 1 FROM public.booking_worker_assignments w WHERE w."staffId" = s.id OR w."assignedByStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.commission_entries e WHERE e."staffId" = s.id OR e."paidByStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.booking_audit_events a WHERE a."actorStaffId" = s.id OR a."targetStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.admin_audit_events a WHERE a."actorStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.staff_sessions x WHERE x."staffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id)),
   s.revision, s."createdAt"
 FROM public.staff s ORDER BY s."isActive" DESC, s.role, lower(s.name), s.id;
END $$;

CREATE FUNCTION admin_staff_create(p_actor text, p_name text, p_phone text, p_email text, p_rate_bp integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_id text := gen_random_uuid()::text; v_name text := btrim(COALESCE(p_name, '')); v_phone text := btrim(COALESCE(p_phone, '')); v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]' OR length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$'
    OR (p_rate_bp IS NOT NULL AND p_rate_bp NOT BETWEEN 0 AND 10000)
    OR (v_email <> '' AND (length(v_email) > 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 IF v_email = '' THEN v_email := 'detailer-' || substr(replace(v_id, '-', ''), 1, 8) || '@staff.invalid'; END IF;
 BEGIN
  INSERT INTO public.staff (id, name, phone, email, role, "commissionRateBp", "isActive") VALUES (v_id, v_name, v_phone, v_email, 'DETAILER', p_rate_bp, true);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That email is already used' USING ERRCODE = 'ZT007';
 END;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "newValue") VALUES ('STAFF_CREATED', p_actor, v_id, COALESCE(p_rate_bp::text, 'DEFAULT'));
 RETURN v_id;
END $$;

-- p_rate_mode: KEEP leaves the rate alone, DEFAULT clears it (use the default), SET uses p_rate_bp. A NULL name, phone or
-- email means "leave it". Nothing changed means no write, no revision bump and no audit row.
CREATE FUNCTION admin_staff_update(p_actor text, p_id text, p_name text, p_phone text, p_email text, p_rate_mode text, p_rate_bp integer, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff; v_name text; v_phone text; v_email text; changed text[] := ARRAY[]::text[]; new_rate integer; prev_label text; new_label text;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 OR p_rate_mode IS NULL OR p_rate_mode NOT IN ('KEEP', 'DEFAULT', 'SET')
    OR (p_rate_mode = 'SET' AND (p_rate_bp IS NULL OR p_rate_bp NOT BETWEEN 0 AND 10000)) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 SELECT * INTO s FROM public.staff WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001'; END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = 'ZT002'; END IF;
 IF s.role <> 'DETAILER' AND (p_name IS NOT NULL OR p_phone IS NOT NULL OR p_email IS NOT NULL) THEN
  RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003';
 END IF;
 v_name := s.name; v_phone := s.phone; v_email := s.email;
 IF p_name IS NOT NULL THEN
  v_name := btrim(p_name);
  IF length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
  IF v_name <> s.name THEN changed := array_append(changed, 'name'::text); END IF;
 END IF;
 IF p_phone IS NOT NULL THEN
  v_phone := btrim(p_phone);
  IF length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
  IF v_phone <> s.phone THEN changed := array_append(changed, 'phone'::text); END IF;
 END IF;
 IF p_email IS NOT NULL THEN
  v_email := lower(btrim(p_email));
  IF length(v_email) > 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
  IF v_email <> s.email THEN
   IF EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = p_id) THEN RAISE EXCEPTION 'Only the operator can change the email of a person who can sign in' USING ERRCODE = 'ZT003'; END IF;
   changed := array_append(changed, 'email'::text);
  END IF;
 END IF;
 new_rate := CASE p_rate_mode WHEN 'KEEP' THEN s."commissionRateBp" WHEN 'DEFAULT' THEN NULL ELSE p_rate_bp END;
 IF cardinality(changed) = 0 AND new_rate IS NOT DISTINCT FROM s."commissionRateBp" THEN
  RETURN jsonb_build_object('revision', s.revision, 'changed', false);
 END IF;
 BEGIN
  UPDATE public.staff SET name = v_name, phone = v_phone, email = v_email, "commissionRateBp" = new_rate, revision = s.revision + 1, "updatedAt" = now() WHERE id = p_id;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That email is already used' USING ERRCODE = 'ZT007';
 END;
 IF cardinality(changed) > 0 THEN
  INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "newValue") VALUES ('STAFF_UPDATED', p_actor, p_id, array_to_string(changed, ','));
 END IF;
 IF new_rate IS DISTINCT FROM s."commissionRateBp" THEN
  prev_label := COALESCE(s."commissionRateBp"::text, 'DEFAULT'); new_label := COALESCE(new_rate::text, 'DEFAULT');
  INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "previousValue", "newValue") VALUES ('COMMISSION_RATE_SET', p_actor, p_id, prev_label, new_label);
 END IF;
 RETURN jsonb_build_object('revision', s.revision + 1, 'changed', true);
END $$;

CREATE FUNCTION admin_staff_set_active(p_actor text, p_id text, p_active boolean, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_active IS NULL OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 -- ADR-003: the credential row is the per-staff lock for authentication state, taken before the staff row.
 PERFORM 1 FROM public.staff_credentials WHERE "staffId" = p_id FOR UPDATE;
 SELECT * INTO s FROM public.staff WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001'; END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = 'ZT002'; END IF;
 IF s.role <> 'DETAILER' THEN RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003'; END IF;
 IF s.id = p_actor THEN RAISE EXCEPTION 'You cannot change your own account' USING ERRCODE = 'ZT008'; END IF;
 IF s."isActive" = p_active THEN RETURN jsonb_build_object('revision', s.revision, 'changed', false); END IF;
 IF NOT p_active AND EXISTS(SELECT 1 FROM public.booking_worker_assignments w JOIN public.bookings b ON b.id = w."bookingId" WHERE w."staffId" = p_id AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')) THEN
  RAISE EXCEPTION 'This person still has open jobs' USING ERRCODE = 'ZT005';
 END IF;
 UPDATE public.staff SET "isActive" = p_active, revision = s.revision + 1, "updatedAt" = now() WHERE id = p_id;
 IF NOT p_active THEN
  UPDATE public.staff_sessions SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED' WHERE "staffId" = p_id AND "revokedAt" IS NULL;
 END IF;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId") VALUES (CASE WHEN p_active THEN 'STAFF_REACTIVATED' ELSE 'STAFF_DEACTIVATED' END::public."AdminAuditAction", p_actor, p_id);
 RETURN jsonb_build_object('revision', s.revision + 1, 'changed', true);
END $$;

-- Deletes a person who has no history; otherwise deactivates them. The delete is attempted and a foreign-key
-- or restrict violation means history exists (this stays right for tables added later). Returns DELETED or DEACTIVATED.
CREATE FUNCTION admin_staff_remove(p_actor text, p_id text, p_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff; deleted boolean := false;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 PERFORM 1 FROM public.staff_credentials WHERE "staffId" = p_id FOR UPDATE;
 SELECT * INTO s FROM public.staff WHERE id = p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001'; END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = 'ZT002'; END IF;
 IF s.role <> 'DETAILER' THEN RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003'; END IF;
 IF s.id = p_actor THEN RAISE EXCEPTION 'You cannot change your own account' USING ERRCODE = 'ZT008'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_worker_assignments w JOIN public.bookings b ON b.id = w."bookingId" WHERE w."staffId" = p_id AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')) THEN
  RAISE EXCEPTION 'This person still has open jobs' USING ERRCODE = 'ZT005';
 END IF;
 BEGIN
  DELETE FROM public.staff WHERE id = p_id;
  deleted := true;
 -- A RESTRICT foreign key raises restrict_violation (23001); a plain one raises foreign_key_violation (23503). Either means history.
 EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
  deleted := false;
 END;
 IF deleted THEN
  INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "targetLabel", "newValue") VALUES ('STAFF_REMOVED', p_actor, p_id, left(s.name, 80), 'DELETED');
  RETURN 'DELETED';
 END IF;
 IF s."isActive" THEN
  UPDATE public.staff SET "isActive" = false, revision = s.revision + 1, "updatedAt" = now() WHERE id = p_id;
  UPDATE public.staff_sessions SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED' WHERE "staffId" = p_id AND "revokedAt" IS NULL;
  INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "reason") VALUES ('STAFF_DEACTIVATED', p_actor, p_id, 'Removed: has history');
 END IF;
 RETURN 'DEACTIVATED';
END $$;

CREATE FUNCTION admin_commission_default_set(p_actor text, p_rate_bp integer, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.commission_settings;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_rate_bp IS NULL OR p_rate_bp NOT BETWEEN 0 AND 10000 OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 SELECT * INTO c FROM public.commission_settings WHERE id = 1 FOR UPDATE;
 IF c.revision <> p_revision THEN RAISE EXCEPTION 'Settings changed' USING ERRCODE = 'ZT002'; END IF;
 IF c."defaultRateBp" = p_rate_bp THEN RETURN jsonb_build_object('revision', c.revision, 'changed', false); END IF;
 UPDATE public.commission_settings SET "defaultRateBp" = p_rate_bp, revision = c.revision + 1, "updatedAt" = now(), "updatedByStaffId" = p_actor WHERE id = 1;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "previousValue", "newValue") VALUES ('COMMISSION_DEFAULT_SET', p_actor, c."defaultRateBp"::text, p_rate_bp::text);
 RETURN jsonb_build_object('revision', c.revision + 1, 'changed', true);
END $$;

-- Marks entries paid (or not paid). Unknown ids are counted, not errors; an entry already in the wanted state is left
-- alone. Entries are locked in id order so two callers cannot deadlock. One audit row per entry that changed.
CREATE FUNCTION admin_commission_paid_set(p_actor text, p_ids text[], p_paid boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.commission_entries; a public.commission_adjustments; v_id text; changed integer := 0; unknown integer := 0;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_ids IS NULL OR p_paid IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 200 OR EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE x IS NULL OR x = '') THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 FOR v_id IN SELECT DISTINCT x FROM unnest(p_ids) x ORDER BY x LOOP
  SELECT * INTO e FROM public.commission_entries WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
   -- Not an entry: it may be an adjustment (same rules, same audit actions, the signed amount in newValue).
   SELECT * INTO a FROM public.commission_adjustments WHERE id = v_id FOR UPDATE;
   IF NOT FOUND THEN unknown := unknown + 1; CONTINUE; END IF;
   IF (a."paidAt" IS NOT NULL) = p_paid THEN CONTINUE; END IF;
   IF p_paid THEN
    UPDATE public.commission_adjustments SET "paidAt" = statement_timestamp(), "paidByStaffId" = p_actor WHERE id = v_id;
   ELSE
    UPDATE public.commission_adjustments SET "paidAt" = NULL, "paidByStaffId" = NULL WHERE id = v_id;
   END IF;
   SELECT * INTO e FROM public.commission_entries WHERE id = a."entryId";
   INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "bookingId", "newValue")
    VALUES (CASE WHEN p_paid THEN 'COMMISSION_PAID' ELSE 'COMMISSION_UNPAID' END::public."AdminAuditAction", p_actor, e."staffId", e."bookingId", a."amountCentavos"::text);
   changed := changed + 1;
   CONTINUE;
  END IF;
  IF (e."paidAt" IS NOT NULL) = p_paid THEN CONTINUE; END IF;
  IF p_paid THEN
   UPDATE public.commission_entries SET "paidAt" = statement_timestamp(), "paidByStaffId" = p_actor WHERE id = v_id;
  ELSE
   UPDATE public.commission_entries SET "paidAt" = NULL, "paidByStaffId" = NULL WHERE id = v_id;
  END IF;
  INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "bookingId", "newValue")
   VALUES (CASE WHEN p_paid THEN 'COMMISSION_PAID' ELSE 'COMMISSION_UNPAID' END::public."AdminAuditAction", p_actor, e."staffId", e."bookingId", e."amountCentavos"::text);
  changed := changed + 1;
 END LOOP;
 RETURN jsonb_build_object('changed', changed, 'unknown', unknown);
END $$;

-- Records one adjustment against one entry. ADMIN only, a required reason, a signed whole-centavo amount that is not zero,
-- and the entry plus all its adjustments (including this one) must stay at zero or more. One audit row.
CREATE FUNCTION admin_commission_adjust(p_actor text, p_id text, p_entry text, p_amount bigint, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.commission_entries; x public.commission_adjustments; v_reason text := btrim(p_reason); net bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_entry IS NULL OR p_entry = ''
    OR p_amount IS NULL OR p_amount = 0 OR p_amount NOT BETWEEN -1000000000000 AND 1000000000000
    OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 SELECT * INTO e FROM public.commission_entries WHERE id = p_entry FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commission entry not found' USING ERRCODE = 'ZT001'; END IF;
 -- Idempotent (review R2-2): the browser makes the id. The same id with the same content is a retry after a lost response
 -- and returns the existing row; the same id with different content is refused.
 SELECT * INTO x FROM public.commission_adjustments WHERE id = p_id;
 IF FOUND THEN
  IF x."entryId" = p_entry AND x."amountCentavos" = p_amount AND x.reason = v_reason AND x."actorStaffId" = p_actor THEN
   RETURN jsonb_build_object('id', p_id, 'replayed', true);
  END IF;
  RAISE EXCEPTION 'That adjustment id was already used for something else' USING ERRCODE = 'ZT006';
 END IF;
 SELECT e."amountCentavos" + COALESCE(sum("amountCentavos"), 0)::bigint + p_amount INTO net FROM public.commission_adjustments WHERE "entryId" = p_entry;
 IF net < 0 THEN RAISE EXCEPTION 'An adjustment cannot take a commission below zero' USING ERRCODE = 'ZC006'; END IF;
 INSERT INTO public.commission_adjustments (id, "entryId", "amountCentavos", "reason", "actorStaffId") VALUES (p_id, p_entry, p_amount, v_reason, p_actor);
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "bookingId", "newValue", "reason")
  VALUES ('COMMISSION_ADJUSTED', p_actor, e."staffId", e."bookingId", p_amount::text, v_reason);
 RETURN jsonb_build_object('id', p_id, 'replayed', false);
END $$;

-- Redoes the records of completed bookings that have none (an accrual that failed). Only bookings completed since the
-- commission start are touched, so history before the release is never back-filled. Up to 200 per call; idempotent.
CREATE FUNCTION admin_commission_repair(p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b record; repaired integer := 0; failed integer := 0; starts timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 SELECT "startsAt" INTO starts FROM public.commission_settings WHERE id = 1;
 FOR b IN SELECT bk.id FROM public.bookings bk
   WHERE bk.status = 'COMPLETED' AND bk."snapshotVersion" = 'QUEUE_V3' AND bk."terminalAt" >= starts
     AND NOT EXISTS(SELECT 1 FROM public.commission_accruals a WHERE a."bookingId" = bk.id)
   ORDER BY bk."terminalAt", bk.id LIMIT 200 LOOP
  -- One bad booking must not block the others (review F2): each runs in its own sub-transaction, a failure is audited with
  -- the SQLSTATE only and counted. shortcut: a booking that keeps failing still takes one of the 200 slots per call; if 200
  -- of them ever stack up, fix those first.
  BEGIN
   PERFORM public.commission_accrue(b.id);
   repaired := repaired + 1;
  EXCEPTION WHEN OTHERS THEN
   failed := failed + 1;
   INSERT INTO public.admin_audit_events (action, "actorStaffId", "bookingId", "reason") VALUES ('COMMISSION_ACCRUAL_FAILED', NULL, b.id, 'SQLSTATE ' || SQLSTATE);
  END;
 END LOOP;
 RETURN jsonb_build_object('repaired', repaired, 'failed', failed);
END $$;

-- 7b. Completed bookings take no price change (review F1, part 1). Same function as migration 20261018000000 with one rule
-- changed and pg_temp last; its trigger is unchanged. The application refuses first (BOOKING_NOT_MANAGEABLE); this is the second wall.
CREATE OR REPLACE FUNCTION guard_booking_line_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE st text;
BEGIN
 IF TG_OP = 'DELETE' OR OLD."lineVersion"::text <> 'QUEUE_V3' THEN RAISE EXCEPTION 'Booking line snapshot is append-only'; END IF;
 IF ROW(NEW.id,NEW."bookingId",NEW."order",NEW."releaseId",NEW."serviceId",NEW."vehicleCategoryId",NEW."offerId",NEW.type,NEW."nameSnapshot",NEW.unit,NEW.quantity,NEW."unitPriceCentavos",NEW."subtotalCentavos",NEW."addedMinutes",NEW."lineVersion",NEW."priceStatus",NEW."referenceUnitPriceCentavos",NEW."referenceSubtotalCentavos",NEW."addedAt",NEW."addedByStaffId")
    IS DISTINCT FROM ROW(OLD.id,OLD."bookingId",OLD."order",OLD."releaseId",OLD."serviceId",OLD."vehicleCategoryId",OLD."offerId",OLD.type,OLD."nameSnapshot",OLD.unit,OLD.quantity,OLD."unitPriceCentavos",OLD."subtotalCentavos",OLD."addedMinutes",OLD."lineVersion",OLD."priceStatus",OLD."referenceUnitPriceCentavos",OLD."referenceSubtotalCentavos",OLD."addedAt",OLD."addedByStaffId") THEN
  RAISE EXCEPTION 'Booking line snapshot is immutable';
 END IF;
 IF OLD."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable once removed'; END IF;
 IF OLD."staffPriceCentavos" IS NOT NULL AND NEW."staffPriceCentavos" IS NULL THEN RAISE EXCEPTION 'Booking line snapshot is immutable: a staff price cannot be cleared'; END IF;
 SELECT status INTO st FROM public.bookings WHERE id = OLD."bookingId";
 IF st = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled booking takes no line change'; END IF;
 -- P1-37 (LE 2026-11-06): a completed booking is final, price included. Money that arrives later is recorded as a commission
 -- adjustment, never by editing a line the commission was already counted on.
 IF st = 'COMPLETED' AND ROW(NEW."workStatus", NEW."removedAt", NEW."staffPriceCentavos") IS DISTINCT FROM ROW(OLD."workStatus", OLD."removedAt", OLD."staffPriceCentavos") THEN
  RAISE EXCEPTION 'A completed booking takes no line change';
 END IF;
 -- Codex review F1: who set a price, and when a price or status changed, move only with that
 -- value (so under its role, revision and audit checks). The database stamps the times.
 IF NEW."staffPriceCentavos" IS NOT DISTINCT FROM OLD."staffPriceCentavos" THEN
  IF ROW(NEW."staffPriceSetAt", NEW."staffPriceSetByStaffId") IS DISTINCT FROM ROW(OLD."staffPriceSetAt", OLD."staffPriceSetByStaffId") THEN
   RAISE EXCEPTION 'A line price actor or time changes only with the price';
  END IF;
 ELSE
  NEW."staffPriceSetAt" := CURRENT_TIMESTAMP;
 END IF;
 IF NEW."workStatus" IS NOT DISTINCT FROM OLD."workStatus" THEN
  IF NEW."workStatusChangedAt" IS DISTINCT FROM OLD."workStatusChangedAt" THEN RAISE EXCEPTION 'A line status time changes only with the status'; END IF;
 ELSE
  NEW."workStatusChangedAt" := CURRENT_TIMESTAMP;
 END IF;
 IF OLD."removedAt" IS NULL AND NEW."removedAt" IS NOT NULL THEN NEW."removedAt" := CURRENT_TIMESTAMP; END IF;
 IF NEW."staffPriceCentavos" IS DISTINCT FROM OLD."staffPriceCentavos" AND NOT EXISTS(SELECT 1 FROM public.staff
    WHERE id = NEW."staffPriceSetByStaffId" AND "isActive" AND role IN ('ADMIN', 'MANAGER')) THEN
  RAISE EXCEPTION 'Only ADMIN sets a line price';
 END IF;
 RETURN NEW;
END $$;

-- 8. delete_booking(): the P1-29 function, unchanged except for two lines: a booking with commission entries (money)
-- is refused with the existing ZD005, and a header with no entries is deleted with its booking. Signature, SECURITY
-- DEFINER, pinned search_path, owner and ACL are as before (CREATE OR REPLACE keeps them; they are restated below).
CREATE OR REPLACE FUNCTION delete_booking(p_booking text, p_actor text, p_revision integer, p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE b public.bookings; line_count integer; total bigint;
BEGIN
 -- Every input is required, before any lock or write (a NULL compares as unknown, never as different).
 IF p_booking IS NULL OR p_booking = '' OR p_actor IS NULL OR p_actor = '' OR p_revision IS NULL OR p_revision < 1 OR p_reference IS NULL OR p_reference = '' THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZD006';
 END IF;
 PERFORM pg_advisory_xact_lock(746001, 1);
 IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id = p_actor AND "isActive" AND role IN ('ADMIN','MANAGER')) THEN
  RAISE EXCEPTION 'Only an admin can delete a booking' USING ERRCODE = 'ZD004';
 END IF;
 SELECT * INTO b FROM public.bookings WHERE id = p_booking FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZD001'; END IF;
 IF b.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Booking changed' USING ERRCODE = 'ZD002'; END IF;
 IF b."referenceCode" IS DISTINCT FROM p_reference THEN RAISE EXCEPTION 'Reference code does not match' USING ERRCODE = 'ZD003'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_assignments WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.commission_payouts WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.commission_entries WHERE "bookingId" = p_booking)
    OR EXISTS(SELECT 1 FROM public.inventory_transactions WHERE "bookingId" = p_booking) THEN
  RAISE EXCEPTION 'A payout, assignment or stock record points at this booking' USING ERRCODE = 'ZD005';
 END IF;
 -- The 100,000,000 cap below is only the DISPLAY value of the existing audit column booking_audit_events."newPriceCentavos"
 -- (INTEGER, from P1-29). It is not an accounting figure; commission totals are bigint and never clipped (Codex F2).
 SELECT count(*), LEAST(sum(COALESCE("staffPriceCentavos", "subtotalCentavos")), 100000000) INTO line_count, total
   FROM public.booking_line_items WHERE "bookingId" = p_booking AND "removedAt" IS NULL;
 INSERT INTO public.booking_delete_tokens ("txId", "bookingId") VALUES (txid_current(), p_booking);
 INSERT INTO public.booking_audit_events (id, action, "actorStaffId", "bookingId", "queueCode", "fromStatus", "fromDate", "resultCount", "newPriceCentavos", "bookingReference")
   VALUES (gen_random_uuid()::text, 'BOOKING_DELETED', p_actor, p_booking, b."queueCode", b.status, b."bookingDate", line_count, total::integer, b."referenceCode");
 DELETE FROM public.booking_turnstile_uses WHERE "operationId" IN (SELECT id FROM public.booking_operations WHERE "bookingId" = p_booking);
 DELETE FROM public.booking_operations WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_management_sessions WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_management_grants WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_notification_outbox WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_deposit_proofs WHERE "bookingId" = p_booking;
 DELETE FROM public.bay_occupancies WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_worker_assignments WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_bay_assignments WHERE "bookingId" = p_booking;
 DELETE FROM public.commission_accruals WHERE "bookingId" = p_booking;
 DELETE FROM public.booking_line_items WHERE "bookingId" = p_booking;
 DELETE FROM public.bookings WHERE id = p_booking;
 DELETE FROM public.booking_delete_tokens WHERE "txId" = txid_current() AND "bookingId" = p_booking;
 RETURN jsonb_build_object('reference', b."referenceCode", 'status', b.status::text, 'lines', line_count);
END $$;
REVOKE ALL ON FUNCTION delete_booking(text, text, integer, text) FROM PUBLIC;

-- 8b. Temp-schema hardening of the EXISTING functions (Codex F1). PostgreSQL searches the session's temporary schema FIRST
-- for types and relations unless "pg_temp" is named in the search_path, and zeus_app may create temporary objects. A
-- SECURITY DEFINER function that names an application type or table without a schema (or whose path leaves pg_temp
-- implicit) can therefore be made to run attacker code with the owner's rights. Every function this migration creates
-- puts pg_temp LAST and schema-qualifies what it touches. This block does the same for the functions that earlier
-- migrations created in schema public (and that this role owns, and that no extension owns):
--   * every SECURITY DEFINER function, whatever its current path. The path is read as a list of identifiers (Codex F5): a
--     comma inside a double-quoted schema name is part of the name, not a separator, and a doubled quote inside a quoted name
--     is a quote. Every token keeps its original text byte for byte; only a bare pg_temp token (any case; PostgreSQL always
--     stores it as lowercase pg_temp, and an uppercase "PG_TEMP" in quotes is a different schema that is kept) is removed
--     wherever it stands, and pg_temp is appended last. Everything else is identical, so the function behaves as before. A
--     path that already ends in one pg_temp is not touched at all. A definer with no pinned path gets
--     "pg_catalog, public, pg_temp"; an empty path (stored as "") becomes pg_temp.
--     Nothing aborts: a surprising path is fixed, never a reason to fail a live apply, and each change is reported
--     below as a NOTICE (visible in the migrate output) and in the release check, which lists every definer with its path.
--   * a non-definer function (a trigger function, which runs as the table owner whenever a definer function fires it)
--     only when its path is exactly "pg_catalog, public", the pinned path every earlier migration used: pg_temp is added.
-- Known today: publish_catalog, booking_delete_authorised and delete_booking (definers), plus the trigger functions.
-- Run prisma/sql/p1-37-definer-inventory.sql (one read-only SELECT) before this migration to see exactly what it will touch.
DO $$
DECLARE f record; cfg text; tokens text[]; kept text[]; newtokens text[]; changed integer := 0;
BEGIN
 FOR f IN
  SELECT p.oid::regprocedure AS sig, p.prosecdef, p.proconfig
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proowner = (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user)
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  ORDER BY p.oid::regprocedure::text
 LOOP
  -- The stored value after "search_path=", for example 'pg_catalog, public' or '"qsa,scope", pg_catalog'.
  SELECT substr(c, 13) INTO cfg FROM unnest(COALESCE(f.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%' LIMIT 1;
  -- Identifier-aware tokens: a token is a run of quoted segments (a doubled quote inside is an escaped quote) and any other
  -- characters except a comma or a quote. Whitespace outside quotes is trimmed; nothing inside quotes is touched.
  tokens := ARRAY(SELECT btrim(t.m[1]) FROM regexp_matches(COALESCE(cfg, ''), '((?:"(?:[^"]|"")*"|[^,"])+)', 'g') WITH ORDINALITY AS t(m, n)
                  WHERE btrim(t.m[1]) <> '' ORDER BY t.n);
  newtokens := NULL;
  IF f.prosecdef THEN
   IF cfg IS NULL THEN
    newtokens := ARRAY['pg_catalog', 'public', 'pg_temp'];
   ELSE
    -- Drop only a bare pg_temp (any case) and the empty-path marker "", keep every other token as written, append pg_temp.
    kept := ARRAY(SELECT x FROM unnest(tokens) WITH ORDINALITY u(x, i) WHERE lower(x) <> 'pg_temp' AND x <> '""' ORDER BY i);
    newtokens := array_append(kept, 'pg_temp');
   END IF;
  ELSIF tokens = ARRAY['pg_catalog', 'public'] THEN
   newtokens := ARRAY['pg_catalog', 'public', 'pg_temp'];
  END IF;
  IF newtokens IS NOT NULL AND tokens IS DISTINCT FROM newtokens THEN
   EXECUTE format('ALTER FUNCTION %s SET search_path = %s', f.sig, array_to_string(newtokens, ', '));
   changed := changed + 1;
   RAISE NOTICE 'P1-37 8b: % % search_path "%" -> "%"', CASE WHEN f.prosecdef THEN 'SECURITY DEFINER' ELSE 'function' END, f.sig, COALESCE(cfg, '(none)'), array_to_string(newtokens, ', ');
  END IF;
 END LOOP;
 RAISE NOTICE 'P1-37 8b: % function(s) changed', changed;
END $$;

-- 9. Privileges. No default privileges for the new tables; the runtime role reads the three commission tables and has
-- nothing on admin_audit_events. The functions are executable by zeus_app only (the internal ones by nobody).
REVOKE ALL ON "commission_settings", "commission_accruals", "commission_entries", "commission_adjustments", "admin_audit_events" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_team_list(text), admin_staff_create(text, text, text, text, integer),
  admin_staff_update(text, text, text, text, text, text, integer, integer), admin_staff_set_active(text, text, boolean, integer),
  admin_staff_remove(text, text, integer), admin_commission_default_set(text, integer, integer),
  admin_commission_paid_set(text, text[], boolean), admin_commission_repair(text), admin_commission_adjust(text, text, text, bigint, text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "commission_settings", "commission_accruals", "commission_entries", "commission_adjustments", "admin_audit_events" FROM zeus_app;
 GRANT SELECT ON "commission_settings", "commission_accruals", "commission_entries", "commission_adjustments" TO zeus_app;
 GRANT EXECUTE ON FUNCTION admin_team_list(text), admin_staff_create(text, text, text, text, integer),
  admin_staff_update(text, text, text, text, text, text, integer, integer), admin_staff_set_active(text, text, boolean, integer),
  admin_staff_remove(text, text, integer), admin_commission_default_set(text, integer, integer),
  admin_commission_paid_set(text, text[], boolean), admin_commission_repair(text), admin_commission_adjust(text, text, text, bigint, text) TO zeus_app;
 GRANT EXECUTE ON FUNCTION delete_booking(text, text, integer, text) TO zeus_app;
 -- The pure list of what earns commission; the commission screen calls it to say which lines counted.
 GRANT EXECUTE ON FUNCTION commission_earns_on(public."ServiceKind") TO zeus_app;
END IF; END $$;
COMMIT;
