// Catalog and booking quote v3 contracts for the ADR-005 queue booking model (catalog releases
// and per-size offers from ADR-004). Public payloads are explicit allowlisted projections: no
// multiplier, bayCapacityRequired, capacity, cap, queue length, bay, hold plan, source
// annotation, rating or unverified comparison price.
//
// A booking is one car visit on one day with one or more service lines for one vehicle size.
// Each line is PRICED (a fixed price) or FOR_QUOTE (bookable, no charged price until ADMIN
// sets one, with a reference estimate where the catalog has one). Quotes carry no duration or
// time: durations are informational only and capacity is a per-queue daily cap.
//
// The release-1 names in ./contracts (VehicleCategory, ServicePackage, BookingCatalog) remain
// only for the old booking wizard until P1-05 moves it to these types; ./contracts re-exports
// this module once those consumers are gone. Create, day availability and the managed booking
// views are added by the lifecycle tasks (P1-03, P1-04).
import { z } from "zod";
import type { ErrorCode, UUID } from "./contracts";

export const VehicleCategoryCodeSchema = z.enum(["MOTOR", "S", "M", "L", "XL"]);
export type VehicleCategoryCode = z.infer<typeof VehicleCategoryCodeSchema>;
export interface VehicleCategory {
  id: UUID;
  code: VehicleCategoryCode;
  name: string;
  description: string | null;
  sortOrder: number;
}
export type CatalogServiceKind = "WASH" | "DETAILING" | "GRAPHENE" | "TINT" | "PPF" | "REPAINT";
export type PriceUnit = "VEHICLE" | "PANEL";
export type BookingMode = "FIXED_ONLINE" | "QUOTE_REQUIRED";
// How a (service, size) cell can be booked online, decided by the server from catalog data.
export type OnlineBooking = "PRICED" | "FOR_QUOTE" | "UNAVAILABLE";
export type PublicDuration =
  | { kind: "UNKNOWN" }
  | { kind: "TIMED"; minutes: number }
  | { kind: "MULTI_DAY"; elapsedDays: number | null };
export type ServiceSizeOffer = {
  id: UUID;
  vehicleCategoryId: UUID;
  duration: PublicDuration; // informational only (ADR-005); never capacity
  onlineBooking: OnlineBooking;
} & (
  | { state: "OFFERED"; bookingMode: BookingMode; unitPriceCentavos: number;
      compareAtCentavos: number | null }
  | { state: "NOT_OFFERED"; bookingMode: "QUOTE_REQUIRED";
      unitPriceCentavos: null; compareAtCentavos: null }
  | { state: "UNCONFIRMED"; bookingMode: "QUOTE_REQUIRED";
      unitPriceCentavos: number | null; compareAtCentavos: null }
);
export interface ServicePackage {
  id: UUID;
  slug: string;
  name: string;
  description: string | null;
  category: CatalogServiceKind;
  type: "BASE" | "ADD_ON";
  unit: PriceUnit;
  inclusions: string[];
  productName: string | null;
  hardness: string | null;
  warrantyMonths: number | null;
  referenceUnitPriceCentavos: number | null; // panel source reference, not size confirmation
  offers: ServiceSizeOffer[]; // exactly one for each of the five sizes
}
export interface BookingCatalog {
  catalogReleaseId: UUID;
  catalogVersion: string;
  vehicleCategories: VehicleCategory[];
  services: ServicePackage[];
  addOnCompatibility: { baseServiceId: UUID; addOnServiceId: UUID }[];
}

