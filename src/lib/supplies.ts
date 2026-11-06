// P1-38: the supply rules that need no database. Money is integer centavos, stock is a whole number, no floats.

export const MAX_STOCK = 1_000_000_000;
export const MAX_COST_CENTAVOS = 100_000_000; // 1,000,000.00 pesos per unit

/** Pesos typed by a person ("125.50") to whole centavos. Null for anything else: signs, exponents, more than two decimals, over 1,000,000.00. Zero is allowed. */
export function pesosToCentavos(text: string): number | null {
  const m = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return value > MAX_COST_CENTAVOS ? null : value;
}

export type StockStatus = "NONE" | "OK" | "LOW" | "OUT";

/** The badge. A reorder level of 0 means "no alert": no badge, even at stock 0. Otherwise OUT at 0, LOW at or under the level, else OK. */
export function stockStatus(stock: number, reorderLevel: number): StockStatus {
  if (reorderLevel <= 0) return "NONE";
  if (stock <= 0) return "OUT";
  return stock <= reorderLevel ? "LOW" : "OK";
}
