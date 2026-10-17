import "server-only";
import { GetBookingQuoteSchema, type BookingQuote, type BookingQuoteResponse, type CatalogSelection, type LifecycleError } from "@/types/catalog-contracts";
import { catalogError, catalogUnavailable, catalogValidationError } from "./catalog-errors";
import { priceSelection, type PricingResult, type ReleaseSnapshot, type UnsignedQuote } from "./catalog-pricing";
import { quoteKeyRing, signQuote, verifyQuote, type QuoteKeyRing } from "./catalog-quote-token";
import { loadCurrentRelease, readPublicCatalog, type CatalogReadOptions, type CatalogTx } from "./catalog-read";

// Booking quote v2 (ADR-004): a signed quote for a plain fixed wash, otherwise an unsigned
// quote-first estimate. The price always comes from the current release, never the client.
export interface QuoteOptions extends CatalogReadOptions { ring?: QuoteKeyRing; now?: () => Date }

export async function getBookingQuote(input: unknown, options: QuoteOptions = {}): Promise<BookingQuoteResponse> {
  const parsed = GetBookingQuoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: catalogValidationError(parsed.error.issues) };
  try {
    const priced = await readPublicCatalog((release) => release && priceSelection(release, parsed.data), options);
    if (!priced) return { ok: false, error: catalogUnavailable() };
    if (priced.kind === "REJECTED") return { ok: false, error: catalogError(priced.error.code, priced.error.message, { fieldErrors: priced.error.fieldErrors }) };
    if (priced.kind === "QUOTE_REQUIRED") return { ok: true, data: { kind: "QUOTE_REQUIRED", quote: null, estimate: priced.estimate, reasons: priced.reasons } };
    // Fail closed without a valid key ring: no unsigned or default-signed quote.
    return { ok: true, data: { kind: "BOOKABLE", quote: signQuote(priced.quote, options.ring ?? quoteKeyRing(), options.now?.() ?? new Date()) } };
  } catch {
    return { ok: false, error: catalogUnavailable() };
  }
}

// GET /api/bookings/quote adapter: exactly serviceId, vehicleCategoryId, quantity and
// addOnServiceIds (one comma-separated list, empty for none), each once. quantity is canonical
// decimal 1..20; the schema then validates the parsed numbers and IDs, never coercing strings.
const QUERY_KEYS = ["serviceId", "vehicleCategoryId", "quantity", "addOnServiceIds"];
export function parseBookingQuoteQuery(params: URLSearchParams): { ok: true; data: unknown } | { ok: false; error: LifecycleError } {
  const keys = [...params.keys()];
  if (keys.length !== QUERY_KEYS.length || !QUERY_KEYS.every((k) => keys.filter((x) => x === k).length === 1)) {
    return { ok: false, error: catalogError("VALIDATION_ERROR", "Send exactly serviceId, vehicleCategoryId, quantity and addOnServiceIds.") };
  }
  const quantity = params.get("quantity")!;
  if (!/^(?:[1-9]|1\d|20)$/.test(quantity)) {
    return { ok: false, error: catalogError("VALIDATION_ERROR", "Please check the quantity.", { fieldErrors: { quantity: ["Choose a whole number from 1 to 20."] } }) };
  }
  const list = params.get("addOnServiceIds")!;
  const addOnServiceIds = list === "" ? [] : list.split(",");
  if (addOnServiceIds.some((id) => id === "")) {
    return { ok: false, error: catalogError("VALIDATION_ERROR", "Please check the add-ons.", { fieldErrors: { addOnServiceIds: ["Use one comma-separated list of add-ons."] } }) };
  }
  return { ok: true, data: { serviceId: params.get("serviceId"), vehicleCategoryId: params.get("vehicleCategoryId"), quantity: Number(quantity), addOnServiceIds } };
}

// On success, priced is the server's own computation (equal to the accepted quote in every
// priced field): booking snapshots copy priced.lines, never the client's object.
export type AcceptedQuoteCheck =
  | { ok: true; quote: BookingQuote; priced: UnsignedQuote; release: ReleaseSnapshot }
  | { ok: false; error: LifecycleError };

const pricedFields = (q: UnsignedQuote) => JSON.stringify([q.serviceId, q.vehicleCategoryId, q.quantity, q.addOnServiceIds, q.version,
  q.catalogReleaseId, q.catalogFingerprint, q.pricingAlgorithm, q.lines.map((l) => [l.kind, l.serviceId, l.offerId, l.name, l.unit,
    l.quantity, l.unitPriceCentavos, l.subtotalCentavos, l.addedMinutes]), q.totalPriceCentavos, q.durationMinutes, q.currency]);

// For create (P1-03), inside its transaction under the canonical shop lock, after replay
// handling: authenticate the accepted quote, then recompute it from the current release.
// Precedence (ARCHITECTURE T-042): invalid MAC/binding 400 with no fresh quote; a different
// release or changed pricing 409 CATALOG_UPDATED with a fresh quote only if still bookable;
// quote-first 409 QUOTE_REQUIRED; unchanged but expired 409 QUOTE_EXPIRED with a fresh quote.
// Rejections are definitive business decisions (NOT_COMMITTED).
export async function checkAcceptedQuote(tx: CatalogTx, candidate: unknown, options: { ring?: QuoteKeyRing; now?: () => Date } = {}): Promise<AcceptedQuoteCheck> {
  const ring = options.ring ?? quoteKeyRing();
  const now = options.now?.() ?? new Date();
  const reject = (code: Parameters<typeof catalogError>[0], message: string, currentQuote: BookingQuote | null = null, fieldErrors: Record<string, string[]> = {}): AcceptedQuoteCheck =>
    ({ ok: false, error: catalogError(code, message, { commitState: "NOT_COMMITTED", currentQuote, fieldErrors }) });
  const verified = verifyQuote(candidate, ring, now);
  if (!verified.ok) return reject("VALIDATION_ERROR", "This price quote isn't valid. Get a new quote and try again.", null, { acceptedQuote: ["Get a new quote."] });
  const quote = verified.quote;
  const release = await loadCurrentRelease(tx);
  if (!release) throw new Error("No published catalog release");
  const selection: CatalogSelection = { serviceId: quote.serviceId, vehicleCategoryId: quote.vehicleCategoryId, quantity: quote.quantity, addOnServiceIds: quote.addOnServiceIds };
  const fresh: PricingResult = priceSelection(release, selection);
  const freshQuote = fresh.kind === "BOOKABLE" ? signQuote(fresh.quote, ring, now) : null;
  // Every priced field, not just the fingerprint: a signature proves origin, not correctness.
  const unchanged = release.releaseId === quote.catalogReleaseId && fresh.kind === "BOOKABLE" && pricedFields(fresh.quote) === pricedFields(quote);
  if (release.releaseId !== quote.catalogReleaseId || (fresh.kind === "BOOKABLE" && !unchanged)) {
    return reject("CATALOG_UPDATED", freshQuote ? "Prices or services changed. Review the new quote to continue."
      : "This selection can't be booked online anymore. Choose another service or contact the shop.", freshQuote,
    freshQuote ? {} : { serviceId: ["Choose another service or contact the shop."] });
  }
  if (fresh.kind === "REJECTED") return reject(fresh.error.code, fresh.error.message, null, fresh.error.fieldErrors);
  if (fresh.kind === "QUOTE_REQUIRED") return reject("QUOTE_REQUIRED", "This service needs a quote from the shop before it can be booked.");
  if (verified.expired) return reject("QUOTE_EXPIRED", "Your quote expired. Review the new quote to continue.", freshQuote);
  return { ok: true, quote, priced: fresh.quote, release };
}
