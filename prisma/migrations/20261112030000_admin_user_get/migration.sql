-- P1-41d: admin_user_get procedure and permissions for user management
CREATE OR REPLACE FUNCTION admin_user_get(p_actor text, p_id text)
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
    WHERE s.id = p_id AND s."removedAt" IS NULL AND s.role IN ('SUPERADMIN', 'ADMIN');
END $$;

REVOKE ALL ON FUNCTION admin_user_get(text, text) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    GRANT EXECUTE ON FUNCTION admin_user_get(text, text) TO zeus_app;
    GRANT SELECT (phone, revision, "createdAt", "removedAt") ON public.staff TO zeus_app;
  END IF;
END $$;
