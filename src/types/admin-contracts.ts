// Admin queue and booking API contracts (P1-07; ADR-005 §§13a-18, Amendment 1 A3/A4).
// Staff-side only: no customer route serializes any of these types. The P1-06 login and
// session routes keep their narrower envelope in src/server/auth/types.ts (PM decision D1).
import type { BookingStatus, ErrorCode, ISOInstant, LocalDate, UUID } from "./contracts";

export type AdminErrorCode = ErrorCode | "BOOKING_NOT_MANAGEABLE" | "CATALOG_UPDATED";
export type LineWorkStatus = "WAITING" | "IN_PROGRESS" | "DONE";
export type AdminSnapshot = "QUEUE_V3" | "LEGACY";

export interface AdminLine {
  id: UUID;
  order: number;
  serviceId: UUID;
  name: string;
  kind: "BASE" | "ADD_ON";
  unit: "VEHICLE" | "PANEL";
  quantity: number;
  priceStatus: "PRICED" | "FOR_QUOTE" | null; // null on legacy catalog-v2 lines
  unitPriceCentavos: number | null;
  subtotalCentavos: number | null;
  referenceSubtotalCentavos: number | null;
  staffPriceCentavos: number | null;
  effectivePriceCentavos: number | null; // staff price, else the charged subtotal
  workStatus: LineWorkStatus;
  removed: boolean;
}

export interface AdminTotals {
  receiptTotalCentavos: number | null; // immutable create receipt (QUEUE_V3)
  receiptEstimatedCentavos: number | null;
  currentTotalCentavos: number; // active lines' effective prices
  currentEstimateCentavos: number | null; // null while an unpriced active line has no reference
  forQuoteCount: number; // active lines still without a price
}

export interface AdminBay { id: UUID; name: string; sortOrder: number; isActive: boolean; updatedAt: ISOInstant }

export interface AdminQueueBooking {
  id: UUID;
  referenceCode: string;
  snapshot: AdminSnapshot;
  status: BookingStatus;
  revision: number;
  bookingDate: LocalDate;
  queueCode: string | null;
  queuePosition: number | null;
  customerName: string;
  vehicleModel: string;
  vehiclePlate: string | null;
  sizeCode: string | null;
  serviceName: string; // primary service at create
  bay: { id: UUID; name: string } | null; // for bookingDate
  lines: AdminLine[];
  totals: AdminTotals;
}

export interface AdminAuditEntry {
  id: UUID;
  action: string;
  actorStaffId: UUID;
  actorName: string;
  createdAt: ISOInstant;
  fromRevision: number | null;
  toRevision: number | null;
  lineId: UUID | null;
  details: Record<string, string | number | null>; // action fields only; reason is staff-only text
  reason: string | null;
}

export interface AdminBookingDetail extends AdminQueueBooking {
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
  cancellationKind: "CUSTOMER" | "SHOP_DECLINED" | "STAFF" | null;
  bays: { date: LocalDate; bay: { id: UUID; name: string } }[];
  createdAt: ISOInstant;
  history: AdminAuditEntry[]; // newest first, at most 50
}

export interface AdminError {
  code: AdminErrorCode;
  message: string;
  fieldErrors: Record<string, string[]>;
  retryable: boolean;
  commitState: "NOT_COMMITTED" | "UNKNOWN" | "NOT_APPLICABLE";
  currentBooking: AdminBookingDetail | null;
}
export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: AdminError };

export interface AdminQueueDay {
  code: string;
  name: string;
  isActive: boolean;
  effectiveCap: number | null; // null: not configured, so the day is full
  committed: number; // non-cancelled day bookings
  bookings: AdminQueueBooking[]; // by position; cancelled last
}
export interface AdminDayQueues {
  date: LocalDate;
  closed: { reason: string } | null; // a full-day block (staff-only reason)
  queues: AdminQueueDay[];
  legacy: AdminQueueBooking[];
}

export type AdminListSort = "DAY_ASC" | "CREATED_AT_DESC";
export interface AdminBookingList { items: AdminQueueBooking[]; nextCursor: string | null }
export interface AdminBookingSearchResult extends AdminBookingList { searchMode: "REFERENCE" | "PHONE" | "PHONE_SUFFIX" | "NAME" }

export interface AdminCapDay { date: LocalDate; dailyCap: number; revision: number }
export interface AdminQueueCaps {
  code: string;
  name: string;
  isActive: boolean;
  dailyCap: number | null;
  revision: number;
  overrides: AdminCapDay[];
  committed: { date: LocalDate; count: number }[];
}

export interface AdminWriteResult { booking: AdminBookingDetail; noChange: boolean }
export interface AdminNotifyResult extends AdminWriteResult { notice: "SENT" | "NOT_SENT" | "NO_EMAIL" }

export interface AdminHistoryItem {
  id: UUID;
  referenceCode: string;
  bookingDate: LocalDate;
  queueName: string; // "Legacy" for slot-era bookings
  status: BookingStatus;
  customerName: string;
  services: string[];
  totals: AdminTotals;
}
export interface AdminCustomerHistory { bookings: AdminHistoryItem[]; truncated: boolean }
