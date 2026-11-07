// P1-39: the expense rules that need no database. Money is integer centavos, no floats. Months are Manila calendar months.

export const MAX_EXPENSE_CENTAVOS = 10_000_000_000; // 100,000,000.00 pesos
export const MIN_EXPENSE_DATE = "2020-01-01";
export const RESERVED_CATEGORY_NAMES = ["Stock bought", "Commissions paid"] as const;

/** Pesos typed by a person ("1,250.50" is refused, "1250.50" is not) to whole centavos. Null for anything else: signs, exponents, zero, more than two decimals, over the maximum. */
export function expensePesosToCentavos(text: string): number | null {
  const m = /^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const value = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return value < 1 || value > MAX_EXPENSE_CENTAVOS ? null : value;
}

/** Whole centavos back to the text the form holds ("1250.50"). */
export const centavosToPesosText = (centavos: number): string => `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;

export const isReservedCategoryName = (name: string): boolean => RESERVED_CATEGORY_NAMES.some((r) => r.toLowerCase() === name.trim().toLowerCase());

/** The first and last Manila day of a "YYYY-MM" month, both inclusive. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** The "YYYY-MM" that is `n` months after `month` (n may be negative). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** The 12 months ending at `month`, oldest first. */
export const lastTwelveMonths = (month: string): string[] => Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
