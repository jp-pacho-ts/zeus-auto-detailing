// Admin queue and booking API contracts (P1-07; ADR-005 §§13a-18, Amendment 1 A3/A4).
// Staff-side only: no customer route serializes any of these types. The P1-06 login and
// session routes keep their narrower envelope in src/server/auth/types.ts (PM decision D1).
import type {
  BookingStatus,
  DepositStatus,
  ErrorCode,
  ISOInstant,
  LocalDate,
  UUID,
} from "./contracts";

export type AdminErrorCode =
  ErrorCode | "BOOKING_NOT_MANAGEABLE" | "CATALOG_UPDATED" | "NOT_ALLOWED";
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

export type BayType = "WASH" | "DETAILING" | "PAINT";
export interface AdminWorker {
  staffId: UUID;
  name: string;
  isActive: boolean;
}
export interface AdminBay {
  bayType: BayType; // legacy placeholder since P1-62
  containerId: UUID | null;
  id: UUID;
  name: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: ISOInstant;
}

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
  depositStatus: DepositStatus; // P1-18
  bay: { id: UUID; name: string } | null; // for bookingDate
  lines: AdminLine[];
  totals: AdminTotals;
}

export interface AdminAuditEntry {
  id: UUID;
  source: "STAFF" | "CUSTOMER";
  action: string;
  actorStaffId: UUID | null;
  actorName: string | null;
  createdAt: ISOInstant;
  fromRevision: number | null;
  toRevision: number | null;
  lineId: UUID | null;
  details: Record<string, string | number | null>; // action fields only; reason is staff-only text
  reason: string | null;
}

export interface AdminBookingDetail extends AdminQueueBooking {
  assignedWorkers: AdminWorker[];
  occupancy: { date: LocalDate; bay: { id: UUID; name: string } } | null;
  customerPhone: string;
  customerEmail: string | null;
  notes: string | null;
  cancellationKind: "CUSTOMER" | "SHOP_DECLINED" | "STAFF" | null;
  bays: { date: LocalDate; bay: { id: UUID; name: string } }[];
  createdAt: ISOInstant;
  history: AdminAuditEntry[]; // newest first, at most 50
  depositProofs: AdminDepositProof[]; // oldest first, at most 3; images via the proof route
}
// P1-18: metadata only; the image is read from
// GET /api/admin/bookings/{bookingId}/deposit-proofs/{id} with a staff session.
export interface AdminDepositProof {
  id: UUID;
  createdAt: ISOInstant;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
}

export interface AdminError {
  code: AdminErrorCode;
  message: string;
  fieldErrors: Record<string, string[]>;
  retryable: boolean;
  commitState: "NOT_COMMITTED" | "UNKNOWN" | "NOT_APPLICABLE";
  currentBooking: AdminBookingDetail | null;
}
export type AdminResult<T> =
  { ok: true; data: T } | { ok: false; error: AdminError };