const Id = z.string().uuid().transform((s) => s.toLowerCase());
const Money = z.number().int().min(0).max(100_000_000); // centavos, no coercion
const Instant = z.string().datetime({ precision: 3, offset: false });
const Hex = z.string().regex(/^[a-f0-9]{64}$/);
// A queue's stable code (ADR-005 §7, e.g. "WASH"). The queue list is catalog data, so the
// contract fixes only the shape, not the members.
export const QueueCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/);
export const MAX_SELECTION_LINES = 10;
export const PublicDurationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNKNOWN") }).strict(),
  z.object({ kind: z.literal("TIMED"), minutes: z.number().int().min(1).max(540) }).strict(),
  z.object({ kind: z.literal("MULTI_DAY"), elapsedDays: z.number().int().min(1).max(365).nullable() }).strict(),
]) satisfies z.ZodType<PublicDuration>;
const OfferFields = { id: Id, vehicleCategoryId: Id, duration: PublicDurationSchema, onlineBooking: z.enum(["PRICED", "FOR_QUOTE", "UNAVAILABLE"]) };
export const ServiceSizeOfferSchema = z.discriminatedUnion("state", [
  z.object({ ...OfferFields, state: z.literal("OFFERED"),
    bookingMode: z.enum(["FIXED_ONLINE", "QUOTE_REQUIRED"]),
    unitPriceCentavos: Money, compareAtCentavos: Money.nullable() }).strict(),
  z.object({ ...OfferFields, state: z.literal("NOT_OFFERED"),
    bookingMode: z.literal("QUOTE_REQUIRED"), unitPriceCentavos: z.null(),
    compareAtCentavos: z.null() }).strict(),
  z.object({ ...OfferFields, state: z.literal("UNCONFIRMED"),
    bookingMode: z.literal("QUOTE_REQUIRED"), unitPriceCentavos: Money.nullable(),
    compareAtCentavos: z.null() }).strict(),
]).superRefine((o, ctx) => {
  if (o.state === "NOT_OFFERED" && (o.duration.kind !== "UNKNOWN" || o.onlineBooking !== "UNAVAILABLE"))
    ctx.addIssue({ code: "custom", path: ["onlineBooking"], message: "Unavailable pair has no duration and cannot be booked" });
  if (o.onlineBooking === "PRICED" && (o.state !== "OFFERED" || o.bookingMode !== "FIXED_ONLINE"))
    ctx.addIssue({ code: "custom", path: ["onlineBooking"], message: "Only fixed offered cells are priced" });
  if (o.state === "OFFERED" && o.compareAtCentavos !== null && o.compareAtCentavos <= o.unitPriceCentavos)
    ctx.addIssue({ code: "custom", path: ["compareAtCentavos"], message: "Comparison must exceed selling price" });
}) satisfies z.ZodType<ServiceSizeOffer>;

// A selection: one size and one or more distinct services, in the customer's order. The first
// BASE line is the primary service, whose queue the booking joins (ADR-005 §8).
export const SelectionLineSchema = z.object({
  serviceId: Id,
  quantity: z.number().int().min(1).max(20), // VEHICLE lines must be 1; PANEL lines 1..20
}).strict();
export const CatalogSelectionSchema = z.object({
  vehicleCategoryId: Id,
  lines: z.array(SelectionLineSchema).min(1).max(MAX_SELECTION_LINES).refine(
    (lines) => new Set(lines.map((l) => l.serviceId)).size === lines.length, "Each service can be selected once"),
}).strict();
export type CatalogSelection = z.infer<typeof CatalogSelectionSchema>;
export type GetBookingQuoteRequest = CatalogSelection;
export const GetBookingQuoteSchema = CatalogSelectionSchema;

export const QuotedLineSchema = z.object({
  serviceId: Id,
  offerId: Id,
  kind: z.enum(["BASE", "ADD_ON"]),
  name: z.string().min(1).max(100),
  unit: z.enum(["VEHICLE", "PANEL"]),
  quantity: z.number().int().min(1).max(20),
  priceStatus: z.enum(["PRICED", "FOR_QUOTE"]),
  unitPriceCentavos: Money.nullable(), // charged; null for FOR_QUOTE until ADMIN sets a price
  subtotalCentavos: Money.nullable(),
  referenceUnitPriceCentavos: Money.nullable(), // FOR_QUOTE reference only; never charged
  referenceSubtotalCentavos: Money.nullable(),
}).strict().superRefine((l, ctx) => {
  const product = (unit: number | null, subtotal: number | null) => (unit === null) === (subtotal === null) && (unit === null || subtotal === unit * l.quantity);
  const ok = l.priceStatus === "PRICED"
    ? l.unitPriceCentavos !== null && product(l.unitPriceCentavos, l.subtotalCentavos) && l.referenceUnitPriceCentavos === null && l.referenceSubtotalCentavos === null
    : l.unitPriceCentavos === null && l.subtotalCentavos === null && product(l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos);
  if (!ok) ctx.addIssue({ code: "custom", path: ["priceStatus"], message: "Line amounts do not match its price status" });
  if (l.unit === "VEHICLE" && l.quantity !== 1) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Priced per vehicle" });
});
export type QuotedLine = z.infer<typeof QuotedLineSchema>;

