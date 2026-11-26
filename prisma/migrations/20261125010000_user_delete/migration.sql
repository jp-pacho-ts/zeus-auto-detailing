-- Migration: 20261125010000_user_delete
-- User Management: delete an admin account (LE 2026-11-25: erase it, confirm by typing the email, Super Admin included).
-- An admin account always has append-only audit rows (USER_CREATED at least, RESTRICT foreign keys), so the row
-- itself stays as an anonymous tombstone: name 'Deleted user', email and phone erased, password dropped, every session
-- revoked, hidden everywhere (removedAt). guard_removed_staff() makes the removal final.
-- Errors: ZT001 not found, ZT002 revision, ZT003 last active admin, ZT006 input, ZT008 own account,
-- ZT012 last Super Admin (new), ZT013 typed email does not match the account (new).
--
-- Rollback (manual, owner only):
--   DROP FUNCTION admin_user_delete(text, text, integer, text);
--   ALTER TABLE user_audit_events DROP CONSTRAINT user_audit_events_action_check,
--     ADD CONSTRAINT user_audit_events_action_check CHECK ("action" IN ('USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET_ADMIN', 'PASSWORD_CHANGED_SELF'));
--   (only while no USER_DELETED row exists)

ALTER TABLE "user_audit_events" DROP CONSTRAINT "user_audit_events_action_check";
ALTER TABLE "user_audit_events" ADD CONSTRAINT "user_audit_events_action_check"
  CHECK ("action" IN ('USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET_ADMIN', 'PASSWORD_CHANGED_SELF', 'USER_DELETED'));

CREATE FUNCTION admin_user_delete(p_actor text, p_target_id text, p_revision integer, p_confirm_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  s public.staff;
  v_others integer;
BEGIN
  PERFORM pg_advisory_xact_lock(746001, 1);
  PERFORM public.admin_assert_actor(p_actor);

  IF p_target_id IS NULL OR p_target_id = '' OR p_revision IS NULL OR p_revision < 1 OR p_confirm_email IS NULL THEN
    RAISE EXCEPTION 'Missing or invalid input' USING ERRCODE = 'ZT006';
  END IF;

  -- ADR-003: the credential row is the per-staff lock for authentication state, taken before the staff row.
  PERFORM 1 FROM public.staff_credentials WHERE "staffId" = p_target_id FOR UPDATE;
  SELECT * INTO s FROM public.staff WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND OR s.role NOT IN ('SUPERADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'ZT001';
  END IF;
  -- A retry after a lost response gets the same answer, before the revision and email are looked at: the first call changed both.
  IF s."removedAt" IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_target_id, 'deleted', true);
  END IF;

  IF s.revision <> p_revision THEN
    RAISE EXCEPTION 'User changed by someone else' USING ERRCODE = 'ZT002';
  END IF;
  IF lower(btrim(p_confirm_email)) <> lower(s.email) THEN
    RAISE EXCEPTION 'Typed email does not match the account' USING ERRCODE = 'ZT013';
  END IF;
  IF p_actor = p_target_id THEN
    RAISE EXCEPTION 'You cannot delete your own account' USING ERRCODE = 'ZT008';
  END IF;

  IF s.role = 'SUPERADMIN' THEN
    SELECT count(*) INTO v_others FROM public.staff
    WHERE role = 'SUPERADMIN' AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
    IF v_others = 0 THEN
      RAISE EXCEPTION 'Cannot delete the last Super Admin' USING ERRCODE = 'ZT012';
    END IF;
  END IF;
  IF s."isActive" THEN
    SELECT count(*) INTO v_others FROM public.staff
    WHERE role IN ('ADMIN', 'SUPERADMIN') AND "isActive" AND "removedAt" IS NULL AND id <> p_target_id;
    IF v_others = 0 THEN
      RAISE EXCEPTION 'Cannot delete the last active admin' USING ERRCODE = 'ZT003';
    END IF;
  END IF;

  DELETE FROM public.staff_credentials WHERE "staffId" = p_target_id;
  UPDATE public.staff
  SET name = 'Deleted user', phone = '', email = 'removed-' || replace(p_target_id, '-', '') || '@staff.invalid',
      "isActive" = false, "removedAt" = now(), revision = s.revision + 1, "updatedAt" = now()
  WHERE id = p_target_id;
  UPDATE public.staff_sessions
  SET "revokedAt" = statement_timestamp(), "revokedReason" = 'DEACTIVATED'
  WHERE "staffId" = p_target_id AND "revokedAt" IS NULL;

  INSERT INTO public.user_audit_events ("action", "actorStaffId", "targetStaffId", "details")
  VALUES ('USER_DELETED', p_actor, p_target_id, s.role::text);

  RETURN jsonb_build_object('id', p_target_id, 'deleted', true);
END $$;

REVOKE ALL ON FUNCTION admin_user_delete(text, text, integer, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_user_delete(text, text, integer, text) TO zeus_app;
  END IF;
END $$;
