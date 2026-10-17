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
// Abort (permit lifecycle): an abort while queued leaves the queue without a permit. An abort
// during a read transaction cancels its statement in the database (pg_cancel_backend), and the
// permit is held until the read has settled. A started write transaction is never cancelled:
// it keeps its permit until it commits, rolls back or times out.
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

// Identifies the read's transaction, so the cancel can never reach a later one on that connection.
interface Backend { pid: number; startedUs: string }

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

  const cancellations: Promise<void>[] = [];
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
        const [backend] = await tx.$queryRaw<Backend[]>`SELECT set_config('statement_timeout', ${String(policy.statementTimeoutMs)}, true),
          set_config('lock_timeout', ${String(policy.lockTimeoutMs ?? policy.statementTimeoutMs)}, true),
          pg_backend_pid() AS "pid", (extract(epoch FROM now()) * 1000000)::bigint::text AS "startedUs"`;
        if (access === "write" || !signal) return work(tx);
        const onAbort = () => { readAborted = true; cancellations.push(cancelRead(db, scope, backend)); };
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
    await Promise.allSettled(cancellations);
    release();
    trace(`db:${scope}:release`);
  }
}

// The cancelling statement needs a pooled connection, so it holds a free staff permit (of any
// scope) while it runs. With none free, the read runs to its statement timeout instead and the
// accounting stays exact. It matches the read's backend and transaction start, and only while a
// statement is active, so it cannot cancel that connection's next transaction.
const CANCEL_PERMIT_ORDER: StaffDbScope[] = ["STAFF_READ", "STAFF_SESSION", "STAFF_MUTATION", "STAFF_LOGIN_DB"];
async function cancelRead(db: PrismaClient, scope: StaffDbScope, backend: Backend): Promise<void> {
  let release: (() => void) | null = null;
  for (const candidate of CANCEL_PERMIT_ORDER) {
    release = permits[candidate].tryAcquire();
    if (release) break;
  }
  if (!release) { authEvent("staff.db_refused", { scope, reason: "CANCEL_DEFERRED" }); return; }
  trace("db:cancel");
  try {
    await db.$queryRaw`SELECT pg_cancel_backend("pid") FROM pg_stat_activity
      WHERE "pid" = ${backend.pid}::int AND "state" = 'active'
        AND (extract(epoch FROM "xact_start") * 1000000)::bigint = ${backend.startedUs}::bigint`;
  } catch {
    authEvent("staff.db_refused", { scope, reason: "CANCEL_FAILED" });
  } finally {
    release();
  }
}
