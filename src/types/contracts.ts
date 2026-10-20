export type UUID = string;
export type LocalDate = string; // YYYY-MM-DD, calendar-valid, Asia/Manila
export type LocalTime = string; // HH:mm, 24-hour, minutes only
export type ISOInstant = string; // UTC YYYY-MM-DDTHH:mm:ss.sssZ
export type LocalMonth = string; // YYYY-MM
export type VehicleCategoryCode =
  | "SEDAN" | "SUV_CROSSOVER" | "PICKUP_VAN" | "MOTORCYCLE_SPECIALTY";
export type ServiceKind =
  | "CERAMIC_COATING" | "PAINT_CORRECTION" | "INTERIOR_DETAILING"
  | "EXTERIOR_WASH_SEAL" | "WINDOW_TINT_PPF";
export type BookingStatus =
  | "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type UserRole = "ADMIN" | "STAFF";
export type SlotState =
  | "AVAILABLE" | "LIMITED" | "SOLD_OUT" | "HOLIDAY" | "CLOSED"
  | "PAST" | "OUTSIDE_HOURS" | "BLOCKED";
export type DayState = "OPEN" | "HOLIDAY" | "CLOSED";

export interface VehicleCategory {
  id: UUID;
  code: VehicleCategoryCode; // Prisma VehicleCategory.slug uses this exact value
  name: string;
  description: string | null;
  sizeMultiplier: number;
  sortOrder: number;
}
export interface ServicePackage {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  category: ServiceKind;
  durationMinutes: number;
  basePriceCentavos: number;
  bayCapacityRequired: 1;
  isActive: boolean;
}
export interface TimeSlot {
  id: UUID; // recurring template ID
  dayOfWeek: number; // integer 0..6
  startTime: LocalTime;
  endTime: LocalTime;
  maxVehicleCapacity: number;
  isActive: boolean;
}
export interface ShopScheduleConfig {
  id: UUID;
  timezone: "Asia/Manila"; // application constant, not stored per row
  defaultSlotIntervalMinutes: number;
  defaultBayCapacity: number;
  openTime: LocalTime;
  closeTime: LocalTime;
  effectiveDate: LocalDate;
}
export interface BlockedDate {
  id: UUID;
  date: LocalDate;
  reason: string;
  isFullDay: boolean;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
}
export interface CreateBookingRequest {
  idempotencyKey: UUID;
  vehicleCategoryId: UUID;
  serviceId: UUID;
  bookingDate: LocalDate;
  startTime: LocalTime;
  customerName: string;
  customerPhone: string; // accepts PH mobile formats; normalized server-side
  customerEmail?: string;
  vehicleModel: string;
  vehiclePlate?: string;
  specialRequests?: string;
}
export interface BookingSummary {
  id: UUID;
  referenceCode: string;
  status: BookingStatus;
  vehicleCategoryId: UUID;
  vehicleCategoryName: string; // snapshot
  serviceId: UUID;
  serviceName: string; // snapshot
  bookingDate: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
  startsAt: ISOInstant;
  endsAt: ISOInstant;
  timezone: "Asia/Manila";
  durationMinutes: number;
  totalPriceCentavos: number;
  currency: "PHP";
  customerName: string;
  customerPhone: string; // normalized +639XXXXXXXXX
  customerEmail: string | null;
  vehicleModel: string;
  vehiclePlate: string | null;
  specialRequests: string | null; // Prisma notes
  createdAt: ISOInstant;
}
export type Booking = BookingSummary & { updatedAt: ISOInstant };
export type ErrorCode =
  | "VALIDATION_ERROR" | "NOT_FOUND" | "SLOT_UNAVAILABLE"
  | "SCHEDULE_CONFLICT" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT"
  | "UNAUTHENTICATED" | "FORBIDDEN" | "RATE_LIMITED"
  | "RETRYABLE_ERROR" | "INTERNAL_ERROR";
export interface ContractError {
  code: ErrorCode;
  message: string; // safe actionable text
  fieldErrors: Record<string, string[]>; // dot paths; {} for non-field errors
  retryable: boolean;
}
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ContractError };
export type BookingResponse = Result<BookingSummary>;

export interface GetAvailableSlotsRequest {
  date: LocalDate;
  vehicleCategoryId: UUID;
  serviceId: UUID;
}
export interface AvailableSlot {
  slotId: UUID; // TimeSlot template for this date's weekday
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime; // candidate's service end, not slot interval end
  durationMinutes: number;
  maxVehicleCapacity: number; // minimum across candidate intervals
  remainingCapacity: number; // minimum across candidate intervals
  state: SlotState;
  selectable: boolean;
  reason: string | null;
}
export interface AvailableSlotData {
  date: LocalDate;
  timezone: "Asia/Manila";
  vehicleCategoryId: UUID;
  serviceId: UUID;
  durationMinutes: number;
  totalPriceCentavos: number;
  currency: "PHP";
  dayState: DayState;
  reason: string | null;
  slots: AvailableSlot[]; // ascending startTime
  generatedAt: ISOInstant;
}
export type AvailableSlotResponse = Result<AvailableSlotData>;

