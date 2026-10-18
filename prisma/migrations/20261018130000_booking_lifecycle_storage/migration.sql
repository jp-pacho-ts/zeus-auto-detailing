-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "managementTokenVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "booking_operations" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" TEXT,
    "requestHash" TEXT,
    "outcome" TEXT NOT NULL,
    "rejectionCode" TEXT,
    "rejectionData" JSONB,
    "resultingRevision" INTEGER,
    "credentialVersion" INTEGER,
    "clientHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ(3),
    "recoveryExpiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_management_grants" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "kid" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "booking_management_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_management_sessions" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "kid" TEXT NOT NULL,
    "grantKid" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "booking_management_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_turnstile_uses" (
    "tokenHash" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_turnstile_uses_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "booking_notification_outbox" (
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_operations_keyHash_key" ON "booking_operations"("keyHash");

-- CreateIndex
CREATE INDEX "booking_operations_bookingId_createdAt_idx" ON "booking_operations"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "booking_operations_kind_outcome_createdAt_idx" ON "booking_operations"("kind", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "booking_operations_clientHash_kind_outcome_createdAt_idx" ON "booking_operations"("clientHash", "kind", "outcome", "createdAt");

-- CreateIndex
CREATE INDEX "booking_management_grants_bookingId_credentialVersion_idx" ON "booking_management_grants"("bookingId", "credentialVersion");

-- CreateIndex
CREATE INDEX "booking_management_sessions_bookingId_expiresAt_idx" ON "booking_management_sessions"("bookingId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_turnstile_uses_operationId_key" ON "booking_turnstile_uses"("operationId");

-- CreateIndex
CREATE INDEX "booking_turnstile_uses_expiresAt_idx" ON "booking_turnstile_uses"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_notification_outbox_bookingId_key" ON "booking_notification_outbox"("bookingId");

-- CreateIndex
CREATE INDEX "booking_notification_outbox_state_nextAttemptAt_idx" ON "booking_notification_outbox"("state", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "booking_operations" ADD CONSTRAINT "booking_operations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_management_grants" ADD CONSTRAINT "booking_management_grants_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_management_sessions" ADD CONSTRAINT "booking_management_sessions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_management_sessions" ADD CONSTRAINT "booking_management_sessions_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "booking_management_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_turnstile_uses" ADD CONSTRAINT "booking_turnstile_uses_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "booking_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_notification_outbox" ADD CONSTRAINT "booking_notification_outbox_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE bookings ADD CONSTRAINT booking_management_version_positive CHECK ("managementTokenVersion">=1);
ALTER TABLE booking_operations ADD CONSTRAINT operation_shape CHECK (
 "keyHash" ~ '^[a-f0-9]{64}$' AND ("requestHash" IS NULL OR "requestHash" ~ '^[a-f0-9]{64}$') AND ("clientHash" IS NULL OR "clientHash" ~ '^[a-f0-9]{64}$')
 AND kind IN ('CREATE','CANCEL','RESCHEDULE') AND outcome IN ('COMMITTED','REJECTED','CLOSED_WITHOUT_COMMIT')
 AND ("resultingRevision" IS NULL OR "resultingRevision">=1) AND ("credentialVersion" IS NULL OR "credentialVersion">=1)
 AND ((outcome='COMMITTED' AND "bookingId" IS NOT NULL AND "requestHash" IS NOT NULL AND "resultingRevision" IS NOT NULL AND "committedAt" IS NOT NULL AND "rejectionCode" IS NULL AND "rejectionData" IS NULL AND (kind<>'CREATE' OR "credentialVersion" IS NOT NULL))
 OR (outcome='REJECTED' AND "requestHash" IS NOT NULL AND "rejectionCode" IS NOT NULL AND "committedAt" IS NULL)
 OR (outcome='CLOSED_WITHOUT_COMMIT' AND "committedAt" IS NULL AND "rejectionCode" IS NULL AND "rejectionData" IS NULL))
 AND "recoveryExpiresAt"="createdAt"+interval '24 hours');
CREATE FUNCTION booking_operation_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."createdAt":=statement_timestamp(); NEW."recoveryExpiresAt":=NEW."createdAt"+interval '24 hours'; IF NEW.outcome='COMMITTED' THEN NEW."committedAt":=NEW."createdAt"; ELSE NEW."committedAt":=NULL; END IF; RETURN NEW; END $$;
CREATE TRIGGER booking_operation_clock BEFORE INSERT ON booking_operations FOR EACH ROW EXECUTE FUNCTION booking_operation_clock();
CREATE FUNCTION booking_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Booking operation receipts are immutable'; END $$;
CREATE TRIGGER booking_operation_immutable BEFORE UPDATE OR DELETE ON booking_operations FOR EACH ROW EXECUTE FUNCTION booking_operation_immutable();
ALTER TABLE booking_management_grants ADD CONSTRAINT grant_shape CHECK ("credentialVersion">=1 AND kid ~ '^[a-z0-9][a-z0-9-]{0,31}$' AND "expiresAt">"issuedAt" AND "expiresAt"<="issuedAt"+interval '30 days');
ALTER TABLE booking_management_sessions ADD CONSTRAINT management_session_shape CHECK ("credentialVersion">=1 AND kid ~ '^[a-z0-9][a-z0-9-]{0,31}$' AND "grantKid" ~ '^[a-z0-9][a-z0-9-]{0,31}$' AND "expiresAt">"issuedAt" AND "expiresAt"<="issuedAt"+interval '24 hours');
CREATE FUNCTION booking_session_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g booking_management_grants;
BEGIN
 -- Revocation remains possible after the parent grant has already been revoked.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'revokedAt') IS NOT DISTINCT FROM (to_jsonb(OLD)-'revokedAt') THEN RETURN NEW; END IF;
 SELECT * INTO g FROM booking_management_grants WHERE id=NEW."grantId";
 IF NOT FOUND OR g."bookingId"<>NEW."bookingId" OR g."credentialVersion"<>NEW."credentialVersion" OR g.kid<>NEW."grantKid" OR g."expiresAt"<NEW."expiresAt" OR g."issuedAt">NEW."issuedAt" OR g."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'Invalid management session provenance'; END IF; RETURN NEW; END $$;
CREATE TRIGGER booking_session_binding BEFORE INSERT OR UPDATE ON booking_management_sessions FOR EACH ROW EXECUTE FUNCTION booking_session_binding();
ALTER TABLE booking_turnstile_uses ADD CONSTRAINT turnstile_shape CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "expiresAt">"createdAt");
ALTER TABLE booking_notification_outbox ADD CONSTRAINT notification_shape CHECK (state IN ('PENDING','SENDING','SENT','FAILED') AND attempts BETWEEN 0 AND 3 AND ((state='SENT')=("sentAt" IS NOT NULL)));
-- Authority is immutable after issuance; revocation is the single allowed transition.
CREATE FUNCTION booking_management_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Management authority is immutable'; END IF;
 IF (to_jsonb(NEW)-'revokedAt') IS DISTINCT FROM (to_jsonb(OLD)-'revokedAt')
    OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN
  RAISE EXCEPTION 'Management authority is immutable except one-way revocation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_management_immutable BEFORE UPDATE OR DELETE ON booking_management_grants FOR EACH ROW EXECUTE FUNCTION booking_management_immutable();
CREATE TRIGGER booking_management_immutable BEFORE UPDATE OR DELETE ON booking_management_sessions FOR EACH ROW EXECUTE FUNCTION booking_management_immutable();

DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zeus_app') THEN
 -- The baseline deliberately provisions no broad runtime role. These are the exact
 -- existing tables needed by public day create/availability and its database guards.
 GRANT SELECT ON bookings,vehicle_categories,services,schedule_configs,time_slots,blocked_dates TO zeus_app;
 GRANT INSERT ON bookings TO zeus_app;
 GRANT SELECT,INSERT ON booking_operations,booking_turnstile_uses TO zeus_app;
 GRANT SELECT,INSERT ON booking_management_grants,booking_management_sessions,booking_notification_outbox TO zeus_app;
 REVOKE UPDATE ON booking_management_grants,booking_management_sessions,booking_notification_outbox FROM zeus_app;
 GRANT UPDATE ("revokedAt") ON booking_management_grants,booking_management_sessions TO zeus_app;
 GRANT UPDATE (state,attempts,"nextAttemptAt","sentAt") ON booking_notification_outbox TO zeus_app;
 REVOKE UPDATE,DELETE ON booking_operations,booking_turnstile_uses FROM zeus_app;
 REVOKE DELETE ON booking_management_grants,booking_management_sessions,booking_notification_outbox FROM zeus_app;
END IF; END $$;

-- LE 2026-10-19, ADR-005 Amendment 3 supersedes P1-02's NULL = full rule.
-- NULL disables the optional limit. Overrides (including zero) still take precedence;
-- every non-CANCELLED QUEUE_V3 visit, including COMPLETED, consumes a configured unit.
CREATE OR REPLACE FUNCTION queue_day_overbooked(p_queue text, p_date date) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(n > COALESCE((SELECT o."dailyCap" FROM public.queue_cap_overrides o WHERE o."queueCode" = p_queue AND o.date = p_date),
                             (SELECT q."dailyCap" FROM public.booking_queues q WHERE q.code = p_queue)), false)
 FROM (SELECT count(*) AS n FROM public.bookings b WHERE b."queueCode" = p_queue AND b."bookingDate" = p_date
       AND b."snapshotVersion"::text = 'QUEUE_V3' AND b.status <> 'CANCELLED') c
$$;
