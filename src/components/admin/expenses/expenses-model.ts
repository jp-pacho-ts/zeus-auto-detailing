// P1-39: the plain-language rules for the Expenses screen. No React, no network, so they are unit tested.
import type { AdminExpense, AdminExpenseEvent, AdminExpenseMonth } from "@/types/admin-contracts";
import { formatPesos } from "@/lib/commission";

export const EXPENSES_INTRO = "What the shop spent. Stock bought and commissions paid are added for you, so never type those in.";
export const EXPENSES_EMPTY = "No expenses typed in for this month.";
export const EXPENSES_NO_MATCH = "No expenses match your search.";
export const REMOVE_TEXT = "It will be hidden and kept in history. You can bring it back.";
export const NOT_ADMIN_TEXT = "Only an admin can see expenses.";

/** A total as a decimal string of centavos ("100000000000000000") to "₱1,000,000,000,000,000.00". A total can pass a safe integer, so this stays in bigint. */
export function formatTotal(centavos: string): string {
  const big = BigInt(centavos);
  const abs = big < BigInt(0) ? -big : big;
  const pesos = (abs / BigInt(100)).toLocaleString("en-PH");
  return `${big < BigInt(0) ? "-" : ""}₱${pesos}.${String(abs % BigInt(100)).padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" to "November 2026". */
export const monthLabel = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** "2026-11" to "Nov": for the 12-month strip. */
export const shortMonth = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1].slice(0, 3);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
export const stockLine = (m: Pick<AdminExpenseMonth, "totals" | "pricedStockIns">): string => `Stock bought (from Supplies): ${formatTotal(m.totals.stockBought)} from ${plural(m.pricedStockIns, "stock-in")}`;
export const commissionsLine = (m: Pick<AdminExpenseMonth, "totals">): string => `Commissions paid: ${formatTotal(m.totals.commissionsPaid)}`;
/** Said only when there is something to say. */
export const unpricedNote = (n: number): string | null => (n === 0 ? null : `${plural(n, "stock-in")} had no price and ${n === 1 ? "is" : "are"} not counted.`);
export const owedNote = (centavos: string): string | null => (BigInt(centavos) === BigInt(0) ? null : `Still owed in commissions, not yet paid and not in this total: ${formatTotal(centavos)}`);
export const COMMISSIONS_HINT = "A commission counts on the day it is marked paid. If a payment is un-marked, this month's total changes.";

/** Payee or note, ignoring case and surrounding spaces. An empty search matches everything. */
export function matchesExpenseSearch(e: Pick<AdminExpense, "payee" | "note">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || (e.payee ?? "").toLowerCase().includes(q) || (e.note ?? "").toLowerCase().includes(q);
}

const KIND = { CREATED: "Added", EDITED: "Changed", VOIDED: "Removed", RESTORED: "Restored" } as const;
/** One history row: what happened and the values as they were then. */
export function historyLine(h: Pick<AdminExpenseEvent, "kind" | "amountCentavos" | "categoryName" | "expenseDate" | "payee" | "note" | "reason">): string {
  return [KIND[h.kind], formatPesos(h.amountCentavos), h.categoryName, h.expenseDate, h.payee, h.note, h.reason ? `Reason: ${h.reason}` : null].filter(Boolean).join(" · ");
}
