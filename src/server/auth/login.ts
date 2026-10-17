import "server-only";
import { randomUUID } from "node:crypto";
import { clientKeyDigest } from "./client-identity";
import { withStaffDb, type StaffTx } from "./db-admission";
import { StaffAuthError } from "./errors";
import { dummyPasswordHash, hashStaffPassword, needsRehash, verifyStaffPassword } from "./hash";
import { authEvent } from "./log";
import { StaffLoginSchema } from "./password";
import { STAFF_LOGIN_FAILURE_MESSAGE, STAFF_LOGIN_POLICY, STAFF_ROLE_TO_USER_ROLE, type StaffRole } from "./policy";
import { createLoginLimiter } from "./rate-limit";
import { AdmissionRefused, createSemaphore, type Semaphore } from "./semaphore";
import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from "./session";
import { trace } from "./trace";
import type { StaffSession } from "./types";

// POST /api/admin/auth/login, steps 2-9 (ARCHITECTURE T-019; S-01, S-02, D-01).
// The route adapter does step 1 (same-origin and JSON checks) and records startedAt.

export interface LoginContext {
  clientKey: string; // trusted client identity
  carriedToken: string | null; // the request's existing staff cookie, revoked on success
  startedAt: number; // performance.now() at entry
  signal?: AbortSignal;
}
export type LoginOutcome =
  | { ok: true; token: string; session: StaffSession; maxAgeSeconds: number }
  | { ok: false; error: StaffAuthError };

type FailureReason = "UNKNOWN" | "NO_CREDENTIAL" | "INACTIVE" | "LOCKED" | "WRONG_PASSWORD" | "STALE_GENERATION" | "INTEGRITY";

export interface LoginDeps {
  limiter?: ReturnType<typeof createLoginLimiter>;
  hashSlots?: Semaphore;
  failureFloorMs?: number;
  // Test seam: runs after verification, before the activation transaction (T-028 case 1).
  hooks?: { afterVerify?: () => Promise<void> };
}