export interface AdminQueueDay {
  code: string;
  name: string;
  isActive: boolean;
  effectiveCap: number | null; // null: unlimited
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
export interface AdminBookingList {
  items: AdminQueueBooking[];
  nextCursor: string | null;
}
export interface AdminBookingSearchResult extends AdminBookingList {
  searchMode: "REFERENCE" | "PHONE" | "PHONE_SUFFIX" | "NAME";
}

export interface AdminCapDay {
  date: LocalDate;
  dailyCap: number;
  revision: number;
}
export interface AdminQueueCaps {
  code: string;
  name: string;
  isActive: boolean;
  dailyCap: number | null;
  revision: number;
  overrides: AdminCapDay[];
  committed: { date: LocalDate; count: number }[];
}

export interface AdminWriteResult {
  booking: AdminBookingDetail;
  noChange: boolean;
}
// P1-29: the booking is gone; only its reference code comes back.
export interface AdminDeleteResult {
  deleted: true;
  reference: string;
}
export interface AdminNotifyResult extends AdminWriteResult {
  notice: "SENT" | "NOT_SENT" | "NO_EMAIL";
}

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
export interface AdminCustomerHistory {
  bookings: AdminHistoryItem[];
  truncated: boolean;
}

export interface AdminBoardCard {
  id: UUID;
  referenceCode: string;
  revision: number;
  bookingDate: LocalDate;
  queueCode: string;
  queuePosition: number;
  vehicleModel: string;
  vehiclePlate: string | null;
  sizeCode: string;
  status: BookingStatus;
  assignedBayId: UUID | null;
  lines: { id: UUID; name: string; workStatus: LineWorkStatus }[];
  assignedWorkers: AdminWorker[];
  progress: { done: number; total: number };
  depositStatus: DepositStatus; // P1-18 badge
}
export interface AdminDayBoard {
  date: LocalDate;
  closed: { reason: string } | null;
  workers: AdminWorker[];
  /** P1-62: the containers (named groups of bays) with their bays and cars, in order. */
  containers: AdminBoardContainer[];
  /** P1-62: ONE Waiting list: every open car with no bay, booked day then position. */
  waiting: AdminWaitingCard[];
  /** P1-62: ONE Done list: completed cars of the day, newest finish first. */
  done: AdminDoneCard[];
  queues: {
    code: string;
    name: string;
    bayType: BayType;
    waiting: AdminBoardCard[];
  }[];
  bays: (AdminBay & { cards: AdminBoardCard[] })[];
}

// -----------------------------------------------------------------------------
// P1-37 Team & commissions (ADMIN only). Money is integer centavos; rates are integer basis points
// (1000 = 10.00%). No customer name, phone, email or vehicle appears on any of these.
// -----------------------------------------------------------------------------
export interface AdminTeamPerson {
  id: UUID;
  name: string;
  phone: string;
  /** The real email, or null for a person added without one (they cannot sign in). */
  email: string | null;
  role: "ADMIN" | "MANAGER" | "DETAILER";
  isActive: boolean;
  /** Personal percentage in basis points; null means "use the default". */
  commissionRateBp: number | null;
  canSignIn: boolean;
  openJobs: number;
  hasHistory: boolean;
  revision: number;
  createdAt: ISOInstant;
  nickname: string | null;
  position: string | null;
  hiredOn: LocalDate | null;
}
/** P1-64: the details the admin keeps about a person. ADMIN only, never in a customer response, a log or an audit label. */
export interface AdminStaffProfile {
  nickname: string | null;
  position: string | null;
  contactEmail: string | null;
  address: string | null;
  birthDate: LocalDate | null;
  hiredOn: LocalDate | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  notes: string | null;
}
export interface AdminTeamPersonDetail {
  person: AdminTeamPerson;
  profile: AdminStaffProfile;
}
/** What Remove will do, shown before the admin confirms. */
export interface AdminTeamRemovePreview {
  openJobs: { bookingId: UUID; referenceCode: string }[];
  unpaidCentavos: number;
  unpaidJobs: number;
}
export interface AdminTeam {
  people: AdminTeamPerson[];
  defaultRateBp: number;
  settingsRevision: number;
}
/** DELETED: nothing pointed at the person, the row is gone. REMOVED: hidden for good; the name stays on history, personal details are erased. */
export type AdminTeamRemoveOutcome = "DELETED" | "REMOVED";

export interface AdminCommissionSettings {
  defaultRateBp: number;
  revision: number;
  startsAt: ISOInstant;
}
export interface AdminCommissionEntry {
  id: UUID;
  bookingReference: string;
  serviceName: string;
  completedOn: LocalDate;
  staffId: UUID;
  staffName: string;
  position: number;
  serviceTotalCentavos: number;
  shareCentavos: number;
  rateBp: number;
  amountCentavos: number;
  creditedCount: number;
  unpricedLineCount: number;
  paidAt: ISOInstant | null;
  /** Later corrections to this amount, oldest first (a late price, a mistake). Each is paid on its own. */
  adjustments: AdminCommissionAdjustment[];
  /** The booking's services: which counted toward the commission and which did not (a car wash earns none). */
  lines: AdminCommissionLine[];
}
export interface AdminCommissionLine {
  name: string;
  /** True when this service earns commission (detailing, paint, coating, tint). */
  counted: boolean;
  /** Why it did not count, in plain words; null when it counted. */
  notCountedReason: string | null;
  /** The price at the time; null when the service had no price. */
  amountCentavos: number | null;
}
export interface AdminCommissionAdjustment {
  id: UUID;
  /** Signed whole centavos; the entry amount plus its adjustments is never below zero. */
  amountCentavos: number;
  reason: string;
  createdAt: ISOInstant;
  paidAt: ISOInstant | null;
}
export interface AdminCommissionPersonTotal {
  staffId: UUID;
  staffName: string;
  entryCount: number;
  earnedCentavos: number;
  paidCentavos: number;
  unpaidCentavos: number;
}
export interface AdminCommissionSummary {
  from: LocalDate;
  to: LocalDate;
  settings: AdminCommissionSettings;
  totals: AdminCommissionPersonTotal[];
  grandTotal: { entryCount: number; earnedCentavos: number; paidCentavos: number; unpaidCentavos: number };
  entries: AdminCommissionEntry[];
  /** True when more entries matched than were returned; the totals still cover every one. */
  truncated: boolean;
  warnings: {
    /** Completed bookings in the range with nobody credited (no commission could be recorded). */
    nobodyCredited: number;
    /** Entries on bookings that completed with a service that had no final price. */
    unpricedEntries: number;
    /** Completed bookings in the range where nothing earns commission (a car wash only). */
    noCommissionBookings: number;
    /** Completed bookings since commissions began that have no record (an accrual failed). */
    missingRecords: number;
  };
}
export interface AdminCommissionPaidResult {
  changed: number;
  unknown: number;
}

// ---- P1-38 Supplies & Inventory (ADMIN only; money is integer centavos, stock is a whole number) ----
export type AdminSupplyStatus = "NONE" | "OK" | "LOW" | "OUT"; // NONE: reorder level 0 means no alert
export interface AdminSupplyItem {
  id: UUID;
  name: string;
  category: string | null;
  unit: string;
  currentStock: number;
  reorderLevel: number;
  costPerUnitCentavos: number;
  isActive: boolean;
  revision: number;
  status: AdminSupplyStatus;
  /** True when the item has any movement: Delete then archives it instead of erasing it. */
  hasHistory: boolean;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}
export interface AdminSupplyList {
  items: AdminSupplyItem[];
  /** Active items that are low or out (an item with reorder level 0 is never counted). */
  lowOrOutCount: number;
}
export interface AdminSupplyMovement {
  id: UUID;
  kind: "OPENING" | "RECEIVE" | "USE";
  delta: number;
  stockAfter: number;
  /** The price of one unit in this purchase; null when none was typed. */
  unitCostCentavos: number | null;
  note: string | null;
  actorName: string;
  createdAt: ISOInstant;
}
export interface AdminSupplyMovements {
  movements: AdminSupplyMovement[];
  /** Pass back as ?cursor= for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

// ---- P1-62 A1 bay containers (ADMIN writes; the board read is for any staff) ----
export interface AdminContainer {
  id: UUID;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** The optional "usually for" label as queue codes; empty means no label (the board never asks). */
  usualQueues: string[];
  /** The version token for rename, label, remove and bay moves. */
  updatedAt: ISOInstant;
  /** Active bays in it. */
  bayCount: number;
}
export interface AdminBoardContainer {
  id: UUID;
  name: string;
  sortOrder: number;
  usualQueues: string[];
  updatedAt: ISOInstant;
  bays: (AdminBay & { cards: AdminBoardCard[] })[];
}
/** A Waiting card: the main service's queue name, and each line's own service queue (null if unknown). */
export interface AdminWaitingCard extends AdminBoardCard {
  queueName: string;
  lines: { id: UUID; name: string; workStatus: LineWorkStatus; queueCode: string | null }[];
}
export interface AdminDoneCard {
  id: UUID;
  referenceCode: string;
  revision: number;
  bookingDate: LocalDate;
  queueCode: string;
  queueName: string;
  vehicleModel: string;
  vehiclePlate: string | null;
  sizeCode: string;
  lines: { id: UUID; name: string }[];
  workers: AdminWorker[];
  /** The finish moment (the booking's terminal time). */
  finishedAt: ISOInstant;
}

// -----------------------------------------------------------------------------
// P1-39 Expenses (ADMIN only). One row's amount fits a number; totals may not, so they are decimal strings of centavos.
// -----------------------------------------------------------------------------
export interface AdminExpenseCategory {
  id: UUID;
  name: string;
  sortOrder: number;
  isActive: boolean;
  revision: number;
}
export interface AdminExpense {
  id: UUID;
  expenseDate: LocalDate;
  categoryId: UUID;
  categoryName: string;
  amountCentavos: number;
  payee: string | null;
  note: string | null;
  revision: number;
  removed: boolean;
  createdAt: ISOInstant;
}
export interface AdminExpenseEvent {
  seq: string;
  kind: "CREATED" | "EDITED" | "VOIDED" | "RESTORED";
  revision: number;
  expenseDate: LocalDate;
  /** The name it had at that time. */
  categoryName: string;
  amountCentavos: number;
  payee: string | null;
  note: string | null;
  reason: string | null;
  actorName: string;
  createdAt: ISOInstant;
}
export interface AdminExpenseMonth {
  month: string;
  expenses: AdminExpense[];
  nextCursor: string | null;
  /** total = manual + stockBought + commissionsPaid. commissionsOwed is a separate note and not in the total. */
  totals: { total: string; manual: string; stockBought: string; commissionsPaid: string; commissionsOwed: string };
  byCategory: { categoryId: UUID; name: string; total: string }[];
  pricedStockIns: number;
  unpricedStockIns: number;
  /** The last 12 months, oldest first. */
  series: { month: string; total: string; manual: string; stockBought: string; commissionsPaid: string }[];
}

// -----------------------------------------------------------------------------
// P1-40 Sales & Analytics (ADMIN only, read-only). Money is integer centavos. No customer name, phone, email or plate.
// -----------------------------------------------------------------------------
export type AdminAnalyticsBucketUnit = "DAY" | "WEEK" | "MONTH";
export interface AdminAnalyticsBucket {
  start: LocalDate;
  end: LocalDate;
  /** The bucket has not started yet: it holds no result, not a zero. */
  future: boolean;
  revenueCentavos: number;
  jobs: number;
}
export interface AdminAnalyticsSales {
  /** Final prices of the jobs finished in the range, by their finish day in Manila. Prices, not cash: no payment is recorded. */
  revenueCentavos: number;
  finishedJobs: number;
  /** Finished jobs with every service priced: the only ones in the average. */
  fullyPricedJobs: number;
  averageJobCentavos: number | null;
  /** Finished jobs with a service that has no final price. At most 20 references, newest first. */
  unpriced: { jobs: number; references: string[] };
  buckets: { unit: AdminAnalyticsBucketUnit; rows: AdminAnalyticsBucket[] };
  byGroup: { code: string; revenueCentavos: number }[];
  byQueue: { code: string; name: string; revenueCentavos: number }[];
  topServices: { serviceId: string; name: string; revenueCentavos: number; count: number }[];
}
export interface AdminAnalytics extends AdminAnalyticsSales {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  /** Bookings dated in the range, as they stand now. */
  bookingsByStatus: Record<BookingStatus, number>;
  notCounted: {
    /** Finished bookings dated in the range that were deleted (the audit keeps only the booked day). */
    deletedFinished: number;
    /** Finished bookings of the older booking model, at any date: they have no reliable lines. */
    olderFinished: number;
  };
  commissions: {
    startsAt: ISOInstant;
    /** On the jobs finished in the range, with their adjustments. */
    earnedCentavos: number;
    unpaidCentavos: number;
    nobodyCredited: number;
    missingRecords: number;
  };
  stock: {
    /** Today, never for a past range. Null when too large to show exactly. */
    valueCentavos: number | null;
    noCostItems: number;
    lowOrOutCount: number;
  };
}

// -----------------------------------------------------------------------------
// P1-42 Settings (ADMIN only). No secret, address or password: email is a yes or no and two counts.
// -----------------------------------------------------------------------------
export interface AdminShopSettings {
  revision: number;
  maintenance: boolean;
  maintenanceMessage: string | null;
  bookingPaused: boolean;
  /** The server setting ONLINE_BOOKING_MODE says PAUSED: the screen cannot open it. */
  bookingPausedByServer: boolean;
  updatedAt: ISOInstant;
  email: { configured: boolean; failedLast7Days: number; waitingLast7Days: number };
}

// -----------------------------------------------------------------------------
// P1-41 User Management & Password Change
// -----------------------------------------------------------------------------
export interface AdminUser {
  id: UUID;
  name: string;
  phone: string;
  email: string;
  role: "SUPERADMIN" | "ADMIN";
  isActive: boolean;
  hasCredential: boolean;
  passwordChangedAt: ISOInstant | null;
  revision: number;
  createdAt: ISOInstant;
}

export interface AdminUserCreateResult {
  user: AdminUser;
  temporaryPassword: string;
}

export interface AdminUserResetPasswordResult {
  ok: true;
  temporaryPassword: string;
}

export interface AdminUserChangePasswordResult {
  ok: true;
}

export interface AdminServiceOffer {
  id: string;
  vehicleCategoryId: string;
  sizeCode: string;
  state: "OFFERED" | "NOT_OFFERED" | "UNCONFIRMED";
  bookingMode: "FIXED_ONLINE" | "QUOTE_REQUIRED";
  unitPriceCentavos: number | null;
  compareAtCentavos: number | null;
  durationMinutes: number | null;
}

export interface AdminServiceItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: import("./catalog-contracts").CatalogServiceKind;
  type: "BASE" | "ADD_ON";
  unit: import("./catalog-contracts").PriceUnit;
  inclusions: string[];
  productName: string | null;
  hardness: string | null;
  warrantyMonths: number | null;
  referenceUnitPriceCentavos: number | null;
  sortOrder: number;
  isActive: boolean;
  offers: AdminServiceOffer[];
}

export interface AdminServiceList {
  services: AdminServiceItem[];
  vehicleCategories: {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
  }[];
}

export interface AdminServiceOfferInput {
  sizeCode: string;
  state: "OFFERED" | "NOT_OFFERED" | "UNCONFIRMED";
  unitPriceCentavos: number | null;
  compareAtCentavos: number | null;
}

export interface AdminServiceUpdateInput {
  name: string;
  description?: string | null;
  category: import("./catalog-contracts").CatalogServiceKind;
  offers: AdminServiceOfferInput[];
}

export interface AdminServiceCreateInput {
  name: string;
  description?: string | null;
  category: import("./catalog-contracts").CatalogServiceKind;
  type: "BASE" | "ADD_ON";
  unit: import("./catalog-contracts").PriceUnit;
  offers: AdminServiceOfferInput[];
}
