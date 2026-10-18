import "server-only";
import type { AdminTotals } from "@/types/admin-contracts";

// P1-02 R27: totals are computed from the lines, never stored. A line's effective price is the
// ADMIN-set price, else its charged subtotal. Removed lines don't count. The estimate adds the
// references of unpriced lines and is null while one of them has no reference.
export interface TotalsLine {
  priceStatus: "PRICED" | "FOR_QUOTE" | null;
  subtotalCentavos: number | null;
  referenceSubtotalCentavos: number | null;
  staffPriceCentavos: number | null;
  removed: boolean;
}

export const effectivePrice = (l: TotalsLine): number | null => l.staffPriceCentavos ?? (l.priceStatus === "FOR_QUOTE" ? null : l.subtotalCentavos);

export function bookingTotals(lines: readonly TotalsLine[], receipt: { receiptTotalCentavos: number | null; receiptEstimatedCentavos: number | null }): AdminTotals {
  let total = 0, estimate: number | null = 0, forQuote = 0;
  for (const l of lines) {
    if (l.removed) continue;
    const price = effectivePrice(l);
    if (price !== null) { total += price; continue; }
    forQuote++;
    estimate = estimate === null || l.referenceSubtotalCentavos === null ? null : estimate + l.referenceSubtotalCentavos;
  }
  return { ...receipt, currentTotalCentavos: total, currentEstimateCentavos: estimate === null ? null : total + estimate, forQuoteCount: forQuote };
}
