BEGIN;
-- P1-41: User management and password change. EXPAND ONLY: new audit table and stored procedures.
-- No existing tables are modified or columns dropped.
--
-- What it adds:
--  * user_audit_events: insert-only audit trail for user account lifecycle (create, update, reset password, change password).
--  * admin_user_list(p_actor text): list all non-removed staff accounts and their credential statuses.
--  * admin_user_create(p_actor, p_id, p_name, p_phone, p_email, p_role, p_password_hash): creates staff & credential atomically.
--  * admin_user_update(p_actor, p_target_id, p_name, p_phone, p_role, p_is_active, p_revision): updates user, guards last admin and self-deactivation, revokes sessions if deactivated.
--  * admin_user_reset_password(p_actor, p_target_id, p_password_hash): sets new password, increments generation, revokes target sessions.
--  * auth_user_change_password(p_actor, p_password_hash, p_keep_token_hash): user changes own password, updates generation, revokes other sessions while keeping current session active.

-- 1. Audit table
CREATE TABLE "user_audit_events" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "action" TEXT NOT NULL,
  "actorStaffId" TEXT NOT NULL,
  "targetStaffId" TEXT NOT NULL,
  "details" TEXT,
  "txId" BIGINT NOT NULL DEFAULT txid_current(),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_audit_events_action_check" CHECK ("action" IN ('USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET_ADMIN', 'PASSWORD_CHANGED_SELF'))
);

ALTER TABLE "user_audit_events" ADD CONSTRAINT "user_audit_events_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_audit_events" ADD CONSTRAINT "user_audit_events_targetStaffId_fkey" FOREIGN KEY ("targetStaffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "user_audit_events_createdAt_idx" ON "user_audit_events"("createdAt");
CREATE INDEX "user_audit_events_targetStaffId_idx" ON "user_audit_events"("targetStaffId");

CREATE FUNCTION guard_user_audit_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."txId" IS DISTINCT FROM txid_current() THEN RAISE EXCEPTION 'User audit txId must be the inserting transaction'; END IF;
 NEW."createdAt" := CURRENT_TIMESTAMP;
 RETURN NEW;
END $$;
CREATE TRIGGER user_audit_insert BEFORE INSERT ON user_audit_events FOR EACH ROW EXECUTE FUNCTION guard_user_audit_insert();
CREATE FUNCTION reject_user_audit_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'User audit is append-only'; END $$;
CREATE TRIGGER user_audit_immutable BEFORE UPDATE OR DELETE ON user_audit_events FOR EACH ROW EXECUTE FUNCTION reject_user_audit_change();
CREATE TRIGGER user_audit_no_truncate BEFORE TRUNCATE ON user_audit_events FOR EACH STATEMENT EXECUTE FUNCTION reject_user_audit_change();

-- 2. admin_user_list
CREATE FUNCTION admin_user_list(p_actor text)
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
   WHERE s."removedAt" IS NULL
   ORDER BY s.name ASC;
END $$;

-- 3. admin_user_create
CREATE FUNCTION admin_user_create(
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
    OR p_role IS NULL OR p_role NOT IN ('ADMIN', 'STAFF', 'DETAILER')
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

-- 4. admin_user_update
CREATE FUNCTION admin_user_update(
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
    OR p_role IS NULL OR p_role NOT IN ('ADMIN', 'STAFF', 'DETAILER')
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

 -- Last admin guard: if target is active ADMIN and is being demoted or deactivated
 IF s.role = 'ADMIN' AND s."isActive" AND (v_role <> 'ADMIN' OR NOT p_is_active) THEN
   SELECT count(*) INTO v_other_admins FROM public.staff
   WHERE role = 'ADMIN' AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
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

-- 5. admin_user_reset_password
CREATE FUNCTION admin_user_reset_password(
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
 SET "revokedAt" = statement_timestamp(), "revokedReason" = 'PASSWORD_RESET'
 WHERE "staffId" = p_target_id AND "revokedAt" IS NULL;

 INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId")
 VALUES ('PASSWORD_RESET_ADMIN', p_actor, p_target_id);

 RETURN jsonb_build_object('ok', true);
END $$;

-- 6. auth_user_change_password
CREATE FUNCTION auth_user_change_password(
  p_actor text, p_password_hash text, p_keep_token_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 s public.staff;
 v_new_gen integer;
BEGIN
 PERFORM pg_advisory_xact_lock(746001, 1);

 IF p_actor IS NULL OR p_actor = ''
    OR p_password_hash IS NULL OR length(p_password_hash) < 20
    OR p_keep_token_hash IS NULL OR p_keep_token_hash = '' THEN
   RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
 END IF;

 SELECT * INTO s FROM public.staff WHERE id = p_actor AND "isActive" AND "removedAt" IS NULL FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'User not found or inactive' USING ERRCODE = 'ZT001';
 END IF;

 UPDATE public.staff_credentials
 SET "passwordHash" = p_password_hash,
     "generation" = generation + 1,
     "passwordChangedAt" = statement_timestamp(),
     "failedLoginCount" = 0,
     "lockedUntil" = NULL,
     "updatedAt" = statement_timestamp()
 WHERE "staffId" = p_actor
 RETURNING generation INTO v_new_gen;

 IF v_new_gen IS NULL THEN
   RAISE EXCEPTION 'No credential found' USING ERRCODE = 'ZT001';
 END IF;

 -- Revoke all OTHER sessions
 UPDATE public.staff_sessions
 SET "revokedAt" = statement_timestamp(), "revokedReason" = 'PASSWORD_CHANGED'
 WHERE "staffId" = p_actor AND "revokedAt" IS NULL AND "tokenHash" <> p_keep_token_hash;

 -- Bump the credentialGeneration on the current session so it stays valid
 UPDATE public.staff_sessions
 SET "credentialGeneration" = v_new_gen, "lastSeenAt" = statement_timestamp()
 WHERE "staffId" = p_actor AND "tokenHash" = p_keep_token_hash AND "revokedAt" IS NULL;

 INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId")
 VALUES ('PASSWORD_CHANGED_SELF', p_actor, p_actor);

 RETURN jsonb_build_object('ok', true, 'newGeneration', v_new_gen);
END $$;

-- 7. Revoke from PUBLIC and grant to zeus_app
REVOKE ALL ON FUNCTION admin_user_list(text),
  admin_user_create(text, text, text, text, text, text, text),
  admin_user_update(text, text, text, text, text, boolean, integer),
  admin_user_reset_password(text, text, text),
  auth_user_change_password(text, text, text) FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
   GRANT EXECUTE ON FUNCTION admin_user_list(text),
     admin_user_create(text, text, text, text, text, text, text),
     admin_user_update(text, text, text, text, text, boolean, integer),
     admin_user_reset_password(text, text, text),
     auth_user_change_password(text, text, text) TO zeus_app;
 END IF;
END $$;

COMMIT;
