-- P1-71 M2. 20261112030000_admin_user_get gave the runtime role SELECT on staff.phone, revision, "createdAt" and "removedAt".
-- That breaks the ADR-003 deny list ("SELECT phone FROM staff" must be refused) and P1-64's hidden column. User management reads
-- these through the SECURITY DEFINER functions (admin_user_get, admin_user_list), which need no grant to the role.
-- Release order (CEO D-5): M1, then the P1-71 code (which no longer reads these columns), then this migration. Applied with
-- older code still live, the car-ready email's actor lookup and the password change would fail until the code is deployed.
-- The table-wide SELECT the role never had stays absent; its five readable columns (id, email, name, role, "isActive") stay.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
    REVOKE SELECT (phone, revision, "createdAt", "removedAt") ON public.staff FROM zeus_app;
  END IF;
END $$;
