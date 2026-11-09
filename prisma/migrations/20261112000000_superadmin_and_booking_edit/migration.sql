BEGIN;
-- P1-41b: Super Admin role and booking details editing
-- 1. Add SUPERADMIN to StaffRole if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'StaffRole' AND e.enumlabel = 'SUPERADMIN'
  ) THEN
    ALTER TYPE "StaffRole" ADD VALUE 'SUPERADMIN';
  END IF;
END $$;

-- 2. Designate primary operator account as SUPERADMIN
UPDATE public.staff
SET role = 'SUPERADMIN'
WHERE email = 'zeuscw.mgmt@gmail.com' AND role = 'ADMIN';

-- 3. Update admin_user_list to ONLY return accounts with login access (SUPERADMIN and ADMIN)
CREATE OR REPLACE FUNCTION admin_user_list(p_actor text)
RETURNS TABLE(id text, name text, phone text, email text, role text, "isActive" boolean, "hasCredential" boolean, "passwordChangedAt" timestamptz, revision integer, "createdAt" timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.admin_assert_actor(p_actor);
  RETURN QUERY
    SELECT s.id, s.name, s.phone, s.email, s.role::text, s."isActive",
           (c."staffId" IS NOT NULL) AS "hasCredential",
           c."passwordChangedAt", s.revision, s."createdAt"
    FROM public.staff s
    LEFT JOIN public.staff_credentials c ON c."staffId" = s.id
    WHERE s."removedAt" IS NULL AND s.role IN ('SUPERADMIN', 'ADMIN')
    ORDER BY (CASE WHEN s.role = 'SUPERADMIN' THEN 0 ELSE 1 END), s.name ASC;
END $$;

-- 4. Update admin_user_create to only accept SUPERADMIN or ADMIN
CREATE OR REPLACE FUNCTION admin_user_create(
  p_actor text, p_id text, p_name text, p_phone text, p_email text, p_role text, p_password_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_role public."StaffRole";
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_id IS NULL OR p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]'
     OR length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$'
     OR length(v_email) NOT BETWEEN 3 AND 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR p_role IS NULL OR p_role NOT IN ('SUPERADMIN', 'ADMIN')
     OR p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  v_role := p_role::public."StaffRole";

  IF EXISTS(SELECT 1 FROM public.staff WHERE id = p_id) THEN
    RAISE EXCEPTION 'That id was already used' USING ERRCODE = 'ZT006';
  END IF;

  BEGIN
    INSERT INTO public.staff (id, name, phone, email, role, "isActive", revision, "createdAt")
    VALUES (p_id, v_name, v_phone, v_email, v_role, true, 1, CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That email is already used' USING ERRCODE = 'ZT007';
  END;

  INSERT INTO public.staff_credentials ("staffId", "passwordHash", "generation", "passwordChangedAt", "updatedAt", "createdAt")
  VALUES (p_id, p_password_hash, 1, statement_timestamp(), statement_timestamp(), statement_timestamp());

  INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId", "details")
  VALUES ('USER_CREATED', p_actor, p_id, p_role);

  RETURN jsonb_build_object('id', p_id, 'revision', 1);
END $$;

-- 5. Update admin_user_update with Super Admin protection
CREATE OR REPLACE FUNCTION admin_user_update(
  p_actor text, p_target_id text, p_name text, p_phone text, p_role text, p_is_active boolean, p_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_role public."StaffRole";
  s public.staff;
  actor_staff public.staff;
  v_other_admins integer;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_target_id IS NULL OR p_target_id = ''
     OR length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]'
     OR length(v_phone) > 30 OR v_phone !~ '^[0-9+() -]*$'
     OR p_role IS NULL OR p_role NOT IN ('SUPERADMIN', 'ADMIN')
     OR p_is_active IS NULL OR p_revision IS NULL OR p_revision < 1 THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  v_role := p_role::public."StaffRole";

  SELECT * INTO actor_staff FROM public.staff WHERE id = p_actor;
  SELECT * INTO s FROM public.staff WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND OR s."removedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ZT001';
  END IF;

  IF s.revision <> p_revision THEN
    RAISE EXCEPTION 'User changed by someone else' USING ERRCODE = 'ZT002';
  END IF;

  -- Superadmin protection: non-superadmin cannot edit or deactivate a superadmin
  IF s.role = 'SUPERADMIN' AND actor_staff.role <> 'SUPERADMIN' THEN
    RAISE EXCEPTION 'Only a Super Admin can modify a Super Admin account' USING ERRCODE = 'ZT004';
  END IF;

  -- Superadmin cannot be deactivated
  IF s.role = 'SUPERADMIN' AND NOT p_is_active THEN
    RAISE EXCEPTION 'A Super Admin account cannot be deactivated' USING ERRCODE = 'ZT003';
  END IF;

  -- Self deactivation guard
  IF p_actor = p_target_id AND NOT p_is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = 'ZT008';
  END IF;

  -- Last admin/superadmin guard
  IF s.role IN ('ADMIN', 'SUPERADMIN') AND s."isActive" AND NOT p_is_active THEN
    SELECT count(*) INTO v_other_admins FROM public.staff
    WHERE role IN ('ADMIN', 'SUPERADMIN') AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'Cannot deactivate the last active admin' USING ERRCODE = 'ZT003';
    END IF;
  END IF;

  UPDATE public.staff
  SET name = v_name, phone = v_phone, role = v_role, "isActive" = p_is_active,
      revision = s.revision + 1, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = p_target_id;

  IF NOT p_is_active THEN
    UPDATE public.staff_sessions
    SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED'
    WHERE "staffId" = p_target_id AND "revokedAt" IS NULL;
  END IF;

  INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId", "details")
  VALUES ('USER_UPDATED', p_actor, p_target_id, p_role || ':' || CASE WHEN p_is_active THEN 'active' ELSE 'inactive' END);

  RETURN jsonb_build_object('id', p_target_id, 'revision', s.revision + 1);
END $$;

-- 6. Add admin_booking_update_details for editing booking details
CREATE OR REPLACE FUNCTION admin_booking_update_details(
  p_actor text,
  p_booking_id text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_vehicle_model text,
  p_vehicle_plate text,
  p_notes text,
  p_expected_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  b public.bookings;
  v_name text := btrim(COALESCE(p_customer_name, ''));
  v_phone text := btrim(COALESCE(p_customer_phone, ''));
  v_email text := lower(btrim(COALESCE(p_customer_email, '')));
  v_model text := btrim(COALESCE(p_vehicle_model, ''));
  v_plate text := upper(btrim(COALESCE(p_vehicle_plate, '')));
  v_notes text := btrim(COALESCE(p_notes, ''));
  v_first text;
  v_last text;
  v_space integer;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_booking_id IS NULL OR p_booking_id = ''
     OR length(v_name) NOT BETWEEN 1 AND 80 OR v_name ~ '[[:cntrl:]]'
     OR length(v_phone) NOT BETWEEN 1 AND 30 OR v_phone !~ '^[0-9+() -]*$'
     OR (length(v_email) > 0 AND (length(v_email) > 120 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     OR length(v_model) NOT BETWEEN 1 AND 80 OR v_model ~ '[[:cntrl:]]'
     OR length(v_plate) > 20
     OR length(v_notes) > 1000
     OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'ZT001';
  END IF;

  IF b.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Booking changed by someone else' USING ERRCODE = 'ZT002';
  END IF;

  -- Split full name into first and last
  v_space := position(' ' in v_name);
  IF v_space > 0 THEN
    v_first := substring(v_name from 1 for v_space - 1);
    v_last := substring(v_name from v_space + 1);
  ELSE
    v_first := v_name;
    v_last := NULL;
  END IF;

  UPDATE public.bookings
  SET "customerName" = v_name,
      "customerFirstName" = v_first,
      "customerLastName" = v_last,
      "customerPhone" = v_phone,
      "customerEmail" = CASE WHEN length(v_email) > 0 THEN v_email ELSE NULL END,
      "vehicleModel" = v_model,
      "vehiclePlate" = CASE WHEN length(v_plate) > 0 THEN v_plate ELSE NULL END,
      notes = CASE WHEN length(v_notes) > 0 THEN v_notes ELSE NULL END,
      revision = b.revision + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = p_booking_id;

  INSERT INTO public.booking_audit_events (
    id, action, "actorStaffId", "bookingId", "fromRevision", "toRevision", "fromStatus", "toStatus"
  ) VALUES (
    gen_random_uuid()::text, 'STATUS_CHANGED', p_actor, p_booking_id, b.revision, b.revision + 1, b.status, b.status
  );

  RETURN jsonb_build_object('id', p_booking_id, 'revision', b.revision + 1);
END $$;

-- 7. Grant execution on admin_booking_update_details to zeus_app
REVOKE ALL ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, integer) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_booking_update_details(text, text, text, text, text, text, text, text, integer) TO zeus_app;
  END IF;
END $$;

COMMIT;
