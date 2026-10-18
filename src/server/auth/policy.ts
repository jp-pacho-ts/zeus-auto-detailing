import "server-only";
import type { BookingStatus, UserRole } from "@/types/contracts";

// Server-only staff auth contracts (ARCHITECTURE T-019, T-029, T-037).
// Never serialized; values are reviewed defaults, changed by PR.

export type StaffRole = "ADMIN" | "MANAGER" | "DETAILER"; // mirrors the Prisma enum
export const STAFF_ROLE_TO_USER_ROLE: Readonly<Record<StaffRole, UserRole>> = {
  ADMIN: "ADMIN",
  MANAGER: "ADMIN",
  DETAILER: "STAFF",
};

export interface StaffLoginPolicy {
  perKeyPerMinute: number; // trusted client key
  perKeyPerDay: number;
  maxConcurrentPerKey: number; // in flight, including the failure floor wait
  maxConcurrentHashesPerProcess: number; // argon2id verifications at once
  maxQueuedPerProcess: number;
  maxQueueWaitMs: number;
  failureFloorMs: number; // no 401 is sent earlier than this after entry
  maxConsecutiveFailures: number;
  lockMinutes: number;
  lockTimeoutMs: number; // credential-row lock
  statementTimeoutMs: number;
  absoluteSessionHours: number;
  idleSessionMinutes: number;
  idleWriteIntervalMinutes: number;
}
export const STAFF_LOGIN_POLICY: Readonly<StaffLoginPolicy> = {
  perKeyPerMinute: 10, perKeyPerDay: 100, maxConcurrentPerKey: 1,
  maxConcurrentHashesPerProcess: 2, maxQueuedPerProcess: 10, maxQueueWaitMs: 2000,
  failureFloorMs: 400, maxConsecutiveFailures: 5, lockMinutes: 15,
  lockTimeoutMs: 2000, statementTimeoutMs: 3000,
  absoluteSessionHours: 12, idleSessionMinutes: 120, idleWriteIntervalMinutes: 5,
};

// Staff database admission (D-01). Every staff database statement runs while the
// request holds one permit of its phase's scope; one permit at a time, none across
// hashing, external calls or timer waits.
export type StaffDbScope =
  | "STAFF_LOGIN_DB" // anonymous: login snapshot, activation and failure phases
  | "STAFF_SESSION" // anonymous-reachable: session lookup, idle refresh, logout
  | "STAFF_READ" // authenticated reads, search, availability
  | "STAFF_MUTATION"; // authenticated status, reschedule, credential issuance
export interface StaffDbPolicy {
  maxConcurrentPerProcess: number; // permits; each holds at most one connection
  maxQueuedPerProcess: number;
  maxQueueWaitMs: number; // acquisition deadline
  statementTimeoutMs: number; // SET LOCAL statement_timeout for every statement
  lockTimeoutMs: number | null; // null: never takes a row or advisory lock
  perClientInvalidPerMinute: number | null; // STAFF_SESSION: unknown-token lookups
}
export const STAFF_DB_POLICY: Readonly<Record<StaffDbScope, StaffDbPolicy>> = {
  STAFF_LOGIN_DB: { maxConcurrentPerProcess: 1, maxQueuedPerProcess: 10, maxQueueWaitMs: 2000,
    statementTimeoutMs: 2000, lockTimeoutMs: 2000, perClientInvalidPerMinute: null },
  STAFF_SESSION: { maxConcurrentPerProcess: 2, maxQueuedPerProcess: 20, maxQueueWaitMs: 1000,
    statementTimeoutMs: 1000, lockTimeoutMs: null, perClientInvalidPerMinute: 30 },
  STAFF_READ: { maxConcurrentPerProcess: 1, maxQueuedPerProcess: 10, maxQueueWaitMs: 3000,
    statementTimeoutMs: 5000, lockTimeoutMs: null, perClientInvalidPerMinute: null },
  STAFF_MUTATION: { maxConcurrentPerProcess: 1, maxQueuedPerProcess: 10, maxQueueWaitMs: 3000,
    statementTimeoutMs: 5000, lockTimeoutMs: 5000, perClientInvalidPerMinute: null },
};

// T-027/T-035 pool split: customer scopes hold 27 permits, staff scopes 5.
export const STAFF_RESERVED_CONNECTIONS = 5;
export const CUSTOMER_DB_PERMITS = 27;
export const MIN_PRISMA_CONNECTION_LIMIT = CUSTOMER_DB_PERMITS + STAFF_RESERVED_CONNECTIONS;
export const STAFF_DB_PERMITS = Object.values(STAFF_DB_POLICY)
  .reduce((n, p) => n + p.maxConcurrentPerProcess, 0);
export const PRISMA_POOL_TIMEOUT_SECONDS = 2; // any pool wait means a permit was bypassed

export const ARGON2ID_MIN_PARAMS = {
  memoryKiB: 19456, iterations: 2, parallelism: 1, saltBytes: 16, hashBytes: 32,
} as const;

// Same-status requests (S-05): roles that get 200 noChange; any other role gets 403.
// Rule: the roles that may perform some transition into that status. Consumed by P1-07.
export const STATUS_NO_OP_ROLES: Readonly<Record<BookingStatus, readonly UserRole[]>> = {
  PENDING: ["ADMIN"], // reinstatement
  CONFIRMED: ["ADMIN"],
  IN_PROGRESS: ["STAFF", "ADMIN"],
  COMPLETED: ["STAFF", "ADMIN"],
  CANCELLED: ["ADMIN"],
};

export const STAFF_PASSWORD_POLICY = {
  minCodePoints: 15, maxCodePoints: 128, minDistinctCodePoints: 5,
  // R-01: one raw cap for login and every set/reset path. No raw form of a password
  // that normalizes to <= 128 code points is longer: 2 UTF-16 units x 4 (maximum
  // canonical decomposition) x 128. The tests re-derive the 4 from the runtime's ICU.
  maxRawUtf16Units: 1024,
  structuralMinCodePoints: 8, // shorter derived forms skip the structural rules
  serviceTerms: ["zeus", "zeusauto", "zeusautodetailing", "zeusdetailing",
    "autodetailing", "detailing", "carwash", "tacloban", "admin", "password"],
} as const;

export const STAFF_LOGIN_FAILURE_MESSAGE =
  "We couldn't sign you in. Check your details, or wait 15 minutes and try again.";