export interface CalendarIntervalSummary {
  slotId: UUID;
  startTime: LocalTime;
  endTime: LocalTime; // interval end
  maxVehicleCapacity: number;
  occupiedCapacity: number;
  remainingCapacity: number;
  capacityVersion: number; // override version, or 0 if absent
  isBlocked: boolean; // partial closure overlaps this interval
}
export interface CalendarDaySchedule {
  date: LocalDate;
  dayState: DayState;
  reason: string | null;
  bookingCounts: Record<BookingStatus, number>;
  reservedBayMinutes: number; // exact non-CANCELLED durations on this date
  offeredBayMinutes: number; // capacity * unblocked minutes across intervals
  utilizationPercent: number | null; // null if offeredBayMinutes=0
  intervals: CalendarIntervalSummary[];
}
export interface GetCalendarMonthScheduleRequest {
  month: LocalMonth;
}
export interface CalendarMonthScheduleData {
  month: LocalMonth;
  timezone: "Asia/Manila";
  days: CalendarDaySchedule[]; // every date in month, ascending; no padding cells
  generatedAt: ISOInstant;
}
export type CalendarMonthScheduleResponse = Result<CalendarMonthScheduleData>;
export interface UpdateSlotCapacityRequest {
  date: LocalDate;
  slotId: UUID;
  maxVehicleCapacity: number;
  expectedVersion: number; // 0 for first override
}
export interface UpdatedSlotCapacity {
  date: LocalDate;
  slotId: UUID;
  maxVehicleCapacity: number;
  occupiedCapacity: number;
  remainingCapacity: number;
  version: number;
}
export type UpdateSlotCapacityResponse = Result<UpdatedSlotCapacity>;
export interface UpdateBookingStatusRequest {
  bookingId: UUID;
  status: BookingStatus;
}
export interface StaffSession {
  subject: string;
  role: UserRole;
  expiresAt: ISOInstant;
}

// Release-1 catalog shape, kept only so the old booking wizard compiles until P1-05 moves it to
// ./catalog-contracts. GET /api/catalog no longer serves this shape: it returns the ADR-004
// BookingCatalogResponse from ./catalog-contracts (no multiplier or bay fields).
export interface BookingCatalog {
  vehicleCategories: VehicleCategory[];
  services: ServicePackage[];
}
export type BookingCatalogResponse = Result<BookingCatalog>;

// P1-03 day create v4; release-1 DTOs above are legacy compatibility only.
export type CreateDayBookingRequest = import("zod").z.infer<typeof import("@/lib/validation").CreateDayBookingSchema>;
export type DayAvailabilityRequest = import("zod").z.infer<typeof import("@/lib/validation").DayAvailabilitySchema>;
export type PublicDayState = "AVAILABLE" | "FULLY_BOOKED" | "CLOSED";
export interface PublicDay { date: LocalDate; state: PublicDayState }
export interface DayAvailabilityData { timezone: "Asia/Manila"; days: PublicDay[]; nextAvailableDay: LocalDate | null; searchedThrough: LocalDate; generatedAt: ISOInstant; quote: import("./catalog-contracts").BookingQuote; onlineBookingStatus: "OPEN" | "PAUSED" }
export interface DayBookingView { id: UUID; referenceCode: string; status: BookingStatus; revision: number; bookingDate: LocalDate; timezone: "Asia/Manila"; vehicleCategoryId: UUID; vehicleCategoryName: string; lines: { serviceId: UUID; name: string; quantity: number; priceStatus: "PRICED" | "FOR_QUOTE"; subtotalCentavos: number | null; referenceSubtotalCentavos: number | null }[]; totalPriceCentavos: number; estimatedTotalCentavos: number | null; currency: "PHP" }
export type DayBookingResponse = import("./catalog-contracts").LifecycleResult<{ booking: DayBookingView; managementAccess: { accessToken: string; expiresAt: ISOInstant } | null; commitState: "COMMITTED"; replayed: boolean }>;

// P1-04 stable session/API boundary for P1-05 and P1-18. Progress/checklist is deferred.
export interface ManagedDayBookingView extends DayBookingView {
 vehicleModel:string;
 vehiclePlate:string|null;
 selfServiceAllowed:boolean;
 selfServiceCutoff:ISOInstant;
}
export interface CancelManagedBookingRequest {bookingId:UUID;idempotencyKey:UUID;expectedRevision:number}
export interface RescheduleManagedBookingRequest extends CancelManagedBookingRequest {bookingDate:LocalDate}
export type RecoverBookingOperationRequest =
 | {operationKind:"CREATE";bookingId:null;idempotencyKey:UUID}
 | {operationKind:"CANCEL"|"RESCHEDULE";bookingId:UUID;idempotencyKey:UUID};
export type ManagementAccessGrant={accessToken:string;expiresAt:ISOInstant};
export type RecoveredBookingOperation =
 | {state:"COMMITTED";operationKind:"CREATE"|"CANCEL"|"RESCHEDULE";booking:ManagedDayBookingView;managementAccess:ManagementAccessGrant|null}
 | {state:"NOT_COMMITTED";operationKind:"CREATE"|"CANCEL"|"RESCHEDULE";reason:"REJECTED"|"CLOSED_WITHOUT_COMMIT";rejectionCode:import("./catalog-contracts").LifecycleErrorCode|null};
export type ManagementMutationData={operationKind:"CANCEL"|"RESCHEDULE";booking:ManagedDayBookingView;replayed:boolean;noChange:boolean};
export interface ManagedDayAvailabilityData {bookingId:UUID;bookingRevision:number;timezone:"Asia/Manila";days:PublicDay[];nextAvailableDay:LocalDate|null;searchedThrough:LocalDate;quote:null}
export type DayAvailabilityResponse = import("./catalog-contracts").LifecycleResult<DayAvailabilityData>;
