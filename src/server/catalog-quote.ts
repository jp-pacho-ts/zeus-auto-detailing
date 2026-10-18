import "server-only";
import { GetBookingQuoteSchema, MAX_SELECTION_LINES, selectionOfQuote, type BookingQuote, type BookingQuoteResponse, type LifecycleError } from "@/types/catalog-contracts";
import { catalogError, catalogUnavailable, catalogValidationError } from "./catalog-errors";
import { priceSelection, type ReleaseSnapshot, type UnsignedQuote } from "./catalog-pricing";
import { quoteKeyRing, signQuote, verifyQuote, type QuoteKeyRing } from "./catalog-quote-token";
import { loadCurrentRelease, readPublicCatalog, type CatalogReadOptions, type CatalogTx } from "./catalog-read";

// Booking quote v3 (ADR-005): every valid selection gets one signed quote. PRICED lines carry the
// charged price; FOR_QUOTE lines carry only a reference estimate until ADMIN sets a price. The
// price always comes from the current release, never the client. No duration, time or day.
export interface QuoteOptions extends CatalogReadOptions { ring?: QuoteKeyRing; now?: () => Date }

export async function getBookingQuote(input: unknown, options: QuoteOptions = {}): Promise<BookingQuoteResponse> {
  const parsed = GetBookingQuoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: catalogValidationError(parsed.error.issues) };
  try {
    const priced = await readPublicCatalog((release) => release && priceSelection(release, parsed.data), options);
    if (!priced) return { ok: false, error: catalogUnavailable() };
    if (priced.kind === "REJECTED") return { ok: false, error: catalogError(priced.error.code, priced.error.message, { fieldErrors: priced.error.fieldErrors }) };
    // Fail closed without a valid key ring: no unsigned or default-signed quote.
    return { ok: true, data: { quote: signQuote(priced.quote, options.ring ?? quoteKeyRing(), options.now?.() ?? new Date()) } };
  } catch {
    return { ok: false, error: catalogUnavailable() };
  }
}

// GET /api/bookings/quote adapter: exactly vehicleCategoryId and lines, each once. lines is one
// comma-separated list of serviceId:quantity in the customer's order, quantity canonical decimal
// 1..20; the schema then validates the parsed numbers and IDs, never coercing strings.
export function parseBookingQuoteQuery(params: URLSearchParams): { ok: true; data: unknown } | { ok: false; error: LifecycleError } {
  const keys = [...params.keys()];
  if (keys.length !== 2 || keys.filter((k) => k === "vehicleCategoryId").length !== 1 || keys.filter((k) => k === "lines").length !== 1) {
    return { ok: false, error: catalogError("VALIDATION_ERROR", "Send exactly vehicleCategoryId and lines.") };
  }
  const items = params.get("lines")!.split(",");
  if (items.length > MAX_SELECTION_LINES || items.some((item) => !/^[^:,]+:(?:[1-9]|1\d|20)$/.test(item))) {
    return { ok: false, error: catalogError("VALIDATION_ERROR", "Please check the selected services.", { fieldErrors: { lines: ["Use serviceId:quantity items, quantity 1 to 20."] } }) };
  }
  const lines = items.map((item) => { const [serviceId, quantity] = item.split(":"); return { serviceId, quantity: Number(quantity) }; });
  return { ok: true, data: { vehicleCategoryId: params.get("vehicleCategoryId"), lines } };
}

// On success, priced is the server's own computation (equal to the accepted quote in every
// priced field): booking line snapshots copy priced.lines, and the booking joins
// priced.queueId (the queue of priced.primaryServiceId), never the client's object.
export type AcceptedQuoteCheck =
  | { ok: true; quote: BookingQuote; priced: UnsignedQuote; release: ReleaseSnapshot }
  | { ok: false; error: LifecycleError };

const pricedFields = (q: UnsignedQuote) => JSON.stringify([q.version, q.catalogReleaseId, q.catalogFingerprint, q.pricingAlgorithm, q.vehicleCategoryId,
  q.primaryServiceId, q.queueId, q.lines.map((l) => [l.serviceId, l.offerId, l.kind, l.name, l.unit, l.quantity, l.priceStatus, l.unitPriceCentavos, l.subtotalCentavos,
    l.referenceUnitPriceCentavos, l.referenceSubtotalCentavos]), q.totalPriceCentavos, q.estimatedTotalCentavos, q.currency]);

// For create (P1-03), inside its transaction under the canonical shop lock, after replay
// handling: authenticate the accepted quote, then recompute it from the current release.
// Precedence: invalid MAC/binding 400 with no fresh quote; a different release or changed
// pricing 409 CATALOG_UPDATED with a fresh quote when the selection is still bookable; a
// selection the current release refuses keeps that rejection; unchanged but expired 409
// QUOTE_EXPIRED with a fresh quote. Rejections are definitive business decisions (NOT_COMMITTED).
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
  const fresh = priceSelection(release, selectionOfQuote(quote));
  const freshQuote = fresh.kind === "QUOTED" ? signQuote(fresh.quote, ring, now) : null;
  // Every priced field, not just the fingerprint: a signature proves origin, not correctness.
  const unchanged = release.releaseId === quote.catalogReleaseId && fresh.kind === "QUOTED" && pricedFields(fresh.quote) === pricedFields(quote);
  if (!unchanged) {
    if (fresh.kind === "REJECTED" && release.releaseId === quote.catalogReleaseId) return reject(fresh.error.code, fresh.error.message, null, fresh.error.fieldErrors);
    return reject("CATALOG_UPDATED", freshQuote ? "Prices or services changed. Review the new quote to continue."
      : "This selection can't be booked online anymore. Choose other services or contact the shop.", freshQuote,
    freshQuote ? {} : { lines: ["Choose other services or contact the shop."] });
  }
  if (verified.expired) return reject("QUOTE_EXPIRED", "Your quote expired. Review the new quote to continue.", freshQuote);
  return { ok: true, quote, priced: fresh.quote, release };
}
