"use client";
import * as React from "react";
import {
  Boxes,
  Plus,
  Search,
  Filter,
  History as HistoryIcon,
  Edit2,
  Trash2,
  RotateCcw,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  X,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPesos } from "@/lib/commission";
import type { AdminSupplyItem, AdminSupplyList } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { HistoryDialog } from "./history-dialog";
import { StockDialog } from "./stock-dialog";
import {
  badgeLabel,
  costLabel,
  matchesSearch,
  removeResult,
  removeWarning,
  SUPPLIES_EMPTY,
  SUPPLIES_INTRO,
  SUPPLIES_NO_MATCH,
  summaryLine,
} from "./supplies-model";

const buttonClass =
  "inline-flex min-h-[44px] items-center justify-center rounded border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

const badgeClass = {
  Low: "border-amber-400/60 bg-amber-500/10 text-amber-300",
  Out: "border-rose-400/60 bg-rose-500/10 text-rose-300",
  OK: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",
} as const;

type Form = { name: string; category: string; unit: string; reorder: string; cost: string; stock: string };
const EMPTY: Form = { name: "", category: "", unit: "", reorder: "0", cost: "0", stock: "0" };
const whole = (text: string) => (/^[0-9]+$/.test(text.trim()) ? Number(text.trim()) : null);