// The signed BOOKING_QUOTE payload v3. totalPriceCentavos is the sum of PRICED lines (what is
// charged so far); estimatedTotalCentavos adds the FOR_QUOTE references, or is null when some
// FOR_QUOTE line has no reference. No duration, start time or day: the day is chosen at create.
// primaryServiceId (the first base the customer chose) and its queueId are bound (Amendment 1
// A6); lines are canonical: the primary first, then the other bases, then add-ons, each group
// by service ID.
export const BookingQuoteSchema = z.object({
  version: z.literal(3),
  catalogReleaseId: Id,
  catalogFingerprint: Hex,
  pricingAlgorithm: z.literal("php-service-size-v3"),
  vehicleCategoryId: Id,
  primaryServiceId: Id,
  queueId: QueueCodeSchema,
  lines: z.array(QuotedLineSchema).min(1).max(MAX_SELECTION_LINES),
  totalPriceCentavos: Money,
  estimatedTotalCentavos: Money.nullable(),
  currency: z.literal("PHP"),
  issuedAt: Instant,
  expiresAt: Instant,
  quoteToken: z.string().min(1).max(8192),
}).strict().superRefine((q, ctx) => {
  if (new Set(q.lines.map((l) => l.serviceId)).size !== q.lines.length || !q.lines.some((l) => l.kind === "BASE"))
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Lines must be distinct and include a main service" });
  const [first, ...rest] = q.lines;
  const rank = (l: QuotedLine) => (l.kind === "BASE" ? 0 : 1);
  const sorted = rest.every((l, i) => i === 0 || rank(rest[i - 1]) < rank(l) || (rank(rest[i - 1]) === rank(l) && rest[i - 1].serviceId < l.serviceId));
  if (first.kind !== "BASE" || first.serviceId !== q.primaryServiceId || !sorted)
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Lines must start with the primary service, in canonical order" });
  const priced = q.lines.reduce((s, l) => s + (l.subtotalCentavos ?? 0), 0);
  const forQuote = q.lines.filter((l) => l.priceStatus === "FOR_QUOTE");
  const estimated = forQuote.every((l) => l.referenceSubtotalCentavos !== null)
    ? priced + forQuote.reduce((s, l) => s + (l.referenceSubtotalCentavos ?? 0), 0) : null;
  if (priced !== q.totalPriceCentavos || estimated !== q.estimatedTotalCentavos)
    ctx.addIssue({ code: "custom", path: ["totalPriceCentavos"], message: "Invalid totals" });
  if (Date.parse(q.expiresAt) - Date.parse(q.issuedAt) !== 15 * 60_000)
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Quote TTL must be fifteen minutes" });
});
export type BookingQuote = z.infer<typeof BookingQuoteSchema>;
export const selectionOfQuote = (q: Pick<BookingQuote, "vehicleCategoryId" | "lines">): CatalogSelection =>
  ({ vehicleCategoryId: q.vehicleCategoryId, lines: q.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })) });

// Lifecycle envelope: managed conflicts carry only an authorized, PII-free day view.
// Public/create errors leave currentBooking null.
export type LifecycleErrorCode = ErrorCode
  | "CLIENT_UPGRADE_REQUIRED" | "CATALOG_UPDATED" | "QUOTE_EXPIRED"
  | "OPERATION_CLOSED" | "RECOVERY_EXPIRED" | "RECOVERY_UNAVAILABLE"
  | "BOOKING_NOT_MANAGEABLE" | "CUTOFF_PASSED"
  | "CHALLENGE_FAILED" | "ONLINE_BOOKING_UNAVAILABLE" | "BOOKING_LIMIT_REACHED"
  | "SERVICE_NOT_OFFERED" | "QUOTE_REQUIRED" | "FULLY_BOOKED" | "DAY_CLOSED"
  | "UNSUPPORTED_FILE" | "FILE_TOO_LARGE" | "DEPOSIT_PROOF_LIMIT"; // P1-18 deposit proof upload
export interface LifecycleError {
  code: LifecycleErrorCode;
  message: string;
  fieldErrors: Record<string, string[]>;
  retryable: boolean;
  commitState: "NOT_COMMITTED" | "UNKNOWN" | "NOT_APPLICABLE";
  currentQuote: BookingQuote | null;
  currentBooking: import("./contracts").ManagedDayBookingView | null;
  retryAfterSeconds: number | null; // integer >= 1 with 429/503; else null
}
export type LifecycleResult<T> = { ok: true; data: T } | { ok: false; error: LifecycleError };
export type BookingCatalogResponse = LifecycleResult<BookingCatalog>;
export type BookingQuoteResponse = LifecycleResult<{ quote: BookingQuote }>;
