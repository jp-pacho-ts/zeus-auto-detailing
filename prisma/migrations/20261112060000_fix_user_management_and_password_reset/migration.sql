-- Migration: 20261112060000_fix_user_management_and_password_reset
-- 1. Fix admin_user_reset_password to use 'ADMIN_REVOKED' (matching staff_sessions_revocation_check)
-- 2. Fix admin_user_create to validate role IN ('SUPERADMIN', 'ADMIN')
-- 3. Fix admin_user_update to validate role IN ('SUPERADMIN', 'ADMIN') and allow promoting/demoting between ADMIN and SUPERADMIN
-- 4. Fix admin_user_list to only list accounts with role IN ('SUPERADMIN', 'ADMIN')

-- 1. admin_user_reset_password
CREATE OR REPLACE FUNCTION admin_user_reset_password(
  p_actor text, p_target_id text, p_password_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  s public.staff;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_target_id IS NULL OR p_target_id = ''
     OR p_password_hash IS NULL OR length(p_password_hash) < 20 THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  SELECT * INTO s FROM public.staff WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND OR s."removedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ZT001';
  END IF;

  INSERT INTO public.staff_credentials ("staffId", "passwordHash", "generation", "passwordChangedAt", "updatedAt", "createdAt")
  VALUES (p_target_id, p_password_hash, 1, statement_timestamp(), statement_timestamp(), statement_timestamp())
  ON CONFLICT ("staffId") DO UPDATE
    SET "passwordHash" = p_password_hash,
        "generation" = public.staff_credentials.generation + 1,
        "passwordChangedAt" = statement_timestamp(),
        "failedLoginCount" = 0,
        "lockedUntil" = NULL,
        "updatedAt" = statement_timestamp();

  UPDATE public.staff_sessions
  SET "revokedAt" = statement_timestamp(), "revokedReason" = 'ADMIN_REVOKED'
  WHERE "staffId" = p_target_id AND "revokedAt" IS NULL;

  INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId")
  VALUES ('PASSWORD_RESET_ADMIN', p_actor, p_target_id);

  RETURN jsonb_build_object('ok', true);
END $$;

-- 2. admin_user_create
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

-- 3. admin_user_update
CREATE OR REPLACE FUNCTION admin_user_update(
  p_actor text, p_target_id text, p_name text, p_phone text, p_role text, p_is_active boolean, p_revision integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_phone text := btrim(COALESCE(p_phone, ''));
  v_role public."StaffRole";
  s public.staff;
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

  SELECT * INTO s FROM public.staff WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND OR s."removedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ZT001';
  END IF;

  IF s.revision <> p_revision THEN
    RAISE EXCEPTION 'User changed by someone else' USING ERRCODE = 'ZT002';
  END IF;

  -- Self deactivation guard
  IF p_actor = p_target_id AND NOT p_is_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own account' USING ERRCODE = 'ZT008';
  END IF;

  -- Last admin guard: if target is active admin/superadmin and is being demoted to non-admin or deactivated
  IF s.role IN ('ADMIN', 'SUPERADMIN') AND s."isActive" AND (v_role NOT IN ('ADMIN', 'SUPERADMIN') OR NOT p_is_active) THEN
    SELECT count(*) INTO v_other_admins FROM public.staff
    WHERE role IN ('ADMIN', 'SUPERADMIN') AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'Cannot deactivate or demote the last active admin' USING ERRCODE = 'ZT003';
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

CREATE OR REPLACE FUNCTION admin_user_update(
  p_actor text, p_target_id text, p_name text, p_phone text, p_role text, p_is_active boolean, p_revision bigint
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT admin_user_update(p_actor, p_target_id, p_name, p_phone, p_role, p_is_active, p_revision::integer);
$$;

-- 4. admin_user_list
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
    ORDER BY s.name ASC;
END $$;

-- 5. Revoke from PUBLIC and grant to zeus_app
REVOKE ALL ON FUNCTION admin_user_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_create(text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_update(text, text, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_update(text, text, text, text, text, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_user_reset_password(text, text, text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_user_list(text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_user_create(text, text, text, text, text, text, text) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_user_update(text, text, text, text, text, boolean, integer) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_user_update(text, text, text, text, text, boolean, bigint) TO zeus_app;
    GRANT EXECUTE ON FUNCTION admin_user_reset_password(text, text, text) TO zeus_app;
  END IF;
END $$;