export function SuppliesPanel({
  list,
  showArchived,
  setShowArchived,
  reload,
}: {
  list: AdminSupplyList;
  showArchived: boolean;
  setShowArchived: (on: boolean) => void;
  reload: () => unknown;
}) {
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "LOW_OUT" | "OK">("ALL");
  const [editing, setEditing] = React.useState<AdminSupplyItem | "new" | null>(null);
  const [form, setForm] = React.useState<Form>(EMPTY);
  const [formId, setFormId] = React.useState("");
  const [removing, setRemoving] = React.useState<AdminSupplyItem | null>(null);
  const [stockFor, setStockFor] = React.useState<{ item: AdminSupplyItem; kind: "RECEIVE" | "USE" } | null>(null);
  const [historyFor, setHistoryFor] = React.useState<AdminSupplyItem | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const writing = React.useRef(false);

  // Categories extraction for filter dropdown
  const uniqueCategories = React.useMemo(() => {
    const cats = new Set<string>();
    list.items.forEach((i) => {
      if (i.category && i.category.trim()) cats.add(i.category.trim());
    });
    return Array.from(cats).sort();
  }, [list.items]);

  async function run(work: () => Promise<string | null>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      await reload(); // the message appears with the fresh list, never above stale data
      setNotice(message);
      return true;
    } catch (e) {
      setError(describeError(e));
      if (e instanceof AdminRequestError && e.status === 409) await reload();
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function open(target: AdminSupplyItem | "new") {
    setError(null);
    setFormId(crypto.randomUUID());
    setForm(
      target === "new"
        ? EMPTY
        : {
            name: target.name,
            category: target.category ?? "",
            unit: target.unit,
            reorder: String(target.reorderLevel),
            cost: (target.costPerUnitCentavos / 100).toFixed(2),
            stock: String(target.currentStock),
          },
    );
    setEditing(target);
  }

  const change = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFormId(crypto.randomUUID());
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const target = editing;
    if (!target) return;
    const reorder = whole(form.reorder);
    const stockVal = form.stock.trim() === "" ? 0 : whole(form.stock);
    if (reorder === null || stockVal === null || stockVal < 0) {
      setError("Enter valid whole numbers (0 or higher) for the reorder level and stock count.");
      return;
    }
    const ok = await run(async () => {
      if (target === "new") {
        await adminRequest("/api/admin/supplies", {
          method: "POST",
          body: {
            id: formId,
            name: form.name,
            ...(form.category.trim() ? { category: form.category } : {}),
            unit: form.unit,
            reorderLevel: reorder,
            costPesos: form.cost.trim(),
            ...(stockVal > 0 ? { startingStock: stockVal } : {}),
          },
        });
        return `${form.name.trim()} was added with ${stockVal} ${form.unit} starting stock.`;
      }
      const updated = await adminRequest<AdminSupplyItem>(`/api/admin/supplies/${target.id}`, {
        method: "PATCH",
        body: {
          expectedRevision: target.revision,
          name: form.name,
          category: form.category.trim() ? form.category : null,
          unit: form.unit,
          reorderLevel: reorder,
          costPesos: form.cost.trim(),
        },
      });
      const diff = stockVal - target.currentStock;
      if (diff !== 0) {
        await adminRequest(`/api/admin/supplies/${target.id}/stock`, {
          method: "POST",
          body: {
            id: crypto.randomUUID(),
            expectedRevision: updated.revision,
            kind: diff > 0 ? "RECEIVE" : "USE",
            quantity: Math.abs(diff),
            note: "Adjusted in Edit dialog",
          },
        });
      }
      return `${form.name.trim()} was updated (${stockVal} ${form.unit} in stock).`;
    });
    if (ok) setEditing(null);
  }

  async function confirmRemove() {
    const target = removing;
    if (!target) return;
    const ok = await run(async () => {
      try {
        const result = await adminRequest<{ outcome: "DELETED" | "ARCHIVED" }>(
          `/api/admin/supplies/${target.id}/remove`,
          { method: "POST", body: { expectedRevision: target.revision } },
        );
        return removeResult(result.outcome, target.name);
      } catch (e) {
        if (e instanceof AdminRequestError && e.status === 404) return removeResult("DELETED", target.name);
        throw e;
      }
    });
    if (ok) setRemoving(null);
  }

  const restore = (item: AdminSupplyItem) =>
    run(async () => {
      await adminRequest(`/api/admin/supplies/${item.id}/restore`, {
        method: "POST",
        body: { expectedRevision: item.revision },
      });
      return `${item.name} is back.`;
    });

  // Filter items
  const filtered = list.items.filter((i) => {
    if (!matchesSearch(i, query)) return false;
    if (categoryFilter !== "ALL" && (i.category || "") !== categoryFilter) return false;
    if (statusFilter === "LOW_OUT" && !(i.status === "LOW" || i.status === "OUT")) return false;
    if (statusFilter === "OK" && i.status !== "OK") return false;
    return true;
  });

  const activeCount = list.items.filter((i) => i.isActive).length;
  const outOfStockCount = list.items.filter((i) => i.isActive && i.status === "OUT").length;

  const totalUnitsInStock = React.useMemo(() => {
    return list.items
      .filter((i) => i.isActive)
      .reduce((sum, i) => sum + i.currentStock, 0);
  }, [list.items]);

  const totalInventoryValueCentavos = React.useMemo(() => {
    return list.items
      .filter((i) => i.isActive)
      .reduce((sum, i) => sum + BigInt(i.currentStock) * BigInt(i.costPerUnitCentavos), BigInt(0));
  }, [list.items]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * pageSize;
  const paginatedItems = filtered.slice(startIndex, startIndex + pageSize);

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setCurrentPage(1);
  }

  function handleCategoryFilterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCategoryFilter(e.target.value);
    setCurrentPage(1);
  }

  function handleStatusFilterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setStatusFilter(e.target.value as "ALL" | "LOW_OUT" | "OK");
    setCurrentPage(1);
  }

  return (
    <section aria-labelledby="supplies-heading" className="space-y-6">
      {/* Top Header & Metrics */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="supplies-heading" className="text-xl font-bold tracking-tight text-foreground">
            Supplies &amp; Inventory
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{SUPPLIES_INTRO}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="gold"
            className="min-h-[44px] text-xs font-semibold gap-1.5 shadow-sm"
            onClick={() => open("new")}
          >
            <Plus className="h-4 w-4" />
            Add item
          </Button>
        </div>
      </div>

      {/* KPI Cards: 4 Tiles with Active Items, Total Units, Inventory Value, and Low/Out alerts */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-[#141416] p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Active Products</p>
            <p className="text-2xl font-bold text-foreground mt-1">{activeCount}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Catalog product lines</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-[#1c1c20] text-primary">
            <Boxes className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[#141416] p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Total Units on Hand</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1 font-mono">
              {totalUnitsInStock.toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Physical items in shop</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[#141416] p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Total Inventory Value</p>
            <p className="text-2xl font-bold text-amber-400 mt-1 font-mono">
              {formatPesos(Number(totalInventoryValueCentavos))}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">At unit replacement cost</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400">
            <Wallet className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-[#141416] p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Low or Out of Stock</p>
            <p className="text-2xl font-bold text-rose-400 mt-1">{list.lowOrOutCount}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {outOfStockCount > 0 ? `${outOfStockCount} completely out` : "Needs restocking"}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Notice & Error Banners */}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-400/70 hover:text-emerald-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && !editing && !removing && !stockFor && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-rose-400/70 hover:text-rose-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Table Container */}
      <div className="rounded-xl border border-border bg-[#141416] shadow-sm">
        {/* Search & Filter Toolbar */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search by name or category..."
              autoComplete="off"
              className="w-full rounded-md border border-border bg-[#1a1a1e] pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-[#1a1a1e] px-2.5 py-1 text-xs text-muted-foreground">
              <Filter className="h-3 w-3" />
              <span>Category:</span>
              <select
                value={categoryFilter}
                onChange={handleCategoryFilterChange}
                className="bg-transparent text-xs text-foreground focus:outline-none"
              >
                <option value="ALL">All Categories</option>
                {uniqueCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 rounded-md border border-border bg-[#1a1a1e] px-2.5 py-1 text-xs text-muted-foreground">
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={handleStatusFilterChange}
                className="bg-transparent text-xs text-foreground focus:outline-none"
              >
                <option value="ALL">All Levels</option>
                <option value="LOW_OUT">Low or Out Only</option>
                <option value="OK">In Stock (OK)</option>
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-md border border-border bg-[#1a1a1e] px-2.5 py-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => {
                  setShowArchived(e.target.checked);
                  setCurrentPage(1);
                }}
                className="rounded border-zinc-700 bg-zinc-800 text-primary focus:ring-0"
              />
              <span>Show archived</span>
            </label>
          </div>
        </div>

        {/* Status Line */}
        <div
          data-testid="supplies-summary"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#101012] px-6 py-2.5 text-xs text-muted-foreground"
        >
          <span>{summaryLine(activeCount, list.lowOrOutCount)}</span>
          <span className="font-mono text-zinc-400">
            Total on hand: <strong className="text-foreground">{totalUnitsInStock.toLocaleString()}</strong> units
            {" · "}Inventory value: <strong className="text-amber-400">{formatPesos(Number(totalInventoryValueCentavos))}</strong>
          </span>
        </div>

        {/* Item Rows */}
        {list.items.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            <Boxes className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="font-semibold text-foreground">{SUPPLIES_EMPTY}</p>
            <p className="mt-1">Click &quot;Add item&quot; above to log your first product or chemical.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{SUPPLIES_NO_MATCH}</p>
            <p className="mt-1">Try clearing your search query or selecting &quot;All Categories&quot;.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="hidden grid-cols-12 gap-3 px-6 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider sm:grid bg-[#101012]">
              <div className="col-span-4">Item &amp; Category</div>
              <div className="col-span-3">Stock &amp; Reorder Level</div>
              <div className="col-span-2">Unit Cost</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            <ul className="divide-y divide-border">
              {paginatedItems.map((i) => {
                const badge = badgeLabel(i.status);
                return (
                  <li
                    key={i.id}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-white/[0.02] sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 sm:px-6"
                  >
                    {/* Column 1: Item & Category */}
                    <div className="col-span-4 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-foreground">{i.name}</p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold font-mono ${
                            i.currentStock === 0
                              ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                              : i.currentStock <= i.reorderLevel && i.reorderLevel > 0
                                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                                : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {i.currentStock === 0 ? "Out of stock" : `${i.currentStock.toLocaleString()} ${i.unit}${i.currentStock === 1 ? "" : "s"} left`}
                        </span>
                        {badge && (
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                              badgeClass[badge as keyof typeof badgeClass]
                            }`}
                          >
                            {badge}
                          </span>
                        )}
                        {!i.isActive && (
                          <span className="rounded border border-border bg-[#1a1a1e] px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground mt-1">
                        {i.category ? (
                          <span className="text-foreground font-medium">{i.category} · </span>
                        ) : null}
                        <span>Unit: {i.unit}</span>
                      </p>
                    </div>

                    {/* Column 2: Stock Level */}
                    <div className="col-span-3 text-xs text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:hidden">
                        Remaining in stock:
                      </span>
                      <div className="flex items-baseline gap-2">
                        <div
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                            i.currentStock === 0
                              ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                              : i.currentStock <= i.reorderLevel && i.reorderLevel > 0
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          }`}
                        >
                          <span className="font-mono text-base font-bold">
                            {i.currentStock.toLocaleString()}
                          </span>
                          <span className="text-xs font-medium">{i.unit}{i.currentStock === 1 ? "" : "s"}</span>
                        </div>
                        <span className="text-xs font-semibold text-zinc-300">left</span>
                      </div>
                      <p className="text-[11px] mt-1 text-zinc-400">
                        {i.reorderLevel > 0 ? (
                          <span>Reorder alert at &le; {i.reorderLevel} {i.unit}{i.reorderLevel === 1 ? "" : "s"}</span>
                        ) : (
                          <span className="text-zinc-600">No reorder alert</span>
                        )}
                      </p>
                    </div>

                    {/* Column 3: Unit Cost */}
                    <div className="col-span-2 text-xs font-semibold text-foreground">
                      {costLabel(i.costPerUnitCentavos)}
                    </div>

                    {/* Column 4: Actions */}
                    <div className="col-span-3 flex flex-wrap items-center justify-end gap-1.5">
                      {i.isActive ? (
                        <>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => setStockFor({ item: i, kind: "RECEIVE" })}
                            aria-label={`Stock in for ${i.name}`}
                            title="Log stock delivery"
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                            Stock in
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => setStockFor({ item: i, kind: "USE" })}
                            aria-label={`Used: ${i.name}`}
                            title="Log consumed stock"
                          >
                            <ArrowUpFromLine className="h-3.5 w-3.5 mr-1 text-amber-400" />
                            Used
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => setHistoryFor(i)}
                            aria-label={`History of ${i.name}`}
                            title="View log history"
                          >
                            <HistoryIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => open(i)}
                            aria-label={`Edit ${i.name}`}
                            title="Edit details & price"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={`${buttonClass} border-rose-950/40 bg-rose-950/10 text-rose-400 hover:bg-rose-950/30`}
                            disabled={busy}
                            onClick={() => {
                              setError(null);
                              setRemoving(i);
                            }}
                            aria-label={`Delete ${i.name}`}
                            title="Delete or archive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => setHistoryFor(i)}
                            aria-label={`History of ${i.name}`}
                          >
                            <HistoryIcon className="h-3.5 w-3.5 mr-1" />
                            History
                          </button>
                          <button
                            type="button"
                            className={`${buttonClass} border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}
                            disabled={busy}
                            onClick={() => void restore(i)}
                            aria-label={`Restore ${i.name}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Restore
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Pagination Bar */}
        {filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
                <strong className="text-foreground">
                  {Math.min(startIndex + pageSize, filtered.length)}
                </strong>{" "}
                of <strong className="text-foreground">{filtered.length}</strong> items
              </span>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded border border-border bg-[#1a1a1e] px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPageSafe <= 1}
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-[#1a1a1e] px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <div className="px-2 text-xs font-medium text-foreground">
                Page {currentPageSafe} of {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPageSafe >= totalPages}
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-[#1a1a1e] px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setEditing(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing === "new" ? "Add item" : editing ? `Edit ${editing.name}` : "Edit item"}</DialogTitle>
          <DialogDescription>
            {editing && editing !== "new" && (
              <span className="block font-semibold text-emerald-400 mb-1 text-xs">
                Current stock: {editing.currentStock.toLocaleString()} {editing.unit} left
              </span>
            )}
            Stock is changed with Stock in and Used, so every number has a history.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
          <label className="block text-xs font-semibold text-muted-foreground">
            Name
            <input
              className={fieldClass}
              value={form.name}
              onChange={(e) => change({ name: e.target.value })}
              required
              maxLength={80}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            Category (optional)
            <input
              className={fieldClass}
              value={form.category}
              onChange={(e) => change({ category: e.target.value })}
              maxLength={60}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            Unit (bottle, pcs, litre...)
            <input
              className={fieldClass}
              value={form.unit}
              onChange={(e) => change({ unit: e.target.value })}
              required
              maxLength={20}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            Reorder level (0 means no alert)
            <input
              className={fieldClass}
              value={form.reorder}
              onChange={(e) => change({ reorder: e.target.value })}
              inputMode="numeric"
              required
              autoComplete="off"
            />
          </label>
          <label className="block text-xs font-semibold text-muted-foreground">
            Cost of one unit, in pesos
            <input
              className={fieldClass}
              value={form.cost}
              onChange={(e) => change({ cost: e.target.value })}
              inputMode="decimal"
              required
              autoComplete="off"
            />
          </label>
          {/* Stock input section: clearly displays numbers and lets user put/adjust stock count */}
          <div className="rounded-xl border border-border bg-[#141417] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <span>{editing === "new" ? "Starting stock (units)" : "Current stock on hand (units)"}</span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  ({form.unit.trim() || "units"})
                </span>
              </label>
              {editing && editing !== "new" && (
                <span className="text-xs font-mono text-zinc-400">
                  In stock: <strong className="text-foreground">{editing.currentStock.toLocaleString()}</strong>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-10 w-10 shrink-0 rounded-lg border border-border bg-white/5 text-sm font-bold text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-30"
                disabled={busy || whole(form.stock) === null || (whole(form.stock) ?? 0) <= 0}
                onClick={() => {
                  const cur = whole(form.stock) ?? (editing && editing !== "new" ? editing.currentStock : 0);
                  change({ stock: String(Math.max(0, cur - 1)) });
                }}
              >
                -1
              </button>
              <input
                type="number"
                min="0"
                className={`${fieldClass} text-center font-mono text-base font-bold`}
                value={form.stock}
                onChange={(e) => change({ stock: e.target.value })}
                inputMode="numeric"
                required
                autoComplete="off"
              />
              <button
                type="button"
                className="h-10 w-10 shrink-0 rounded-lg border border-border bg-white/5 text-sm font-bold text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-30"
                disabled={busy}
                onClick={() => {
                  const cur = whole(form.stock) ?? (editing && editing !== "new" ? editing.currentStock : 0);
                  change({ stock: String(cur + 1) });
                }}
              >
                +1
              </button>
            </div>
            {editing && editing !== "new" && (
              <div>
                {(() => {
                  const val = whole(form.stock);
                  if (val === null || val < 0) return <p className="text-[11px] text-rose-400">Enter a whole number of 0 or more.</p>;
                  const diff = val - editing.currentStock;
                  if (diff === 0) return <p className="text-[11px] text-zinc-400">No stock change ({val} {editing.unit} currently in stock).</p>;
                  if (diff > 0) return (
                    <p className="text-[11px] font-semibold text-emerald-400">
                      + {diff} {editing.unit} will be added via Stock In log.
                    </p>
                  );
                  return (
                    <p className="text-[11px] font-semibold text-amber-400">
                      - {Math.abs(diff)} {editing.unit} will be deducted via Used log.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gold" className="min-h-[44px]" disabled={busy}>
              {busy ? "Saving..." : editing === "new" ? "Add item" : "Save changes"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete / Archive Confirmation Dialog */}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setRemoving(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete {removing?.name}?</DialogTitle>
          <DialogDescription>{removing ? removeWarning(removing) : ""}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="gold"
            className="min-h-[44px]"
            disabled={busy}
            onClick={() => void confirmRemove()}
          >
            {busy ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </Dialog>

      {/* Stock In / Used Dialog */}
      {stockFor && (
        <StockDialog
          key={stockFor.item.id}
          item={stockFor.item}
          initialKind={stockFor.kind}
          onClose={() => setStockFor(null)}
          onSaved={async (message) => {
            await reload();
            setNotice(message);
          }}
        />
      )}

      {/* Stock History Audit Dialog */}
      {historyFor && <HistoryDialog item={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  );
}
