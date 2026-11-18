"use client";
import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Filter,
  Tag,
  History,
  Edit2,
  Trash2,
  RotateCcw,
  Receipt,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPesos } from "@/lib/commission";
import type { AdminExpense, AdminExpenseCategory, AdminExpenseMonth } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { fieldClass } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import type { AnalyticsPeriod } from "../analytics/analytics-model";
import { ExpenseAnalytics } from "./expense-analytics";
import { CategoriesDialog, ExpenseFormDialog, ExpenseHistoryDialog } from "./expense-dialogs";
import {
  EXPENSES_EMPTY,
  EXPENSES_NO_MATCH,
  matchesExpenseSearch,
  owedNote,
  REMOVE_TEXT,
  unpricedNote,
} from "./expenses-model";

export function ExpensesPanel({
  data,
  period,
  setPeriod,
  categories,
  query,
  thisMonth,
  categoryId,
  setCategoryId,
  includeRemoved,
  setIncludeRemoved,
  reload,
  reloadCategories,
}: {
  data: AdminExpenseMonth;
  period: AnalyticsPeriod;
  setPeriod: (period: AnalyticsPeriod) => void;
  categories: AdminExpenseCategory[];
  query: string;
  thisMonth: string;
  setMonth: (month: string) => void;
  categoryId: string;
  setCategoryId: (id: string) => void;
  includeRemoved: boolean;
  setIncludeRemoved: (on: boolean) => void;
  reload: () => unknown;
  reloadCategories: () => unknown;
}) {
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<AdminExpense | "new" | null>(null);
  const [removing, setRemoving] = React.useState<AdminExpense | null>(null);
  const [reason, setReason] = React.useState("");
  const [historyFor, setHistoryFor] = React.useState<AdminExpense | null>(null);
  const [managing, setManaging] = React.useState(false);
  const [older, setOlder] = React.useState<{ query: string; rows: AdminExpense[]; next: string | null } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const writing = React.useRef(false);

  // Older pages belong to one query and one load of the first page; anything else starts again from the first page.
  const extra = older && older.query === query ? older : null;
  const next = extra ? extra.next : data.nextCursor;
  const rows = [...data.expenses, ...(extra ? extra.rows : [])];
  const shown = rows.filter((e) => matchesExpenseSearch(e, search));

  // Reset pagination on search or category filter change directly in handlers
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setCurrentPage(1);
  }

  function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCategoryId(e.target.value);
    setCurrentPage(1);
  }

  function handleIncludeRemovedChange(e: React.ChangeEvent<HTMLInputElement>) {
    setIncludeRemoved(e.target.checked);
    setCurrentPage(1);
  }

  async function done(message: string) {
    setOlder(null);
    await reload(); // the message appears with the fresh list, never above stale data
    setNotice(message);
  }

  async function run(work: () => Promise<string>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await done(await work());
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

  async function loadOlder() {
    if (!next) return;
    setBusy(true);
    try {
      const page = await adminRequest<AdminExpenseMonth>(`/api/admin/expenses?${query}&cursor=${next}`);
      setOlder({ query, rows: [...(extra ? extra.rows : []), ...page.expenses], next: page.nextCursor });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    const target = removing;
    if (!target) return;
    const ok = await run(async () => {
      await adminRequest(`/api/admin/expenses/${target.id}/remove`, {
        method: "POST",
        body: { expectedRevision: target.revision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      return "The expense was removed. It is kept in history.";
    });
    if (ok) {
      setRemoving(null);
      setReason("");
    }
  }

  const restore = (e: AdminExpense) =>
    run(async () => {
      await adminRequest(`/api/admin/expenses/${e.id}/restore`, {
        method: "POST",
        body: { expectedRevision: e.revision },
      });
      return "The expense is back.";
    });

  const notes = [unpricedNote(data.unpricedStockIns), owedNote(data.totals.commissionsOwed)].filter(Boolean);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * pageSize;
  const paginatedExpenses = shown.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-6">
      {/* Top Header / Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="expenses-heading" className="text-xl font-bold tracking-tight text-foreground">
            Expenses
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Operational shop overheads, inventory stock purchases, and paid technician commissions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[40px] text-xs font-semibold gap-1.5 border-border bg-panel"
            onClick={() => setManaging(true)}
          >
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            Manage Categories
          </Button>
          <Button
            type="button"
            variant="gold"
            className="min-h-[40px] text-xs font-semibold gap-1.5 shadow-sm"
            onClick={() => {
              setError(null);
              setEditing("new");
            }}
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </div>
      </div>

      <ExpenseAnalytics refresh={data} period={period} onPeriodChange={setPeriod} />

      {/* Advisory Notes */}
      {notes.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
          {notes.map((n) => (
            <div key={n} data-testid="expenses-note" className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Notifications */}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-400/70 hover:text-emerald-400">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && !editing && !removing && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-400">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose-400/70 hover:text-rose-400">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Expense Table Container */}
      <div className="rounded-xl border border-border bg-panel shadow-sm">
        {/* Filters Toolbar */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={handleSearchChange}
              placeholder="Search payee or note..."
              autoComplete="off"
              className="w-full rounded-md border border-border bg-raised pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-muted-foreground">
              <Filter className="h-3 w-3" />
              <span>Category:</span>
              <select
                value={categoryId}
                onChange={handleCategoryChange}
                className="bg-transparent text-xs text-foreground focus:outline-none"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : " (hidden)"}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeRemoved}
                onChange={handleIncludeRemovedChange}
                className="rounded border-zinc-700 bg-zinc-800 text-primary focus:ring-0"
              />
              <span>Show removed</span>
            </label>
          </div>
        </div>

        {/* Table Content */}
        {rows.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            <Receipt className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="font-semibold text-foreground">{EXPENSES_EMPTY}</p>
            <p className="mt-1">Click &quot;Add Expense&quot; above to log a new store or operational receipt.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{EXPENSES_NO_MATCH}</p>
            <p className="mt-1">Try clearing your search keyword or selecting &quot;All Categories&quot;.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="hidden grid-cols-12 gap-3 px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider sm:grid bg-panel">
              <div className="col-span-3">Date & Payee</div>
              <div className="col-span-3">Category</div>
              <div className="col-span-4">Amount & Notes</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <ul aria-label="Typed expenses" className="divide-y divide-border">
              {paginatedExpenses.map((e) => (
                <li
                  key={e.id}
                  data-expense={e.id}
                  className={`flex flex-col gap-3 p-4 transition-colors hover:bg-white/[0.02] sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 sm:px-6 ${
                    e.removed ? "opacity-60 bg-rose-950/[0.05]" : ""
                  }`}
                >
                  {/* Column 1: Date & Payee */}
                  <div className="col-span-3 min-w-0">
                    <p className="text-xs font-bold text-foreground">{e.expenseDate}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {e.payee ? (
                        <span>Paid to: <strong className="text-foreground font-semibold">{e.payee}</strong></span>
                      ) : (
                        <span className="text-zinc-600">No payee specified</span>
                      )}
                    </p>
                  </div>

                  {/* Column 2: Category */}
                  <div className="col-span-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded border border-border bg-raised px-2 py-0.5 text-xs font-semibold text-foreground">
                        {e.categoryName}
                      </span>
                      {e.removed && (
                        <span className="inline-flex items-center rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-xs font-bold text-rose-400">
                          Removed
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Column 3: Amount & Notes */}
                  <div className="col-span-4 min-w-0">
                    <p className="text-sm font-black text-foreground tracking-tight">
                      {formatPesos(e.amountCentavos)}
                    </p>
                    {e.note && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5" title={e.note}>
                        {e.note}
                      </p>
                    )}
                  </div>

                  {/* Column 4: Actions */}
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setHistoryFor(e)}
                      className="inline-flex min-h-[34px] items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                      title="View audit history"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>

                    {e.removed ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restore(e)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        title="Restore expense"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Restore</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setEditing(e);
                          }}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                          title="Edit expense"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setError(null);
                            setReason("");
                            setRemoving(e);
                          }}
                          className="inline-flex min-h-[34px] items-center justify-center rounded border border-rose-950/40 bg-rose-950/10 p-1.5 text-rose-400 hover:bg-rose-950/30 transition-colors"
                          title="Remove expense"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Older Data Infinite Fetch Trigger */}
        {next && (
          <div className="border-t border-border p-3 text-center bg-panel">
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadOlder()}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded border border-border bg-card px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <span>Load older expenses from server...</span>
            </button>
          </div>
        )}

        {/* Pagination Bar */}
        {shown.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
                <strong className="text-foreground">{Math.min(startIndex + pageSize, shown.length)}</strong>{" "}
                of <strong className="text-foreground">{shown.length}</strong> items
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
                  className="rounded border border-border bg-raised px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
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
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-raised px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
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
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-raised px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit / Add Modal */}
      {editing && (
        <ExpenseFormDialog
          key={editing === "new" ? "new" : editing.id}
          target={editing === "new" ? editing : rows.find((e) => e.id === editing.id) ?? editing}
          month={data.month}
          thisMonth={thisMonth}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={done}
          reload={reload}
        />
      )}

      {/* Remove Confirmation Dialog */}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setRemoving(null);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-400">
            <Trash2 className="h-5 w-5" />
            <span>Remove this expense?</span>
          </DialogTitle>
          <DialogDescription>{REMOVE_TEXT}</DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">
            Reason for removal (optional)
            <input
              className={fieldClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate receipt or error"
              maxLength={200}
              autoComplete="off"
            />
          </label>

          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[40px] text-xs"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            Keep expense
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-[40px] text-xs font-bold"
            disabled={busy}
            onClick={() => void confirmRemove()}
          >
            {busy ? "Removing..." : "Confirm Remove"}
          </Button>
        </div>
      </Dialog>

      {/* History Dialog */}
      {historyFor && <ExpenseHistoryDialog expense={historyFor} onClose={() => setHistoryFor(null)} />}

      {/* Category Management Dialog */}
      {managing && (
        <CategoriesDialog
          categories={categories}
          onClose={() => setManaging(false)}
          reload={async () => {
            await reloadCategories();
            await reload();
          }}
        />
      )}
    </div>
  );
}
