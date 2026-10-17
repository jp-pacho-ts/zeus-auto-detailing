import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { StaffAuthError } from "./errors";
import { authEvent } from "./log";
import {
  MIN_PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT_SECONDS, STAFF_DB_PERMITS, STAFF_DB_POLICY,
  STAFF_RESERVED_CONNECTIONS, type StaffDbScope,
} from "./policy";
import { AdmissionRefused, createSemaphore, type Semaphore } from "./semaphore";
import { trace } from "./trace";

// Staff database admission (T-037 D-01): every staff statement runs inside one
// withStaffDb call, which holds exactly one permit of its scope and one transaction
// (so one pooled connection) with the scope's statement and lock timeouts. The permit
// is released only after the transaction settles. Never nest calls or fan out queries.
export type StaffTx = Prisma.TransactionClient;

const permits = Object.fromEntries(
  (Object.keys(STAFF_DB_POLICY) as StaffDbScope[]).map((scope) => {
    const p = STAFF_DB_POLICY[scope];
    return [scope, createSemaphore({ maxActive: p.maxConcurrentPerProcess, maxQueued: p.maxQueuedPerProcess, maxWaitMs: p.maxQueueWaitMs })];
  }),
) as Record<StaffDbScope, Semaphore>;

export function staffDbStats(): Record<StaffDbScope, { active: number; queued: number }> {
  return Object.fromEntries(Object.entries(permits).map(([s, sem]) => [s, sem.stats()])) as Record<StaffDbScope, { active: number; queued: number }>;
}

export class StaffDbConfigError extends Error {}

// Pool accounting: 27 customer + 5 staff permits never exceed the pool. Production
// refuses staff work unless the pool settings make that true (no URL in any message).
export function checkStaffDbConfiguration(databaseUrl: string | undefined, nodeEnv: string | undefined): void {
  if (STAFF_DB_PERMITS !== STAFF_RESERVED_CONNECTIONS) throw new StaffDbConfigError("staff permits do not equal the staff reserve");
  if (nodeEnv !== "production") return;
  let params: URLSearchParams;
  try { params = new URL(databaseUrl ?? "").searchParams; } catch { throw new StaffDbConfigError("DATABASE_URL is not a URL"); }
  const limit = params.get("connection_limit"), timeout = params.get("pool_timeout");
  if (!limit || !/^\d+$/.test(limit) || Number(limit) < MIN_PRISMA_CONNECTION_LIMIT) {
    throw new StaffDbConfigError(`DATABASE_URL connection_limit must be an integer of at least ${MIN_PRISMA_CONNECTION_LIMIT}`);
  }
  if (timeout !== String(PRISMA_POOL_TIMEOUT_SECONDS)) {
    throw new StaffDbConfigError(`DATABASE_URL pool_timeout must be ${PRISMA_POOL_TIMEOUT_SECONDS}`);
  }
}

let configChecked: Error | null | undefined;
function assertConfigured(): void {
  if (configChecked === undefined) {
    try { checkStaffDbConfiguration(process.env.DATABASE_URL, process.env.NODE_ENV); configChecked = null; }
    catch (error) {
      configChecked = error as Error;
      authEvent("auth.config_invalid", { reason: configChecked.message });
    }
  }
  if (configChecked) throw new StaffAuthError("RETRYABLE_ERROR");
}

export interface StaffDbOptions { signal?: AbortSignal; db?: PrismaClient }

export async function withStaffDb<T>(scope: StaffDbScope, work: (tx: StaffTx) => Promise<T>, options: StaffDbOptions = {}): Promise<T> {
  assertConfigured();
  const policy = STAFF_DB_POLICY[scope];
  let release: () => void;
  try {
    release = await permits[scope].acquire(options.signal);
  } catch (error) {
    if (!(error instanceof AdmissionRefused)) throw error;
    authEvent("staff.db_refused", { scope, reason: error.reason });
    throw new StaffAuthError("RETRYABLE_ERROR");
  }
  trace(`db:${scope}:acquire`);
  try {
    return await (options.db ?? prisma).$transaction(async (tx) => {
      // set_config(..., true) is SET LOCAL; one SELECT is one round trip (a utility SET is not).
      // Scopes without explicit locks still bound implicit row locks (refresh, logout) by
      // their statement timeout.
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(policy.statementTimeoutMs)}, true),
        set_config('lock_timeout', ${String(policy.lockTimeoutMs ?? policy.statementTimeoutMs)}, true)`;
      return work(tx);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: PRISMA_POOL_TIMEOUT_SECONDS * 1000,
      timeout: policy.statementTimeoutMs * 4,
    });
  } catch (error) {
    if (error instanceof StaffAuthError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2024") {
      authEvent("db.pool_wait_violation", { scope }); // a statement bypassed its permit
    } else {
      // Codes only (e.g. P2028, or SQLSTATE 57014 statement / 55P03 lock timeout); messages can carry values.
      const known = error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
      const sqlState = typeof known?.meta?.code === "string" ? `:${known.meta.code}` : "";
      authEvent("staff.db_refused", { scope, reason: known ? `${known.code}${sqlState}` : "ERROR" });
    }
    throw new StaffAuthError("RETRYABLE_ERROR");
  } finally {
    release();
    trace(`db:${scope}:release`);
  }
}
