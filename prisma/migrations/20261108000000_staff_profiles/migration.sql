BEGIN;
-- P1-64: staff profiles, and Remove that always works. EXPAND ONLY: one nullable column on staff, one guard trigger on staff, one new table and new
-- functions with NEW names. Nothing is dropped or renamed and no existing function is replaced, so the code live while this runs keeps working.
-- No existing row is written. Release order: this migration with the OLD code live, then prisma/sql/runtime-role.sql, then
-- prisma/sql/p1-64-readonly-check.sql, then the code. NEVER edit this file after it has been applied anywhere.
--
-- What it adds
--  * staff_profiles: one row per person with the details the admin keeps (nickname, position, contact email, home address, birth date, date hired,
--    emergency contact, notes). Separate from staff on purpose: staff.email is the unique login identity, and the app role can read columns of staff.
--    staff.name stays the full name and staff.phone stays the phone. Only the name is required.
--  * staff."removedAt": a removed person with history stays as a hidden row, so every past booking, commission and history keeps the name exactly as it
--    was. There is no list of removed people and no way back: if the person returns they are added again as someone new.
--  * guard_removed_staff: a removed row can never change again, by anything (the older functions and the operator CLI included).
--
-- What Remove does (admin_staff_remove_v2; the service first takes the person off their open jobs in the same transaction, through the board's own
-- revision and audit protocol)
--  * The profile is erased. Then the staff row is deleted if nothing points at it. Any foreign key that refuses (bookings, commissions, supplies, expenses,
--    or any table added later) means history: the row stays hidden with its phone erased and its email replaced by a placeholder. The decision is the
--    database's own, so a new table with a RESTRICT foreign key to staff is covered without a change here.
--  * Commission entries and adjustments are not touched: unpaid commission stays, and can still be marked paid.
--  * Retrying is safe: a person already removed, or already deleted by this function, returns the same answer before the revision is looked at.
--
-- How it is protected
--  * The runtime role (zeus_app) gets NOTHING on staff_profiles and no new column on staff. Every read and write of a profile is a SECURITY DEFINER function
--    owned by the migration owner (search_path pg_catalog, public, pg_temp with pg_temp LAST, every object schema-qualified), EXECUTE for zeus_app only;
--    PUBLIC is revoked HERE, not only in runtime-role.sql. Each function requires an active ADMIN or MANAGER (admin_assert_actor, from P1-37).
--  * The audit reuses P1-37's admin_audit_events with no change to its enum or CHECK: STAFF_UPDATED with newValue 'profile' (the word only, never a
--    value), STAFF_CREATED, STAFF_REMOVED (the name, only for a row really deleted), STAFF_DEACTIVATED with a fixed reason for a hidden row.
--
-- Error codes the service maps: ZT001 not found, ZT002 stale revision, ZT003 not a staff name, ZT004 not an admin, ZT005 open jobs remain, ZT006 invalid
-- input, ZT007 email already used, ZT008 own account (all from P1-37); new: ZT009 the person was removed, ZT010 birth date, ZT011 date hired.
--
-- Down steps (documented only; Prisma does not run them). Erased details cannot be restored; a hidden row stays as it is.
--   DROP FUNCTION admin_team_list_v2(text), admin_staff_create_v2(text, text, text, text, text, integer), admin_staff_profile_get(text, text),
--     admin_staff_profile_set(text, text, integer, text, text, text, text, date, date, text, text, text), admin_staff_remove_v2(text, text, integer);
--   DROP TRIGGER staff_removed_is_final ON staff; DROP FUNCTION guard_removed_staff();
--   DROP TABLE staff_profiles; ALTER TABLE staff DROP CONSTRAINT staff_removed_is_inactive, DROP COLUMN "removedAt";

-- 1. staff: the hidden state
ALTER TABLE "staff" ADD COLUMN "removedAt" TIMESTAMPTZ(3);
ALTER TABLE "staff" ADD CONSTRAINT "staff_removed_is_inactive" CHECK ("removedAt" IS NULL OR NOT "isActive");

CREATE FUNCTION guard_removed_staff() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF OLD."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'This person was removed' USING ERRCODE = 'ZT009'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_removed_is_final BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION guard_removed_staff();