interface Snapshot {
  staffId: string; isActive: boolean;
  generation: number | null; passwordHash: string | null; locked: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createStaffLogin(deps: LoginDeps = {}) {
  const P = STAFF_LOGIN_POLICY;
  const limiter = deps.limiter ?? createLoginLimiter(P);
  const hashSlots = deps.hashSlots ?? createSemaphore({ maxActive: P.maxConcurrentHashesPerProcess, maxQueued: P.maxQueuedPerProcess, maxWaitMs: P.maxQueueWaitMs });
  const failureFloorMs = deps.failureFloorMs ?? P.failureFloorMs;
  void dummyPasswordHash(); // created once per process, before the first attempt needs it

  return async function loginStaff(input: unknown, ctx: LoginContext): Promise<LoginOutcome> {
    const digest = clientKeyDigest(ctx.clientKey);
    // Step 2: per-client admission before any account lookup; refusals depend only on the client.
    const entry = limiter.enter(ctx.clientKey);
    if (!entry.ok) {
      authEvent("auth.login_refused", { status: 429, clientKeyDigest: digest });
      return { ok: false, error: new StaffAuthError("RATE_LIMITED", undefined, entry.retryAfterSeconds) };
    }
    try {
      // Step 3: input only.
      const parsed = StaffLoginSchema.safeParse(input);
      if (!parsed.success) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
        return { ok: false, error: new StaffAuthError("VALIDATION_ERROR", "Enter your staff email and password.", null, fieldErrors) };
      }
      const { email, password } = parsed.data;

      // Step 4: lockless snapshot under a STAFF_LOGIN_DB permit, released before hashing.
      // A read: a client abort cancels it, and nothing has been verified yet.
      const rows = await withStaffDb("STAFF_LOGIN_DB", (tx) => tx.$queryRaw<Snapshot[]>`
        SELECT s."id" AS "staffId", s."isActive", c."generation", c."passwordHash",
          (c."lockedUntil" IS NOT NULL AND c."lockedUntil" > statement_timestamp()) AS "locked"
        FROM "staff" s LEFT JOIN "staff_credentials" c ON c."staffId" = s."id"
        WHERE lower(s."email") = ${email}
        LIMIT 2`, { signal: ctx.signal, access: "read" });
      const snap = rows.length === 1 ? rows[0] : null;
      const credential = snap && snap.passwordHash !== null && snap.generation !== null
        ? { staffId: snap.staffId, generation: snap.generation, hash: snap.passwordHash } : null;

      // Step 5: exactly one argon2id verification on every admitted attempt.
      let verified = false;
      let rehash: string | null = null;
      let releaseSlot: () => void;
      try { releaseSlot = await hashSlots.acquire(ctx.signal); } catch (error) {
        if (!(error instanceof AdmissionRefused)) throw error;
        authEvent("auth.login_refused", { status: 503, clientKeyDigest: digest });
        return { ok: false, error: new StaffAuthError("RETRYABLE_ERROR") };
      }
      trace("hash:acquire");
      try {
        verified = await verifyStaffPassword(credential?.hash ?? await dummyPasswordHash(), password);
        if (verified && credential && needsRehash(credential.hash)) rehash = await hashStaffPassword(password);
      } finally { releaseSlot(); trace("hash:release"); }
      await deps.hooks?.afterVerify?.();

      // Step 6.
      let reason: FailureReason = rows.length > 1 ? "INTEGRITY" : !snap ? "UNKNOWN" : !credential ? "NO_CREDENTIAL"
        : !snap.isActive ? "INACTIVE" : snap.locked ? "LOCKED" : !verified ? "WRONG_PASSWORD" : "STALE_GENERATION";
      const candidate = rows.length === 1 && credential && snap!.isActive && !snap!.locked && verified;

      // Step 7: activation under the credential-row lock. The signal only bounds its queue
      // wait: an abort before it starts mints nothing; once started, it commits.
      if (candidate) {
        const token = generateSessionToken();
        const activated = await withStaffDb("STAFF_LOGIN_DB", (tx) => activate(tx, credential, rehash, token, ctx.carriedToken), { signal: ctx.signal });
        if ("session" in activated) {
          authEvent("auth.login_succeeded", { staffId: credential.staffId });
          return { ok: true, token, session: activated.session, maxAgeSeconds: activated.maxAgeSeconds };
        }
        reason = activated.reason;
      }

      // Step 8: failure accounting, or the same-shaped no-op for accounts with nothing to count.
      // No signal: a verified guess is always counted, so disconnecting cannot bypass lockout.
      const countable = rows.length === 1 && credential && snap!.isActive;
      const lockedNow = await withStaffDb("STAFF_LOGIN_DB", async (tx) => {
        if (!countable) { await tx.$queryRaw`SELECT statement_timestamp()`; return false; }
        await tx.$queryRaw`SELECT "staffId" FROM "staff_credentials" WHERE "staffId" = ${credential.staffId} FOR UPDATE`;
        // Staff state is re-read after the credential lock (S-01 order), so a deactivation that
        // committed since the snapshot is seen and nothing is counted while inactive (F5).
        const [row] = await tx.$queryRaw<{ lockedUntil: Date | null }[]>`
          UPDATE "staff_credentials" c SET
            "failedLoginCount" = CASE WHEN c."failedLoginCount" + 1 >= ${P.maxConsecutiveFailures}::int THEN 0 ELSE c."failedLoginCount" + 1 END,
            "lockedUntil" = CASE WHEN c."failedLoginCount" + 1 >= ${P.maxConsecutiveFailures}::int
              THEN statement_timestamp() + make_interval(mins => ${P.lockMinutes}::int) ELSE NULL END,
            "updatedAt" = statement_timestamp()
          FROM "staff" s
          WHERE c."staffId" = ${credential.staffId} AND s."id" = c."staffId" AND s."isActive"
            AND (c."lockedUntil" IS NULL OR c."lockedUntil" <= statement_timestamp())
          RETURNING c."lockedUntil"`;
        return Boolean(row?.lockedUntil);
      });
      authEvent("auth.login_failed", { reason, clientKeyDigest: digest });
      if (lockedNow) authEvent("auth.locked", { staffId: credential!.staffId });

      // Step 9: uniform response no earlier than the floor; nothing is held while waiting.
      trace("floor:wait");
      const floorAt = ctx.startedAt + failureFloorMs;
      let remaining = floorAt - performance.now();
      if (remaining <= 0 && failureFloorMs > 0) authEvent("auth.failure_floor_exceeded");
      // Timers run on a millisecond loop clock and can fire slightly early: wait until the floor has passed.
      while (remaining > 0) {
        await sleep(remaining);
        remaining = floorAt - performance.now();
      }
      return { ok: false, error: new StaffAuthError("UNAUTHENTICATED", STAFF_LOGIN_FAILURE_MESSAGE, null) };
    } catch (error) {
      // A database error in steps 4-8 is 503, never a session.
      return { ok: false, error: error instanceof StaffAuthError ? error : new StaffAuthError("RETRYABLE_ERROR") };
    } finally {
      entry.leave();
    }
  };
}

