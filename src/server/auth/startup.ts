import "server-only";
import { ClientIdentityConfigError, clientIdentityConfig } from "./client-identity";
import { authEvent } from "./log";
import { MIN_PRISMA_CONNECTION_LIMIT, PRISMA_POOL_TIMEOUT_SECONDS, STAFF_DB_PERMITS, STAFF_RESERVED_CONNECTIONS } from "./policy";

// Configuration the server refuses to start without (T-037 D-01 enforcement, N-02 identity).
// src/instrumentation.ts runs checkStaffAuthStartup before Next serves; withStaffDb and the
// guards repeat their part on first use. No message carries the URL or any other value.
type Env = Record<string, string | undefined>;

export class StaffDbConfigError extends Error {}

// Pool accounting: 27 customer + 5 staff permits never exceed the pool.
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

export class StaffAuthStartupError extends Error {
  constructor(public problems: string[]) { super(`Staff authentication configuration refused: ${problems.join("; ")}`); }
}

// src/instrumentation.ts calls this before Next serves. Next only logs an error thrown from
// register() and keeps the process up (every request then fails with 500), so a refused
// configuration logs each problem and exits instead: the deploy health check fails and the
// previous deployment keeps serving.
export function refuseStartupOnInvalidConfiguration(env: Env = process.env): void {
  try {
    checkStaffAuthStartup(env);
  } catch (error) {
    const problems = error instanceof StaffAuthStartupError ? error.problems : ["startup check failed"];
    for (const reason of problems) authEvent("auth.config_invalid", { reason });
    process.exit(1);
  }
}

// Collects every problem so one failed deploy reports all of them.
export function checkStaffAuthStartup(env: Env = process.env): void {
  const problems: string[] = [];
  try { checkStaffDbConfiguration(env.DATABASE_URL, env.NODE_ENV); } catch (error) {
    if (!(error instanceof StaffDbConfigError)) throw error;
    problems.push(error.message);
  }
  try { clientIdentityConfig(env); } catch (error) {
    if (!(error instanceof ClientIdentityConfigError)) throw error;
    problems.push(error.message);
  }
  if (problems.length > 0) throw new StaffAuthStartupError(problems);
}
