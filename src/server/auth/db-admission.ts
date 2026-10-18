import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { StaffAuthError } from "./errors";
import { authEvent } from "./log";
import { PRISMA_POOL_TIMEOUT_SECONDS, STAFF_DB_POLICY, type StaffDbScope } from "./policy";
import { AdmissionRefused, createSemaphore, type Semaphore } from "./semaphore";
import { checkStaffDbConfiguration } from "./startup";
import { trace } from "./trace";

// Staff database admission (T-037 D-01): every staff statement runs while holding exactly one
// permit of its scope, in one transaction at a time (so one pooled connection) with the scope's
// statement and lock timeouts. The permit is released only after that work settles in the
// database. Never nest calls or fan out queries.
//
// Abort (permit lifecycle; LE decision 2026-10-18 on the P1-06 delta review): an abort before
// a read starts, or while queued, dispatches nothing and holds no permit. An abort during a
// read is bounded by the scope's statement timeout: the read keeps only its own permit until it
// has settled in the database, and its result is discarded, so nothing that depends on it runs.
// Cancelling it early would need a second connection, which D-01 does not budget (one permit
// per request; READ and MUTATION reserved for verified staff). A started write transaction is
// never cancelled: it keeps its permit until it commits, rolls back or times out.
export type StaffTx = Prisma.TransactionClient;
export type StaffDbAccess = "read" | "write";

const permits = Object.fromEntries(
  (Object.keys(STAFF_DB_POLICY) as StaffDbScope[]).map((scope) => {
    const p = STAFF_DB_POLICY[scope];
    return [scope, createSemaphore({ maxActive: p.maxConcurrentPerProcess, maxQueued: p.maxQueuedPerProcess, maxWaitMs: p.maxQueueWaitMs })];
  }),
) as Record<StaffDbScope, Semaphore>;

export function staffDbStats(): Record<StaffDbScope, { active: number; queued: number }> {
  return Object.fromEntries(Object.entries(permits).map(([s, sem]) => [s, sem.stats()])) as Record<StaffDbScope, { active: number; queued: number }>;
}

// Startup (src/instrumentation.ts) refuses a bad pool configuration; this repeats it on first use.
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
// The transactions one permit runs, one after another (for example a read, then the write it decides on).
export interface StaffDbPermit {
  read<T>(work: (tx: StaffTx) => Promise<T>): Promise<T>;
  write<T>(work: (tx: StaffTx) => Promise<T>): Promise<T>;
}

class ReadAborted extends Error {}

export async function withStaffDb<T>(scope: StaffDbScope, work: (tx: StaffTx) => Promise<T>, options: StaffDbOptions & { access?: StaffDbAccess } = {}): Promise<T> {
  return withStaffPermit(scope, (permit) => (options.access === "read" ? permit.read(work) : permit.write(work)), options);
}

export async function withStaffPermit<T>(scope: StaffDbScope, body: (permit: StaffDbPermit) => Promise<T>, options: StaffDbOptions = {}): Promise<T> {
  assertConfigured();
  const policy = STAFF_DB_POLICY[scope];
  const db = options.db ?? prisma;
  const { signal } = options;
  let release: () => void;
  try {
    release = await permits[scope].acquire(signal);
  } catch (error) {
    if (!(error instanceof AdmissionRefused)) throw error;
    authEvent("staff.db_refused", { scope, reason: error.reason });
    throw new StaffAuthError("RETRYABLE_ERROR");
  }
  trace(`db:${scope}:acquire`);

  let live = false;
  let readAborted = false;
  async function transaction<R>(access: StaffDbAccess, work: (tx: StaffTx) => Promise<R>): Promise<R> {
    if (live) throw new Error("A staff permit runs one transaction at a time");
    if (access === "read" && signal?.aborted) { readAborted = true; throw new ReadAborted(); }
    live = true;
    try {
      return await db.$transaction(async (tx) => {
        // set_config(..., true) is SET LOCAL; one SELECT is one round trip (a utility SET is not).
        // Scopes without explicit locks still bound implicit row locks (refresh, logout) by
        // their statement timeout.
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(policy.statementTimeoutMs)}, true),
          set_config('lock_timeout', ${String(policy.lockTimeoutMs ?? policy.statementTimeoutMs)}, true)`;
        if (access === "write" || !signal) return work(tx);
        const onAbort = () => { readAborted = true; };
        if (signal.aborted) { readAborted = true; throw new ReadAborted(); }
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          const result = await work(tx);
          // The caller has gone: nothing that depends on this read may run.
          if (signal.aborted) { readAborted = true; throw new ReadAborted(); }
          return result;
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: PRISMA_POOL_TIMEOUT_SECONDS * 1000,
        timeout: policy.statementTimeoutMs * 4,
      });
    } finally {
      live = false;
    }
  }

  try {
    return await body({ read: (work) => transaction("read", work), write: (work) => transaction("write", work) });
  } catch (error) {
    if (error instanceof StaffAuthError) throw error;
    if (readAborted) {
      authEvent("staff.db_refused", { scope, reason: "ABORTED" });
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2024") {
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
