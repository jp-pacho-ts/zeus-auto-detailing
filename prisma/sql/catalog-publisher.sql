-- Owner-run local provisioning only. Existing dedicated non-owner login and active
-- ADMIN/MANAGER actor required. psql -v publisher_role=... -v actor_staff_id=...
-- No role/password creation; no runtime or publisher can write its own mapping.
\set ON_ERROR_STOP on
-- Refuse runtime/owner/privileged identities and non-ADMIN actors before any grant.
SELECT 1 / CASE WHEN :'publisher_role'<>'zeus_app'
 AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=:'publisher_role' AND rolcanlogin)
 AND NOT EXISTS(SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolcreaterole OR p.rolcreatedb OR p.rolreplication OR p.rolbypassrls OR p.rolname=current_user) AND pg_has_role(:'publisher_role',p.oid,'MEMBER'))
 AND EXISTS(SELECT 1 FROM staff WHERE id=:'actor_staff_id' AND "isActive" AND role IN ('ADMIN','MANAGER'))
 THEN 1 ELSE 0 END AS publisher_preflight;
BEGIN;
REVOKE ALL ON catalog_releases,catalog_head,catalog_service_versions,service_size_offers,service_work_plans,catalog_hold_segments,add_on_compatibility,booking_line_items,catalog_publishers,catalog_publication_events FROM :"publisher_role";
GRANT USAGE ON SCHEMA public TO :"publisher_role";
GRANT EXECUTE ON FUNCTION publish_catalog(text,text,text,text) TO :"publisher_role";
INSERT INTO catalog_publishers ("databaseRole","actorStaffId")
SELECT :'publisher_role',id FROM staff WHERE id=:'actor_staff_id' AND "isActive" AND role IN ('ADMIN','MANAGER')
ON CONFLICT ("databaseRole") DO UPDATE SET "actorStaffId"=EXCLUDED."actorStaffId";
COMMIT;