-- 2. Profiles. Date bounds that depend on today live in the function; a table CHECK cannot read the clock.
CREATE TABLE "staff_profiles" (
  "staffId" TEXT NOT NULL,
  "nickname" TEXT,
  "position" TEXT,
  "contactEmail" TEXT,
  "address" TEXT,
  "birthDate" DATE,
  "hiredOn" DATE,
  "emergencyName" TEXT,
  "emergencyPhone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("staffId"),
  CONSTRAINT "staff_profiles_nickname" CHECK ("nickname" IS NULL OR ("nickname" = btrim("nickname") AND length("nickname") BETWEEN 1 AND 40)),
  CONSTRAINT "staff_profiles_position" CHECK ("position" IS NULL OR ("position" = btrim("position") AND length("position") BETWEEN 1 AND 40)),
  CONSTRAINT "staff_profiles_contactEmail" CHECK ("contactEmail" IS NULL OR (length("contactEmail") <= 120 AND "contactEmail" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  CONSTRAINT "staff_profiles_address" CHECK ("address" IS NULL OR ("address" = btrim("address") AND length("address") BETWEEN 1 AND 300)),
  CONSTRAINT "staff_profiles_birthDate" CHECK ("birthDate" IS NULL OR "birthDate" >= DATE '1900-01-01'),
  CONSTRAINT "staff_profiles_hiredOn" CHECK ("hiredOn" IS NULL OR "hiredOn" >= DATE '1990-01-01'),
  CONSTRAINT "staff_profiles_emergencyName" CHECK ("emergencyName" IS NULL OR ("emergencyName" = btrim("emergencyName") AND length("emergencyName") BETWEEN 1 AND 80)),
  CONSTRAINT "staff_profiles_emergencyPhone" CHECK ("emergencyPhone" IS NULL OR (length("emergencyPhone") BETWEEN 1 AND 30 AND "emergencyPhone" ~ '^[0-9+() -]+$')),
  CONSTRAINT "staff_profiles_notes" CHECK ("notes" IS NULL OR ("notes" = btrim("notes") AND length("notes") BETWEEN 1 AND 1000))
);
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. The Team list: staff names only, never the admin or a manager (P1-61, now in the database too), never a removed row.
CREATE FUNCTION admin_team_list_v2(p_actor text)
RETURNS TABLE(id text, name text, phone text, email text, role text, "isActive" boolean, "commissionRateBp" integer, "hasCredential" boolean, "openJobs" integer, "hasHistory" boolean, revision integer, "createdAt" timestamp, nickname text, "position" text, "hiredOn" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.admin_assert_actor(p_actor);
 RETURN QUERY
 SELECT s.id, s.name, s.phone, s.email, s.role::text, s."isActive", s."commissionRateBp",
   EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id),
   (SELECT count(DISTINCT b.id)::integer FROM public.booking_worker_assignments w JOIN public.bookings b ON b.id = w."bookingId"
     WHERE w."staffId" = s.id AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')),
   -- Advisory only. admin_staff_remove_v2() decides by trying the delete.
   (EXISTS(SELECT 1 FROM public.booking_worker_assignments w WHERE w."staffId" = s.id OR w."assignedByStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.commission_entries e WHERE e."staffId" = s.id OR e."paidByStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.booking_audit_events a WHERE a."actorStaffId" = s.id OR a."targetStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.admin_audit_events a WHERE a."actorStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.supply_movements m WHERE m."actorStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.supply_audit_events a WHERE a."actorStaffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.staff_sessions x WHERE x."staffId" = s.id)
    OR EXISTS(SELECT 1 FROM public.staff_credentials c WHERE c."staffId" = s.id)),
   s.revision, s."createdAt", p."nickname", p."position", p."hiredOn"::text
 FROM public.staff s LEFT JOIN public.staff_profiles p ON p."staffId" = s.id
 WHERE s.role = 'DETAILER' AND s."removedAt" IS NULL
 ORDER BY s."isActive" DESC, lower(s.name), s.id;
END $$;

-- 4. Add, with a browser-made id: the same id and the same content returns the person already there, a different content is refused.
CREATE FUNCTION admin_staff_create_v2(p_actor text, p_id text, p_name text, p_phone text, p_email text, p_rate_bp integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_name text := btrim(COALESCE(p_name, '')); v_phone text := btrim(COALESCE(p_phone, '')); v_email text := lower(btrim(COALESCE(p_email, ''))); s public.staff;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]' OR length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$'
    OR (p_rate_bp IS NOT NULL AND p_rate_bp NOT BETWEEN 0 AND 10000)
    OR (v_email <> '' AND (length(v_email) > 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 SELECT * INTO s FROM public.staff WHERE id = p_id;
 IF FOUND THEN
  IF s.role = 'DETAILER' AND s."removedAt" IS NULL AND s.name = v_name AND s.phone = v_phone AND s."commissionRateBp" IS NOT DISTINCT FROM p_rate_bp
     AND (CASE WHEN v_email = '' THEN s.email LIKE '%@staff.invalid' ELSE s.email = v_email END) THEN
   RETURN jsonb_build_object('id', p_id, 'revision', s.revision, 'replayed', true);
  END IF;
  RAISE EXCEPTION 'That id was already used for something else' USING ERRCODE = 'ZT006';
 END IF;
 IF v_email = '' THEN v_email := 'detailer-' || substr(replace(p_id, '-', ''), 1, 8) || '@staff.invalid'; END IF;
 BEGIN
  INSERT INTO public.staff (id, name, phone, email, role, "commissionRateBp", "isActive") VALUES (p_id, v_name, v_phone, v_email, 'DETAILER', p_rate_bp, true);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That email is already used' USING ERRCODE = 'ZT007';
 END;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "newValue") VALUES ('STAFF_CREATED', p_actor, p_id, COALESCE(p_rate_bp::text, 'DEFAULT'));
 RETURN jsonb_build_object('id', p_id, 'revision', 1, 'replayed', false);
END $$;

-- 5. Read one profile. All-null when the person has no details yet.
CREATE FUNCTION admin_staff_profile_get(p_actor text, p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff; p public.staff_profiles;
BEGIN
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 SELECT * INTO s FROM public.staff WHERE id = p_id;
 IF NOT FOUND OR s."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001'; END IF;
 IF s.role <> 'DETAILER' THEN RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003'; END IF;
 SELECT * INTO p FROM public.staff_profiles WHERE "staffId" = p_id;
 RETURN jsonb_build_object('nickname', p."nickname", 'position', p."position", 'contactEmail', p."contactEmail", 'address', p."address", 'birthDate', p."birthDate"::text,
   'hiredOn', p."hiredOn"::text, 'emergencyName', p."emergencyName", 'emergencyPhone', p."emergencyPhone", 'notes', p."notes");
END $$;

-- 6. Set every detail at once ("set these values"): a NULL or blank clears that detail. The person's revision moves only when something changed.
CREATE FUNCTION admin_staff_profile_set(p_actor text, p_id text, p_revision integer, p_nickname text, p_position text, p_email text, p_address text, p_birth date, p_hired date, p_emergency_name text, p_emergency_phone text, p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff; p public.staff_profiles; v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_nickname text := NULLIF(btrim(p_nickname), ''); v_position text := NULLIF(btrim(p_position), ''); v_email text := NULLIF(lower(btrim(p_email)), '');
  v_address text := NULLIF(btrim(p_address), ''); v_ename text := NULLIF(btrim(p_emergency_name), ''); v_ephone text := NULLIF(btrim(p_emergency_phone), ''); v_notes text := NULLIF(btrim(p_notes), '');
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1
    OR length(v_nickname) > 40 OR v_nickname ~ '[[:cntrl:]]' OR length(v_position) > 40 OR v_position ~ '[[:cntrl:]]'
    OR length(v_email) > 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    -- Line breaks are fine in the two long fields; other control characters are not.
    OR length(v_address) > 300 OR v_address ~ '[\x01-\x09\x0b-\x1f\x7f]' OR length(v_notes) > 1000 OR v_notes ~ '[\x01-\x09\x0b-\x1f\x7f]'
    OR length(v_ename) > 80 OR v_ename ~ '[[:cntrl:]]' OR length(v_ephone) > 30 OR v_ephone !~ '^[0-9+() -]+$' THEN
  RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;
 IF p_birth IS NOT NULL AND (p_birth < DATE '1900-01-01' OR p_birth > (v_today - interval '14 years')::date) THEN RAISE EXCEPTION 'Invalid birth date' USING ERRCODE = 'ZT010'; END IF;
 IF p_hired IS NOT NULL AND (p_hired < DATE '1990-01-01' OR p_hired > (v_today + interval '1 year')::date) THEN RAISE EXCEPTION 'Invalid date hired' USING ERRCODE = 'ZT011'; END IF;
 SELECT * INTO s FROM public.staff WHERE id = p_id FOR UPDATE;
 IF NOT FOUND OR s."removedAt" IS NOT NULL THEN RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001'; END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = 'ZT002'; END IF;
 IF s.role <> 'DETAILER' THEN RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003'; END IF;
 SELECT * INTO p FROM public.staff_profiles WHERE "staffId" = p_id;
 IF p."nickname" IS NOT DISTINCT FROM v_nickname AND p."position" IS NOT DISTINCT FROM v_position AND p."contactEmail" IS NOT DISTINCT FROM v_email AND p."address" IS NOT DISTINCT FROM v_address
    AND p."birthDate" IS NOT DISTINCT FROM p_birth AND p."hiredOn" IS NOT DISTINCT FROM p_hired AND p."emergencyName" IS NOT DISTINCT FROM v_ename
    AND p."emergencyPhone" IS NOT DISTINCT FROM v_ephone AND p."notes" IS NOT DISTINCT FROM v_notes THEN
  RETURN jsonb_build_object('revision', s.revision, 'changed', false);
 END IF;
 INSERT INTO public.staff_profiles ("staffId", "nickname", "position", "contactEmail", "address", "birthDate", "hiredOn", "emergencyName", "emergencyPhone", "notes")
  VALUES (p_id, v_nickname, v_position, v_email, v_address, p_birth, p_hired, v_ename, v_ephone, v_notes)
  ON CONFLICT ("staffId") DO UPDATE SET "nickname" = EXCLUDED."nickname", "position" = EXCLUDED."position", "contactEmail" = EXCLUDED."contactEmail", "address" = EXCLUDED."address",
   "birthDate" = EXCLUDED."birthDate", "hiredOn" = EXCLUDED."hiredOn", "emergencyName" = EXCLUDED."emergencyName", "emergencyPhone" = EXCLUDED."emergencyPhone", "notes" = EXCLUDED."notes", "updatedAt" = now();
 UPDATE public.staff SET revision = s.revision + 1, "updatedAt" = now() WHERE id = p_id;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "newValue") VALUES ('STAFF_UPDATED', p_actor, p_id, 'profile');
 RETURN jsonb_build_object('revision', s.revision + 1, 'changed', true);
END $$;

-- 7. Remove. The caller has already taken the person off their open jobs in this transaction; open jobs still here are refused, never left behind.
CREATE FUNCTION admin_staff_remove_v2(p_actor text, p_id text, p_revision integer) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.staff; deleted boolean := false;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);
 PERFORM public.admin_assert_actor(p_actor);
 IF p_id IS NULL OR p_id = '' OR p_revision IS NULL OR p_revision < 1 THEN RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006'; END IF;
 -- ADR-003: the credential row is the per-staff lock for authentication state, taken before the staff row.
 PERFORM 1 FROM public.staff_credentials WHERE "staffId" = p_id FOR UPDATE;
 SELECT * INTO s FROM public.staff WHERE id = p_id FOR UPDATE;
 -- A retry after a lost response gets the same answer, before the revision is looked at: the first call moved it.
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.admin_audit_events a WHERE a."targetStaffId" = p_id AND a.action = 'STAFF_REMOVED') THEN RETURN 'DELETED'; END IF;
  RAISE EXCEPTION 'Person not found' USING ERRCODE = 'ZT001';
 END IF;
 IF s."removedAt" IS NOT NULL THEN RETURN 'REMOVED'; END IF;
 IF s.revision <> p_revision THEN RAISE EXCEPTION 'Person changed' USING ERRCODE = 'ZT002'; END IF;
 IF s.role <> 'DETAILER' THEN RAISE EXCEPTION 'Only the operator can change this account' USING ERRCODE = 'ZT003'; END IF;
 IF s.id = p_actor THEN RAISE EXCEPTION 'You cannot change your own account' USING ERRCODE = 'ZT008'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_worker_assignments w JOIN public.bookings b ON b.id = w."bookingId" WHERE w."staffId" = p_id AND b.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS')) THEN
  RAISE EXCEPTION 'This person still has open jobs' USING ERRCODE = 'ZT005';
 END IF;
 DELETE FROM public.staff_profiles WHERE "staffId" = p_id;
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
 UPDATE public.staff SET phone = '', email = 'removed-' || replace(p_id, '-', '') || '@staff.invalid', "isActive" = false, "removedAt" = now(), revision = s.revision + 1, "updatedAt" = now() WHERE id = p_id;
 UPDATE public.staff_sessions SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED' WHERE "staffId" = p_id AND "revokedAt" IS NULL;
 INSERT INTO public.admin_audit_events (action, "actorStaffId", "targetStaffId", "reason") VALUES ('STAFF_DEACTIVATED', p_actor, p_id, 'Removed: personal details erased');
 RETURN 'REMOVED';
END $$;

-- 8. Privileges. Closed to PUBLIC here (not only in runtime-role.sql): the migration runs first, with the old code live.
REVOKE ALL ON "staff_profiles" FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_team_list_v2(text), admin_staff_create_v2(text, text, text, text, text, integer), admin_staff_profile_get(text, text),
  admin_staff_profile_set(text, text, integer, text, text, text, text, date, date, text, text, text), admin_staff_remove_v2(text, text, integer), guard_removed_staff() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
 REVOKE ALL ON "staff_profiles" FROM zeus_app;
 GRANT EXECUTE ON FUNCTION admin_team_list_v2(text), admin_staff_create_v2(text, text, text, text, text, integer), admin_staff_profile_get(text, text),
  admin_staff_profile_set(text, text, integer, text, text, text, text, date, date, text, text, text), admin_staff_remove_v2(text, text, integer) TO zeus_app;
END IF; END $$;
COMMIT;
