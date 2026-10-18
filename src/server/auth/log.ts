import "server-only";

// Auth events carry identifiers and reason classes only: never passwords, hashes,
// cookies, tokens, submitted emails or raw client addresses (ARCHITECTURE T-019).
export type AuthEventName =
  | "auth.login_succeeded" | "auth.login_failed" | "auth.locked" | "auth.failure_floor_exceeded"
  | "auth.login_refused" | "auth.logout" | "auth.session_rejected" | "auth.credential_changed"
  | "auth.config_invalid" | "staff.db_refused" | "db.pool_wait_violation";

export interface AuthEventFields {
  staffId?: string | null;
  reason?: string;
  clientKeyDigest?: string;
  scope?: string;
  operation?: "SET_PASSWORD" | "UNLOCK" | "DEACTIVATE" | "REACTIVATE";
  rejection?: string;
  status?: number;
}

type Sink = (event: AuthEventName, fields: AuthEventFields) => void;
const consoleSink: Sink = (event, fields) => console.info(JSON.stringify({ event, ...fields }));
let sink: Sink = consoleSink;

export function authEvent(event: AuthEventName, fields: AuthEventFields = {}): void {
  try { sink(event, fields); } catch { /* logging never changes an auth outcome */ }
}

// Tests capture events to assert what is (and is not) logged.
export function setAuthEventSink(next: Sink | null): void {
  sink = next ?? consoleSink;
}
