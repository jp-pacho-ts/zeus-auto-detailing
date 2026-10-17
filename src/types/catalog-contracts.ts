// Catalog, price estimate and booking quote v2 contracts (ADR-004; ARCHITECTURE "Amended
// serializable catalog, quote and snapshot contracts", T-042). Public payloads are explicit
// allowlisted projections: no multiplier, bayCapacityRequired, capacity, hold plan, source
// annotation, rating or unverified comparison price.
//
// The release-1 names in ./contracts (VehicleCategory, ServicePackage, BookingCatalog) remain
// only for the old booking wizard until P1-05 moves it to these types; ./contracts re-exports
// this module once those consumers are gone. Create v3, booking snapshots and the managed
// booking views are added by the lifecycle tasks (P1-03, P1-04).
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
export type PublicDuration =
  | { kind: "UNKNOWN" }
  | { kind: "TIMED"; minutes: number }
  | { kind: "MULTI_DAY"; elapsedDays: number | null };
export type ServiceSizeOffer = {
  id: UUID;
  vehicleCategoryId: UUID;
  duration: PublicDuration; // for ADD_ON: incremental duration, not base duration
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
const Minutes = z.number().int().min(1).max(540);
const Instant = z.string().datetime({ precision: 3, offset: false });
const Hex = z.string().regex(/^[a-f0-9]{64}$/);
const Unit = z.enum(["VEHICLE", "PANEL"]);
export const PublicDurationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNKNOWN") }).strict(),
  z.object({ kind: z.literal("TIMED"), minutes: Minutes }).strict(),
  z.object({ kind: z.literal("MULTI_DAY"), elapsedDays: z.number().int().min(1).max(365).nullable() }).strict(),
]) satisfies z.ZodType<PublicDuration>;
const OfferFields = { id: Id, vehicleCategoryId: Id, duration: PublicDurationSchema };
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
  if (o.state === "NOT_OFFERED" && o.duration.kind !== "UNKNOWN")
    ctx.addIssue({ code: "custom", path: ["duration"], message: "Unavailable pair has no duration" });
  if (o.bookingMode === "FIXED_ONLINE" && o.duration.kind !== "TIMED")
    ctx.addIssue({ code: "custom", path: ["duration"], message: "Fixed booking needs known minutes" });
  if (o.state === "OFFERED" && o.compareAtCentavos !== null && o.compareAtCentavos <= o.unitPriceCentavos)
    ctx.addIssue({ code: "custom", path: ["compareAtCentavos"], message: "Comparison must exceed selling price" });
}) satisfies z.ZodType<ServiceSizeOffer>;

