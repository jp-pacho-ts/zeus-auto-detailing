// Pure rules for the queue-model booking wizard (ADR-005, P1-03 create v4). Prices shown here
// are the catalog's own; the server-signed quote stays the authority for every total.
import { brandConfig } from "@/config/brand";
import { CreateDayBookingSchema } from "@/lib/validation";
import type { CreateDayBookingRequest, PublicDayState } from "@/types/contracts";
import type {
  BookingCatalog,
  BookingQuote,
  CatalogSelection,
  LifecycleError,
  ServicePackage,
} from "@/types/catalog-contracts";

export const money = (centavos: number) =>
  new Intl.NumberFormat(brandConfig.locale, { style: "currency", currency: brandConfig.currency }).format(centavos / 100);

const DAY_STATE: Record<PublicDayState, string> = {
  AVAILABLE: "Available",
  FULLY_BOOKED: "Fully booked",
  CLOSED: "Closed",
};
export const dayStateLabel = (state: PublicDayState) => DAY_STATE[state];

const offerFor = (service: ServicePackage, sizeId: string) =>
  service.offers.find((o) => o.vehicleCategoryId === sizeId);

export const isBookable = (service: ServicePackage, sizeId: string) => {
  const offer = offerFor(service, sizeId);
  return Boolean(offer && offer.onlineBooking !== "UNAVAILABLE");
};

// A1/A2: a quote-first line has no charged price; its estimate is the sheet price for the size,
// or the per-panel reference for panel services.
export function offerLabel(service: ServicePackage, sizeId: string, quantity = 1) {
  const offer = offerFor(service, sizeId);
  if (!offer || offer.onlineBooking === "UNAVAILABLE")
    return { bookable: false, forQuote: false, text: "Not offered for this size" };
  if (offer.onlineBooking === "PRICED" && offer.unitPriceCentavos !== null)
    return { bookable: true, forQuote: false, text: money(offer.unitPriceCentavos * quantity) };
  const reference = offer.unitPriceCentavos ?? service.referenceUnitPriceCentavos;
  return {
    bookable: true,
    forQuote: true,
    text: reference === null ? "For quote" : "For quote · est. " + money(reference * quantity),
  };
}

export function availableAddOns(catalog: BookingCatalog, baseIds: string[]): ServicePackage[] {
  const compatible = new Set(
    catalog.addOnCompatibility.filter((c) => baseIds.includes(c.baseServiceId)).map((c) => c.addOnServiceId),
  );
  return catalog.services.filter((s) => s.type === "ADD_ON" && compatible.has(s.id));
}

export type ServicePick = { serviceId: string; quantity: number };

// Chosen bases first, in the customer's order (the first is the primary service and decides the
// queue), then add-ons that still have a chosen compatible base. Unbookable picks drop out.
export function selectionLines(catalog: BookingCatalog, sizeId: string, picks: ServicePick[]): CatalogSelection["lines"] {
  const byId = new Map(catalog.services.map((s) => [s.id, s]));
  const line = (p: ServicePick, s: ServicePackage) => ({
    serviceId: s.id,
    quantity: s.unit === "PANEL" ? Math.min(20, Math.max(1, Math.trunc(p.quantity) || 1)) : 1,
  });
  const bookable = picks.filter((p) => {
    const s = byId.get(p.serviceId);
    return s !== undefined && isBookable(s, sizeId);
  });
  const bases = bookable.filter((p) => byId.get(p.serviceId)!.type === "BASE");
  const addOnIds = new Set(availableAddOns(catalog, bases.map((p) => p.serviceId)).map((s) => s.id));
  const addOns = bookable.filter((p) => addOnIds.has(p.serviceId));
  return [...bases, ...addOns].map((p) => line(p, byId.get(p.serviceId)!));
}

type Totals = Pick<BookingQuote, "totalPriceCentavos" | "estimatedTotalCentavos"> & { lines: { priceStatus: "PRICED" | "FOR_QUOTE" }[] };

export function quoteTotal(q: Totals) {
  const forQuote = q.lines.filter((l) => l.priceStatus === "FOR_QUOTE").length;
  if (!forQuote) return { label: "Total", amount: money(q.totalPriceCentavos), note: null };
  return {
    label: "Estimated total",
    amount: q.estimatedTotalCentavos === null ? "To be quoted" : money(q.estimatedTotalCentavos),
    note:
      forQuote === 1
        ? "1 service is for quote. The shop confirms its final price."
        : forQuote + " services are for quote. The shop confirms their final price.",
  };
}

