// P1-38: the plain-language rules for the Supplies screen. No React, no network, so they are unit tested.
import { formatPesos } from "@/lib/commission";
import { MAX_STOCK } from "@/lib/supplies";
import type { AdminSupplyItem, AdminSupplyMovement, AdminSupplyStatus } from "@/types/admin-contracts";

export const SUPPLIES_INTRO = "Keep track of what you have and what you use.";
export const SUPPLIES_EMPTY = "No supplies yet. Add your first supply.";
export const SUPPLIES_NO_MATCH = "No supplies match your search.";

/** Name or category, ignoring case and surrounding spaces. An empty search matches everything. */
export function matchesSearch(item: Pick<AdminSupplyItem, "name" | "category">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q);
}

/** The badge text; null when the reorder level is 0 (no alert, no badge). */
export function badgeLabel(status: AdminSupplyStatus): string | null {
  return status === "NONE" ? null : status === "OK" ? "OK" : status === "LOW" ? "Low" : "Out";
}

export function summaryLine(count: number, lowOrOut: number): string {
  if (count === 0) return "No supplies yet.";
  return `${count} ${count === 1 ? "supply" : "supplies"} · ${lowOrOut === 0 ? "none low" : `${lowOrOut} low or out`}`;
}

export const costLabel = (centavos: number): string => `${formatPesos(centavos)} each`;

/** The delete dialog: an item that was never used is erased, one with a history is hidden (archived) and can come back. */
export function removeWarning(item: Pick<AdminSupplyItem, "name" | "hasHistory">): string {
  return item.hasHistory
    ? `${item.name} has a history, so it will be hidden (archived) and its history kept. You can bring it back later.`
    : `${item.name} was never used, so it will be deleted for good.`;
}
export function removeResult(outcome: "DELETED" | "ARCHIVED", name: string): string {
  return outcome === "DELETED" ? `${name} was deleted.` : `${name} has a history, so it was hidden instead. Turn on Show archived to bring it back.`;
}

/** What is left after a movement, and the plain reason it cannot be saved (null when it can). */
export function stockPreview(item: Pick<AdminSupplyItem, "currentStock">, kind: "RECEIVE" | "USE", quantity: number): { after: number; problem: string | null } {
  if (!Number.isInteger(quantity) || quantity < 1) return { after: item.currentStock, problem: "Enter a whole number of 1 or more." };
  const after = kind === "RECEIVE" ? item.currentStock + quantity : item.currentStock - quantity;
  if (after < 0) return { after: item.currentStock, problem: `Not enough stock. Only ${item.currentStock} left.` };
  if (after > MAX_STOCK) return { after: item.currentStock, problem: "That is more than the largest stock we can hold." };
  return { after, problem: null };
}

const KIND = { OPENING: "Starting stock", RECEIVE: "Stock in", USE: "Used" } as const;
export function movementLine(m: AdminSupplyMovement): string {
  const sign = m.delta > 0 ? "+" : "";
  return [`${KIND[m.kind]} ${sign}${m.delta} → ${m.stockAfter}`, m.unitCostCentavos === null ? null : costLabel(m.unitCostCentavos), m.note].filter(Boolean).join(" · ");
}
