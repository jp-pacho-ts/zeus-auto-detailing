-- P1-06 (ADR-003 Option A): additive staff credentials and sessions. No existing table changes.
-- CreateTable
CREATE TABLE "staff_credentials" (
    "staffId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_credentials_pkey" PRIMARY KEY ("staffId")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "credentialGeneration" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_tokenHash_key" ON "staff_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "staff_sessions_staffId_idx" ON "staff_sessions"("staffId");

-- CreateIndex
CREATE INDEX "staff_sessions_expiresAt_idx" ON "staff_sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity checks (Prisma does not model CHECK constraints).
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_counters_check"
  CHECK ("generation" >= 1 AND "failedLoginCount" >= 0);
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_revocation_check"
  CHECK (("revokedAt" IS NULL AND "revokedReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokedReason" IN ('LOGOUT', 'PASSWORD_CHANGED', 'DEACTIVATED', 'ADMIN_REVOKED', 'ROTATED')));
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_lifetime_check"
  CHECK ("credentialGeneration" >= 1 AND "idleExpiresAt" <= "expiresAt" AND "createdAt" < "expiresAt");