// ADR-005 §5: PPF, repaint and coating are multi-day jobs; the chosen day is the drop-off day.
const MULTI_DAY = new Set(["GRAPHENE", "PPF", "REPAINT"]);
export function isMultiDay(catalog: BookingCatalog, serviceIds: string[]): boolean {
  return catalog.services.some(
    (s) =>
      serviceIds.includes(s.id) &&
      (MULTI_DAY.has(s.category) || s.offers.some((o) => o.duration.kind === "MULTI_DAY")),
  );
}

// Website links use the size code, its name, or the home page's older words.
const SIZE_ALIASES: Record<string, string> = { sedan: "S", motorcycle: "MOTOR", motor: "MOTOR" };
export function resolveDeepLink(catalog: BookingCatalog, vehicle?: string, service?: string) {
  const v = vehicle?.trim().toLowerCase() ?? "", s = service?.trim().toLowerCase() ?? "";
  if (!v && !s) return { vehicleId: null, serviceId: null, unknown: false };
  const size = v
    ? catalog.vehicleCategories.find(
        (c) => c.id.toLowerCase() === v || c.code.toLowerCase() === v || c.code === SIZE_ALIASES[v] || c.name.toLowerCase() === v,
      )
    : undefined;
  const svc = s
    ? catalog.services.find((x) => x.type === "BASE" && (x.id.toLowerCase() === s || x.slug === s || x.name.toLowerCase() === s))
    : undefined;
  if ((v && !size) || (s && !svc)) return { vehicleId: null, serviceId: null, unknown: true };
  return { vehicleId: size?.id ?? null, serviceId: svc?.id ?? null, unknown: false };
}

export interface DetailsForm {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vehicleModel: string;
  vehiclePlate: string;
  specialRequests: string;
}

const normalizePhone = (raw: string) => {
  const clean = raw.replace(/[\s()-]/g, "");
  return /^9\d{9}$/.test(clean) ? "+63" + clean : clean;
};
const blankToUndefined = (s: string) => (s.trim() === "" ? undefined : s);

// The create body takes its lines from the signed quote, so they match it exactly (canonical order).
export function createDayRequest(input: {
  form: DetailsForm;
  quote: BookingQuote;
  bookingDate: string;
  turnstileToken: string;
  idempotencyKey: string;
}): { ok: true; data: CreateDayBookingRequest } | { ok: false; fieldErrors: Record<string, string[]> } {
  const { form, quote } = input;
  const parsed = CreateDayBookingSchema.safeParse({
    contractVersion: 4,
    idempotencyKey: input.idempotencyKey,
    vehicleCategoryId: quote.vehicleCategoryId,
    lines: quote.lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity })),
    bookingDate: input.bookingDate,
    acceptedQuote: quote,
    turnstileToken: input.turnstileToken,
    customerName: form.customerName,
    customerPhone: normalizePhone(form.customerPhone),
    customerEmail: blankToUndefined(form.customerEmail),
    vehicleModel: form.vehicleModel,
    vehiclePlate: blankToUndefined(form.vehiclePlate),
    specialRequests: blankToUndefined(form.specialRequests),
  });
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  if (fieldErrors.turnstileToken) fieldErrors.turnstileToken = ["Complete the security check."];
  return { ok: false, fieldErrors };
}

export type WizardStep = "SIZE" | "SERVICES" | "DAY" | "DETAILS";
// Only the customer's own form fields are ever echoed back.
const FORM_FIELDS = new Set(["customerName", "customerPhone", "customerEmail", "vehicleModel", "vehiclePlate", "specialRequests", "turnstileToken", "bookingDate"]);

// The server's errors default commitState to UNKNOWN, including refusals made before any commit
// (challenge, budgets, pause, validation). Only RETRYABLE_ERROR leaves the outcome unconfirmed: then
// the same attempt (same retry key) is retried, which replays a committed booking safely.
export function publicCreateError(error: LifecycleError) {
  const uncertain = error.code === "RETRYABLE_ERROR";
  const fieldErrors = Object.fromEntries(Object.entries(error.fieldErrors).filter(([k]) => FORM_FIELDS.has(k)));
  const day = error.code === "FULLY_BOOKED" || error.code === "DAY_CLOSED";
  const services = ["CATALOG_UPDATED", "SERVICE_NOT_OFFERED", "QUOTE_REQUIRED", "NOT_FOUND"].includes(error.code);
  return {
    message: error.message,
    fieldErrors,
    step: (day ? "DAY" : services ? "SERVICES" : "DETAILS") as WizardStep,
    refreshDays: day,
    refreshQuote: error.code === "QUOTE_EXPIRED" || services,
    // Cloudflare tokens are single use, so every answer needs a fresh one (it is not part of the
    // retry key's request hash, so an unconfirmed attempt can carry a new token).
    newChallenge: true,
    uncertain,
  };
}
