import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { clientKeyDigest } from "./client-identity";
import { withStaffDb } from "./db-admission";
import { appOrigin } from "./http";
import { authEvent } from "./log";
import { STAFF_DB_POLICY, STAFF_LOGIN_POLICY, STAFF_ROLE_TO_USER_ROLE, type StaffRole } from "./policy";
import { createWindowCounter } from "./rate-limit";
import type { StaffSession } from "./types";

type Env = Record<string, string | undefined>;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// 32 random bytes, base64url. The database stores only SHA-256(token) as lowercase hex.
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function isWellFormedSessionToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

// The plain name without Secure exists only for loopback HTTP outside production.
function loopbackDevelopment(env: Env): boolean {
  if (env.NODE_ENV === "production") return false;
  const origin = appOrigin(env);
  if (!origin) return false;
  const { protocol, hostname } = new URL(origin);
  return protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
export function staffSessionCookieName(env: Env = process.env): string {
  return loopbackDevelopment(env) ? "zeus-staff-session" : "__Host-zeus-staff-session";
}
export function sessionCookieAttributes(maxAgeSeconds: number, env: Env = process.env) {
  return { httpOnly: true, secure: !loopbackDevelopment(env), sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

const invalidLookups = createWindowCounter(STAFF_DB_POLICY.STAFF_SESSION.perClientInvalidPerMinute ?? 30, 60_000);

interface SessionRow {
  id: string; staffId: string; name: string; role: StaffRole;
  expiresAt: Date; idleExpiresAt: Date;
  revoked: boolean; expired: boolean; active: boolean; hasCredential: boolean; currentGeneration: boolean; refreshDue: boolean;
}
export interface SessionOptions { db?: PrismaClient; signal?: AbortSignal }

// One indexed query on the database clock, plus the conditional idle refresh, under one
// STAFF_SESSION permit. Null for missing, malformed, unknown, expired, revoked, inactive or
// stale sessions; a database failure or permit refusal throws RETRYABLE_ERROR (503).
export async function resolveStaffSession(token: string | null | undefined, clientKey: string, options: SessionOptions = {}): Promise<StaffSession | null> {
  if (!isWellFormedSessionToken(token)) return null;
  if (invalidLookups.blocked(clientKey)) {
    authEvent("auth.session_rejected", { reason: "RATE_LIMITED", clientKeyDigest: clientKeyDigest(clientKey) });
    return null;
  }
  const tokenHash = hashSessionToken(token);
  const result = await withStaffDb("STAFF_SESSION", async (tx) => {
    const [row] = await tx.$queryRaw<SessionRow[]>`
      SELECT s."id", s."staffId", st."name", st."role"::text AS "role", s."expiresAt", s."idleExpiresAt",
        s."revokedAt" IS NOT NULL AS "revoked",
        (s."expiresAt" <= statement_timestamp() OR s."idleExpiresAt" <= statement_timestamp()) AS "expired",
        st."isActive" AS "active",
        c."staffId" IS NOT NULL AS "hasCredential",
        c."generation" IS NOT DISTINCT FROM s."credentialGeneration" AS "currentGeneration",
        s."lastSeenAt" <= statement_timestamp() - make_interval(mins => ${STAFF_LOGIN_POLICY.idleWriteIntervalMinutes}::int) AS "refreshDue"
      FROM "staff_sessions" s
      JOIN "staff" st ON st."id" = s."staffId"
      LEFT JOIN "staff_credentials" c ON c."staffId" = s."staffId"
      WHERE s."tokenHash" = ${tokenHash}`;
    if (!row) return { reason: "UNKNOWN" as const };
    const reason = row.revoked ? "REVOKED" : row.expired ? "EXPIRED" : !row.active ? "INACTIVE"
      : !row.hasCredential ? "NO_CREDENTIAL" : !row.currentGeneration ? "STALE_GENERATION" : null;
    if (reason) return { reason, staffId: row.staffId };
    if (row.refreshDue) {
      // Conditional: cannot resurrect a session or extend its absolute expiry.
      const [updated] = await tx.$queryRaw<{ idleExpiresAt: Date }[]>`
        UPDATE "staff_sessions" SET "lastSeenAt" = statement_timestamp(),
          "idleExpiresAt" = LEAST(statement_timestamp() + make_interval(mins => ${STAFF_LOGIN_POLICY.idleSessionMinutes}::int), "expiresAt")
        WHERE "id" = ${row.id} AND "revokedAt" IS NULL
          AND "idleExpiresAt" > statement_timestamp() AND "expiresAt" > statement_timestamp()
        RETURNING "idleExpiresAt"`;
      if (!updated) return { reason: "EXPIRED" as const, staffId: row.staffId };
      row.idleExpiresAt = updated.idleExpiresAt;
    }
    return { row };
  }, options);

  if ("reason" in result) {
    if (result.reason === "UNKNOWN") invalidLookups.record(clientKey);
    authEvent("auth.session_rejected", { reason: result.reason, ...(result.staffId ? { staffId: result.staffId } : {}) });
    return null;
  }
  const { row } = result;
  const earliest = row.idleExpiresAt < row.expiresAt ? row.idleExpiresAt : row.expiresAt;
  return {
    subject: row.staffId, role: STAFF_ROLE_TO_USER_ROLE[row.role], staffRole: row.role, displayName: row.name,
    sessionId: row.id, expiresAt: earliest.toISOString(),
    absoluteExpiresAt: row.expiresAt.toISOString(), idleExpiresAt: row.idleExpiresAt.toISOString(),
  };
}

// Logout: idempotent. A missing or unknown token revokes nothing.
export async function revokeStaffSession(token: string | null | undefined, options: SessionOptions = {}): Promise<void> {
  if (!isWellFormedSessionToken(token)) return;
  const tokenHash = hashSessionToken(token);
  const [row] = await withStaffDb("STAFF_SESSION", (tx) => tx.$queryRaw<{ staffId: string }[]>`
    UPDATE "staff_sessions" SET "revokedAt" = statement_timestamp(), "revokedReason" = 'LOGOUT'
    WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL
    RETURNING "staffId"`, options);
  if (row) authEvent("auth.logout", { staffId: row.staffId });
}