// All four fields required, even when quantity=1 and addOnServiceIds=[].
export const CatalogSelectionSchema = z.object({
  serviceId: Id,
  vehicleCategoryId: Id,
  quantity: z.number().int().min(1).max(20),
  addOnServiceIds: z.array(Id).max(2).refine(
    (ids) => new Set(ids).size === ids.length, "Duplicate add-on").refine(
    (ids) => ids.every((id, i) => i === 0 || ids[i - 1] < id), "Use canonical add-on order"),
}).strict();
export type CatalogSelection = z.infer<typeof CatalogSelectionSchema>;
export type GetBookingQuoteRequest = CatalogSelection;
export const GetBookingQuoteSchema = CatalogSelectionSchema;
export const QuotedLineSchema = z.object({
  kind: z.enum(["BASE", "ADD_ON"]),
  serviceId: Id,
  offerId: Id,
  name: z.string().min(1).max(100),
  unit: Unit,
  quantity: z.number().int().min(1).max(20),
  unitPriceCentavos: Money,
  subtotalCentavos: Money,
  addedMinutes: z.number().int().min(0).max(540),
}).strict();
export type QuotedLine = z.infer<typeof QuotedLineSchema>;
export const BookingQuoteSchema = CatalogSelectionSchema.extend({
  version: z.literal(2), // BOOKING_QUOTE payload v2; independent of create version
  catalogReleaseId: Id,
  catalogFingerprint: Hex,
  pricingAlgorithm: z.literal("php-service-size-v2"),
  lines: z.array(QuotedLineSchema).min(1).max(3),
  totalPriceCentavos: Money,
  durationMinutes: Minutes,
  currency: z.literal("PHP"),
  issuedAt: Instant,
  expiresAt: Instant,
  quoteToken: z.string().min(1).max(4096),
}).strict().superRefine((q, ctx) => {
  const base = q.lines[0];
  if (!base) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "A base line is required" });
    return;
  }
  const extras = q.lines.slice(1);
  const expectedIds = [...q.addOnServiceIds].sort();
  const actualIds = extras.map((l) => l.serviceId);
  if (base.kind !== "BASE" || base.serviceId !== q.serviceId || base.quantity !== q.quantity
      || extras.some((l) => l.kind !== "ADD_ON" || l.quantity !== 1)
      || JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Selection and lines disagree" });
  if (q.lines.some((l) => l.subtotalCentavos !== l.unitPriceCentavos * l.quantity
      || (l.unit === "VEHICLE" && l.quantity !== 1))
      || q.lines.reduce((s, l) => s + l.subtotalCentavos, 0) !== q.totalPriceCentavos
      || q.lines.reduce((s, l) => s + l.addedMinutes, 0) !== q.durationMinutes)
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Invalid totals or quantity" });
  const issued = Date.parse(q.issuedAt), expires = Date.parse(q.expiresAt);
  if (expires - issued !== 15 * 60_000)
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Quote TTL must be fifteen minutes" });
});
export type BookingQuote = z.infer<typeof BookingQuoteSchema>;

export interface PriceEstimate {
  catalogReleaseId: UUID;
  selection: CatalogSelection;
  lines: {
    serviceId: UUID; name: string; unit: PriceUnit; quantity: number;
    unitPriceCentavos: number | null; subtotalCentavos: number | null;
  }[];
  totalPriceCentavos: number | null; // null if any price OR fitment is unconfirmed
  currency: "PHP";
  duration: PublicDuration;
}
export type QuoteRequiredReason = "PRICE_UNCONFIRMED" | "ELIGIBILITY_UNCONFIRMED" | "DURATION_UNKNOWN"
  | "MULTI_DAY" | "INSPECTION_REQUIRED" | "ADD_ON_DURATION_UNKNOWN";
export type QuoteDecision =
  | { kind: "BOOKABLE"; quote: BookingQuote }
  | { kind: "QUOTE_REQUIRED"; quote: null; estimate: PriceEstimate; reasons: QuoteRequiredReason[] };

// T-013 lifecycle envelope, with the ADR-004 codes. currentBooking stays null until the
// managed booking view exists (P1-04 widens it).
export type LifecycleErrorCode = ErrorCode
  | "CLIENT_UPGRADE_REQUIRED" | "CATALOG_UPDATED" | "QUOTE_EXPIRED"
  | "OPERATION_CLOSED" | "RECOVERY_EXPIRED" | "RECOVERY_UNAVAILABLE"
  | "BOOKING_NOT_MANAGEABLE" | "CUTOFF_PASSED"
  | "CHALLENGE_FAILED" | "ONLINE_BOOKING_UNAVAILABLE" | "BOOKING_LIMIT_REACHED"
  | "SERVICE_NOT_OFFERED" | "QUOTE_REQUIRED";
export interface LifecycleError {
  code: LifecycleErrorCode;
  message: string;
  fieldErrors: Record<string, string[]>;
  retryable: boolean;
  commitState: "NOT_COMMITTED" | "UNKNOWN" | "NOT_APPLICABLE";
  currentQuote: BookingQuote | null;
  currentBooking: null;
  retryAfterSeconds: number | null; // integer >= 1 with 429/503; else null
}
export type LifecycleResult<T> = { ok: true; data: T } | { ok: false; error: LifecycleError };
export type BookingCatalogResponse = LifecycleResult<BookingCatalog>;
export type BookingQuoteResponse = LifecycleResult<QuoteDecision>;
