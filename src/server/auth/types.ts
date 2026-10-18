import type { ErrorCode, ISOInstant, StaffSession as BaseStaffSession, UUID, UserRole } from "@/types/contracts";
import type { StaffRole } from "./policy";

// Server-only result of getStaffSession(); additive to the baseline StaffSession.
export interface StaffSession extends BaseStaffSession {
  subject: UUID; // Staff.id
  role: UserRole; // STAFF_ROLE_TO_USER_ROLE[staffRole], derived per request
  staffRole: StaffRole;
  displayName: string; // Staff.name
  sessionId: UUID; // StaffSession.id; never serialized to the browser
  expiresAt: ISOInstant; // earlier of absolute and idle expiry
  absoluteExpiresAt: ISOInstant;
  idleExpiresAt: ISOInstant;
}

export interface StaffSessionView {
  staffId: UUID;
  displayName: string;
  role: UserRole;
  staffRole: StaffRole;
  expiresAt: ISOInstant; // absolute expiry
  idleExpiresAt: ISOInstant;
}

// The /api/admin/** error envelope (ARCHITECTURE T-019). P1-07 moves it into the shared
// contracts with the booking codes and widens currentBooking to AdminBookingDetail.
export interface AdminError {
  code: ErrorCode;
  message: string;
  fieldErrors: Record<string, string[]>;
  retryable: boolean;
  commitState: "NOT_COMMITTED" | "UNKNOWN" | "NOT_APPLICABLE";
  currentBooking: null;
}
export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: AdminError };
export type StaffSessionResponse = AdminResult<StaffSessionView>;

export function toSessionView(session: StaffSession): StaffSessionView {
  return {
    staffId: session.subject, displayName: session.displayName, role: session.role,
    staffRole: session.staffRole, expiresAt: session.absoluteExpiresAt, idleExpiresAt: session.idleExpiresAt,
  };
}