type Activation =
  | { session: StaffSession; maxAgeSeconds: number }
  | { reason: "INACTIVE" | "LOCKED" | "STALE_GENERATION" };

async function activate(tx: StaffTx, credential: { staffId: string; generation: number; hash: string }, rehash: string | null, token: string, carriedToken: string | null): Promise<Activation> {
  const P = STAFF_LOGIN_POLICY;
  // Credential row first (S-01), then the Staff row, so the read sees every earlier holder's commit.
  const [current] = await tx.$queryRaw<{ generation: number; passwordHash: string; locked: boolean }[]>`
    SELECT "generation", "passwordHash", ("lockedUntil" IS NOT NULL AND "lockedUntil" > statement_timestamp()) AS "locked"
    FROM "staff_credentials" WHERE "staffId" = ${credential.staffId} FOR UPDATE`;
  const [staff] = await tx.$queryRaw<{ isActive: boolean; name: string; role: StaffRole }[]>`
    SELECT "isActive", "name", "role"::text AS "role" FROM "staff" WHERE "id" = ${credential.staffId}`;
  if (!current || !staff) return { reason: "STALE_GENERATION" };
  if (!staff.isActive) return { reason: "INACTIVE" };
  if (current.generation !== credential.generation || current.passwordHash !== credential.hash) return { reason: "STALE_GENERATION" };
  if (current.locked) return { reason: "LOCKED" };

  // Rehash is conditional on the verified generation and hash; it never changes the generation.
  await tx.$executeRaw`
    UPDATE "staff_credentials" SET "passwordHash" = COALESCE(${rehash}::text, "passwordHash"),
      "failedLoginCount" = 0, "lockedUntil" = NULL, "updatedAt" = statement_timestamp()
    WHERE "staffId" = ${credential.staffId} AND "generation" = ${credential.generation} AND "passwordHash" = ${credential.hash}`;
  if (isWellFormedSessionToken(carriedToken)) {
    await tx.$executeRaw`
      UPDATE "staff_sessions" SET "revokedAt" = statement_timestamp(), "revokedReason" = 'ROTATED'
      WHERE "tokenHash" = ${hashSessionToken(carriedToken)} AND "revokedAt" IS NULL`;
  }
  const [row] = await tx.$queryRaw<{ id: string; expiresAt: Date; idleExpiresAt: Date; maxAge: number }[]>`
    INSERT INTO "staff_sessions" ("id", "tokenHash", "staffId", "credentialGeneration", "createdAt", "lastSeenAt", "idleExpiresAt", "expiresAt")
    VALUES (${randomUUID()}, ${hashSessionToken(token)}, ${credential.staffId}, ${credential.generation},
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + make_interval(mins => ${P.idleSessionMinutes}::int),
      statement_timestamp() + make_interval(hours => ${P.absoluteSessionHours}::int))
    RETURNING "id", "expiresAt", "idleExpiresAt", EXTRACT(EPOCH FROM "expiresAt" - statement_timestamp())::int AS "maxAge"`;
  return {
    maxAgeSeconds: row.maxAge,
    session: {
      subject: credential.staffId, role: STAFF_ROLE_TO_USER_ROLE[staff.role], staffRole: staff.role,
      displayName: staff.name, sessionId: row.id, expiresAt: row.idleExpiresAt.toISOString(),
      absoluteExpiresAt: row.expiresAt.toISOString(), idleExpiresAt: row.idleExpiresAt.toISOString(),
    },
  };
}

export const loginStaff = createStaffLogin();
