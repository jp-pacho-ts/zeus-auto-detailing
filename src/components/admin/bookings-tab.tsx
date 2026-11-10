"use client";
import * as React from "react";
import Link from "next/link";
import {
  Search,
  Calendar as CalendarIcon,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "./metric-card";
import type {
  AdminDayQueues,
  AdminBookingList,
  AdminCustomerHistory,
  AdminQueueBooking,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import {
  reorderPayload,
  shopDate,
  statusLabel,
  totalLabel,
  money,
} from "./bookings/model";
import {
  LoadState,
  fieldClass,
  useAdminResource,
} from "./bookings/use-admin-resource";
import { BookingDetail } from "./bookings/booking-detail";
import { CalendarTab } from "./calendar-tab";

function BookingRows({
  bookings,
  queueCode,
  filter,
  role,
  busy,
  onSelect,
  onReorder,
}: {
  bookings: AdminQueueBooking[];
  queueCode?: string;
  filter: string;
  role: UserRole;
  busy: boolean;
  onSelect: (id: string) => void;
  onReorder: (
    code: string,
    rows: AdminQueueBooking[],
    id: string,
    direction: -1 | 1,
  ) => Promise<void>;
}) {
  const filtered = (rows: AdminQueueBooking[]) =>
    filter === "ALL" ? rows : rows.filter((b) => b.status === filter);

  // P1-20: a table from xl up; below it each booking stacks as a labelled card (no sideways scroll).
  const cell = "block min-w-0 break-words xl:table-cell xl:p-3.5";
  const cellLabel = (text: string) => (
    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground xl:hidden">
      {text}
    </span>
  );

  const displayed = filtered(bookings);

  return (
    <div>
      <table className="block w-full text-left text-xs xl:table">
        <thead className="sticky top-0 z-10 hidden border-b border-border bg-[#161618] text-muted-foreground xl:table-header-group">
          <tr>
            {[
              "Reference",
              "Client",
              "Treatment",
              "Day / bay",
              "Status",
              "Amount",
              "Actions",
            ].map((label) => (
              <th
                key={label}
                className="p-3.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-border/70 xl:table-row-group">
          {displayed.map((b) => (
            <tr
              key={b.id}
              className="grid grid-cols-1 gap-2.5 p-3.5 transition-colors hover:bg-[#18181b]/70 sm:grid-cols-2 xl:table-row xl:p-0"
            >
              <td className={cell + " font-mono font-bold text-primary"}>
                {cellLabel("Reference")}
                <button
                  type="button"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary hover:bg-primary/20 hover:text-primary transition-colors focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => onSelect(b.id)}
                >
                  {b.referenceCode}
                </button>
              </td>
              <td className={cell}>
                {cellLabel("Client")}
                <span className="font-semibold text-foreground block">{b.customerName}</span>
                <span className="text-[11px] text-muted-foreground block">
                  {b.vehicleModel}
                  {b.vehiclePlate ? ` · ${b.vehiclePlate}` : ""}
                </span>
              </td>
              <td className={cell + " text-muted-foreground"}>
                {cellLabel("Treatment")}
                <span className="text-foreground/90 font-medium">
                  {b.lines
                    .filter((l) => !l.removed)
                    .map((l) => l.name)
                    .join(", ") || b.serviceName}
                </span>
              </td>
              <td className={cell + " text-muted-foreground"}>
                {cellLabel("Day / bay")}
                <span className="text-foreground/90 font-medium">{b.bookingDate}</span>
                <p className="text-[11px] text-muted-foreground">{b.bay?.name ?? "Unassigned bay"}</p>
              </td>
              <td className={cell}>
                {cellLabel("Status")}
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    b.status === "CONFIRMED" || b.status === "COMPLETED"
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                      : b.status === "PENDING"
                        ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                        : b.status === "IN_PROGRESS"
                          ? "border-blue-500/30 bg-blue-500/15 text-blue-400"
                          : "border-rose-500/30 bg-rose-500/15 text-rose-400"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      b.status === "CONFIRMED" || b.status === "COMPLETED"
                        ? "bg-emerald-400"
                        : b.status === "PENDING"
                          ? "bg-amber-400"
                          : b.status === "IN_PROGRESS"
                            ? "bg-blue-400 animate-pulse"
                            : "bg-rose-400"
                    }`}
                  />
                  {statusLabel(b.status)}
                </span>
              </td>
              <td className={cell + " font-mono font-semibold tabular-nums text-foreground"}>
                {cellLabel("Amount")}
                {totalLabel(b.totals)}
              </td>
              <td className={cell}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs font-semibold hover:border-primary hover:text-primary transition-colors"
                    onClick={() => onSelect(b.id)}
                  >
                    Open
                  </Button>
                  {role === "ADMIN" &&
                    queueCode &&
                    b.status !== "CANCELLED" &&
                    ([-1, 1] as const).map((direction) => (
                      <Button
                        key={direction}
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 text-xs font-bold"
                        aria-label={`Move ${b.referenceCode} ${direction === -1 ? "up" : "down"}`}
                        disabled={
                          busy || !reorderPayload(bookings, b.id, direction)
                        }
                        onClick={() =>
                          void onReorder(queueCode, bookings, b.id, direction)
                        }
                      >
                        {direction === -1 ? "↑" : "↓"}
                      </Button>
                    ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {displayed.length === 0 && (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No bookings match this view.
        </div>
      )}
    </div>
  );
}

function BookingsList({
  role,
  historyOnly = false,
  onNavigateCalendar,
}: {
  role: UserRole;
  historyOnly?: boolean;
  onNavigateCalendar?: () => void;
}) {
  const [date, setDate] = React.useState(shopDate),
    [searchFrom, setSearchFrom] = React.useState(shopDate),
    [searchTo, setSearchTo] = React.useState(shopDate),
    [filter, setFilter] = React.useState("ALL"),
    [selected, setSelected] = React.useState<string | null>(null),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null);

  // Search mode: "SEARCH" (standard search) or "HISTORY" (phone lifetime history)
  const [searchMode, setSearchMode] = React.useState<"SEARCH" | "HISTORY">(
    historyOnly ? "HISTORY" : "SEARCH",
  );

  const day = useAdminResource<AdminDayQueues>(
    historyOnly ? null : `/api/admin/queues?date=${date}`,
  );

  const [listing, setListing] = React.useState<{
    url: string;
    body?: string;
  } | null>(null);

  const [searchPage, setSearchPage] = React.useState(1);
  const [cursorHistory, setCursorHistory] = React.useState<string[]>([]);

  // Queue pagination
  const [queuePage, setQueuePage] = React.useState(1);
  const QUEUE_PAGE_SIZE = 10;
  const [activeQueueTab, setActiveQueueTab] = React.useState<string>("ALL");

  const [historyPhone, setHistoryPhone] = React.useState<string | null>(null);

  const list = useAdminResource<AdminBookingList>(
    listing?.url ?? null,
    listing?.body ? "POST" : "GET",
    listing?.body,
  );

  const history = useAdminResource<AdminCustomerHistory>(
    role === "ADMIN" && historyPhone !== null
      ? "/api/admin/customers/history"
      : null,
    "POST",
    historyPhone === null ? undefined : JSON.stringify({ phone: historyPhone }),
  );

  const writing = React.useRef(false),
    mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const all = React.useMemo(() => {
    return day.data
      ? [...day.data.queues.flatMap((q) => q.bookings), ...day.data.legacy]
      : [];
  }, [day.data]);

  async function reorder(
    code: string,
    rows: AdminQueueBooking[],
    id: string,
    direction: -1 | 1,
  ) {
    if (writing.current) return;
    const body = reorderPayload(rows, id, direction);
    if (!body) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/queues/${code}/days/${date}/order`, {
        method: "POST",
        body,
      });
      if (mounted.current) void day.reload();
    } catch (e) {
      if (mounted.current) {
        if (e instanceof AdminRequestError && e.status === 401) {
          window.location.replace("/admin/login");
          return;
        }
        setError(
          e instanceof Error
            ? e.message
            : "Reorder failed. Refresh the queue before retrying.",
        );
        void day.reload();
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function applySearchPreset(p: "TODAY" | "THIS_WEEK" | "LAST_WEEK" | "THIS_MONTH") {
    const today = shopDate();
    let from = today;
    let to = today;
    if (p === "TODAY") {
      from = today;
      to = today;
    } else if (p === "THIS_WEEK" || p === "LAST_WEEK") {
      const d = new Date(today + "T00:00:00Z");
      const diffToMon = (d.getUTCDay() + 6) % 7;
      const offset = p === "LAST_WEEK" ? 7 : 0;
      from = new Date(d.getTime() - (diffToMon + offset) * 86_400_000).toISOString().slice(0, 10);
      to = new Date(d.getTime() - (diffToMon + offset - 6) * 86_400_000).toISOString().slice(0, 10);
    } else if (p === "THIS_MONTH") {
      const y = today.slice(0, 4);
      const m = Number(today.slice(5, 7));
      from = `${y}-${String(m).padStart(2, "0")}-01`;
      to = new Date(Date.UTC(Number(y), m, 0)).toISOString().slice(0, 10);
    }
    setSearchFrom(from);
    setSearchTo(to);
    setSearchPage(1);
    setCursorHistory([]);
    setListing({
      url: `/api/admin/bookings?from=${from}&to=${to}&limit=25${filter === "ALL" ? "" : `&status=${filter}`}`,
    });
  }

  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      q = String(form.get("q")).trim(),
      from = String(form.get("from") || searchFrom),
      to = String(form.get("to") || searchTo),
      status = String(form.get("status"));
    const params = {
      from,
      to,
      limit: 25,
      ...(status === "ALL" ? {} : { status: [status] }),
    };
    setSearchPage(1);
    setCursorHistory([]);
    setListing(
      q
        ? {
            url: "/api/admin/bookings/search",
            body: JSON.stringify({ ...params, q }),
          }
        : {
            url: `/api/admin/bookings?from=${from}&to=${to}&limit=25${status === "ALL" ? "" : `&status=${status}`}`,
          },
    );
  }

  function nextSearchPage() {
    if (!list.data?.nextCursor || !listing) return;
    const currentCursor = list.data.nextCursor;
    setCursorHistory((prev) => [...prev, currentCursor]);
    setSearchPage((p) => p + 1);

    if (listing.body) {
      setListing({
        ...listing,
        body: JSON.stringify({
          ...JSON.parse(listing.body),
          cursor: currentCursor,
        }),
      });
    } else {
      setListing({
        ...listing,
        url:
          listing.url.replace(/&cursor=[^&]*/, "") +
          `&cursor=${encodeURIComponent(currentCursor)}`,
      });
    }
  }

  function prevSearchPage() {
    if (searchPage <= 1 || !listing) return;
    const newStack = [...cursorHistory];
    newStack.pop(); // discard current page cursor
    const targetCursor = newStack.length > 0 ? newStack[newStack.length - 1] : null;
    setCursorHistory(newStack);
    setSearchPage((p) => Math.max(1, p - 1));

    if (listing.body) {
      const parsed = JSON.parse(listing.body);
      if (targetCursor) parsed.cursor = targetCursor;
      else delete parsed.cursor;
      setListing({
        ...listing,
        body: JSON.stringify(parsed),
      });
    } else {
      const cleanUrl = listing.url.replace(/&cursor=[^&]*/, "");
      setListing({
        ...listing,
        url: targetCursor ? `${cleanUrl}&cursor=${encodeURIComponent(targetCursor)}` : cleanUrl,
      });
    }
  }

  // Determine which queue bookings to display
  const activeBookings = React.useMemo(() => {
    if (!day.data) return [];
    if (activeQueueTab === "ALL") return all;
    if (activeQueueTab === "LEGACY") return day.data.legacy;
    const foundQueue = day.data.queues.find((q) => q.code === activeQueueTab);
    return foundQueue ? foundQueue.bookings : all;
  }, [day.data, activeQueueTab, all]);

  const totalQueuePages = Math.max(1, Math.ceil(activeBookings.length / QUEUE_PAGE_SIZE));
  const pagedQueueBookings = React.useMemo(() => {
    const start = (queuePage - 1) * QUEUE_PAGE_SIZE;
    return activeBookings.slice(start, start + QUEUE_PAGE_SIZE);
  }, [activeBookings, queuePage]);

  return (
    <div className="space-y-6">
      {/* Top Professional Navigation & Shortcuts Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Bookings Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time appointment schedule, customer search, and queue operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="bookings-view-BOOKINGS"
            variant="default"
            aria-pressed="true"
            className="hidden"
          >
            Bookings
          </Button>
          <Button
            id="bookings-view-CALENDAR"
            variant="outline"
            size="sm"
            onClick={onNavigateCalendar}
            className="flex items-center gap-1.5 text-xs font-semibold"
          >
            <CalendarIcon className="h-3.5 w-3.5 text-primary" />
            <span>Calendar</span>
          </Button>
          <Link
            href="/book"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary-hover shadow-xs transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Booking</span>
          </Link>
        </div>
      </div>

      {/* 1. FIND BOOKINGS & CUSTOMER HISTORY (COMMAND CENTER) */}
      {!historyOnly && (
        <section className="rounded-xl border border-border bg-[#121214] p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold text-foreground">Find bookings</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Presets */}
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ["TODAY", "Today"],
                    ["THIS_WEEK", "This week"],
                    ["LAST_WEEK", "Last week"],
                    ["THIS_MONTH", "This month"],
                  ] as const
                ).map(([p, label]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setSearchMode("SEARCH");
                      applySearchPreset(p);
                    }}
                    className="rounded border border-border bg-[#18181b] px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-[#202024] hover:text-foreground transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Mode Toggle for Admins */}
              {role === "ADMIN" && (
                <div className="flex items-center rounded-lg border border-border bg-[#18181b] p-0.5 ml-1">
                  <button
                    type="button"
                    onClick={() => setSearchMode("SEARCH")}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                      searchMode === "SEARCH"
                        ? "bg-zinc-800 text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Search bookings
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchMode("HISTORY")}
                    className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                      searchMode === "HISTORY"
                        ? "bg-zinc-800 text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    History
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Search Form Mode */}
          {searchMode === "SEARCH" && (
            <form
              key={date}
              onSubmit={search}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs font-semibold text-muted-foreground">
                Name, phone, last 4 digits or reference
                <input
                  name="q"
                  maxLength={80}
                  className={fieldClass}
                  autoComplete="off"
                  placeholder="e.g. John Doe, 0917..., ZEUS-1234"
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                From
                <input
                  name="from"
                  type="date"
                  required
                  value={searchFrom}
                  onChange={(e) => setSearchFrom(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                To
                <input
                  name="to"
                  type="date"
                  required
                  value={searchTo}
                  onChange={(e) => setSearchTo(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="text-xs font-semibold text-muted-foreground">
                Status
                <select
                  name="status"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className={fieldClass}
                >
                  {[
                    "ALL",
                    "PENDING",
                    "CONFIRMED",
                    "IN_PROGRESS",
                    "COMPLETED",
                    "CANCELLED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s === "ALL" ? "All statuses" : statusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={list.loading} className="min-h-[40px] px-4 font-bold">
                Search bookings
              </Button>
              {listing && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[40px]"
                  onClick={() => {
                    setListing(null);
                    setSearchPage(1);
                    setCursorHistory([]);
                  }}
                >
                  Clear search
                </Button>
              )}
            </form>
          )}

          {/* History Mode (Admin only) */}
          {searchMode === "HISTORY" && role === "ADMIN" && (
            <div className="space-y-4 pt-1">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                  Customer Booking History Lookup
                </h3>
                <p className="text-xs text-muted-foreground">
                  Read-only lifetime phone record search across all completed and confirmed bookings.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const phone = String(new FormData(e.currentTarget).get("phone")).trim();
                  if (phone === historyPhone) void history.reload();
                  else setHistoryPhone(phone);
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs font-semibold text-muted-foreground">
                  Customer phone
                  <input
                    name="phone"
                    required
                    maxLength={64}
                    autoComplete="off"
                    placeholder="Enter phone number (e.g. 09171234567)"
                    className={fieldClass}
                  />
                </label>
                <Button disabled={history.loading} className="min-h-[40px] px-4 font-bold">
                  Look up history
                </Button>
                <Button
                  type="reset"
                  variant="outline"
                  className="min-h-[40px]"
                  onClick={() => setHistoryPhone(null)}
                >
                  Clear history
                </Button>
              </form>

              <LoadState
                loading={history.loading}
                error={history.error}
                retry={history.reload}
              />

              {history.data && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between border-b border-border pb-2 text-xs font-semibold text-muted-foreground">
                    <span>Customer Record for {historyPhone}</span>
                    <span>{history.data.bookings.length} past appointments found</span>
                  </div>
                  {history.data.bookings.length === 0 && (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      No bookings found for this phone number.
                    </p>
                  )}
                  {history.data.bookings.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-border bg-[#18181b]/50 p-3 text-left text-xs transition-colors hover:border-primary/40 hover:bg-[#18181b] focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => setSelected(b.id)}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-primary">
                            {b.referenceCode}
                          </span>
                          <span className="text-foreground font-semibold">
                            {b.bookingDate}
                          </span>
                          <span className="text-muted-foreground">· {b.queueName}</span>
                          <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300">
                            {statusLabel(b.status)}
                          </span>
                        </div>
                        <p className="text-muted-foreground">
                          {b.services.join(", ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-foreground">
                          {totalLabel(b.totals)}
                        </span>
                        <span className="text-xs font-semibold text-primary underline">
                          Open
                        </span>
                      </div>
                    </button>
                  ))}
                  {history.data.truncated && (
                    <p className="text-[11px] text-muted-foreground text-center pt-1">
                      Showing the latest 50 bookings.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Results Display */}
          {searchMode === "SEARCH" && (
            <>
              <LoadState
                loading={list.loading}
                error={list.error}
                retry={list.reload}
              />
              {list.data && (
                <div className="mt-4 rounded-lg border border-border/80 bg-[#161618] overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5 bg-[#141416]">
                    <span className="text-xs font-bold text-foreground">
                      Search Results ({list.data.items.length} returned)
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      Page {searchPage}
                    </span>
                  </div>
                  <BookingRows
                    bookings={list.data.items}
                    filter="ALL"
                    role={role}
                    busy={busy}
                    onSelect={setSelected}
                    onReorder={reorder}
                  />

                  {/* Search Results Pagination Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3 bg-[#141416]">
                    <span className="text-xs text-muted-foreground">
                      Showing Page <span className="font-bold text-foreground">{searchPage}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={searchPage <= 1 || list.loading}
                        onClick={prevSearchPage}
                        className="text-xs font-semibold"
                      >
                        Previous
                      </Button>
                      <span className="text-xs font-bold text-muted-foreground px-1">
                        Page {searchPage}
                      </span>
                      {list.data.nextCursor && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={list.loading}
                          onClick={nextSearchPage}
                          className="text-xs font-semibold"
                        >
                          Next bookings page
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 2. EXECUTIVE METRIC KPI TILES */}
      {!historyOnly && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            title="Day's Bookings"
            value={
              day.data
                ? String(all.filter((b) => b.status !== "CANCELLED").length)
                : "—"
            }
            meta="Live queue visits"
          />
          <MetricCard
            title="Current Charges"
            value={
              day.data
                ? money(
                    all
                      .filter((b) => b.status !== "CANCELLED")
                      .reduce((n, b) => n + b.totals.currentTotalCentavos, 0),
                  )
                : "—"
            }
            meta="For-quote estimates excluded"
          />
          <MetricCard
            title="In Progress"
            value={
              day.data
                ? String(all.filter((b) => b.status === "IN_PROGRESS").length)
                : "—"
            }
            meta="Across the day's queues"
          />
          <MetricCard
            title="Pending Action"
            value={
              day.data
                ? String(all.filter((b) => b.status === "PENDING").length)
                : "—"
            }
            meta="Needs staff confirmation"
          />
        </div>
      )}

      {/* 3. DAILY QUEUES SCHEDULE & BOOKINGS TABLE WITH PAGINATION */}
      {!historyOnly && (
        <section className="rounded-xl border border-border bg-[#121214] shadow-xs overflow-hidden">
          {/* Day Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 bg-[#141416]">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                <span>Queue day</span>
                <input
                  type="date"
                  value={date}
                  required
                  className={fieldClass}
                  onChange={(e) => {
                    if (e.target.value) {
                      setDate(e.target.value);
                      setQueuePage(1);
                      setSelected(null);
                      setListing(null);
                      setHistoryPhone(null);
                      setError(null);
                    }
                  }}
                />
              </label>

              {/* Quick Day Jumps */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const prev = new Date(Date.parse(date + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
                    setDate(prev);
                    setQueuePage(1);
                    setSelected(null);
                    setListing(null);
                    setHistoryPhone(null);
                    setError(null);
                  }}
                  className="rounded border border-border bg-[#18181b] px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-[#202025] hover:text-foreground transition-colors"
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = shopDate();
                    setDate(today);
                    setQueuePage(1);
                    setSelected(null);
                    setListing(null);
                    setHistoryPhone(null);
                    setError(null);
                  }}
                  className="rounded border border-border bg-[#18181b] px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-[#202025] hover:text-foreground transition-colors"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(Date.parse(date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
                    setDate(next);
                    setQueuePage(1);
                    setSelected(null);
                    setListing(null);
                    setHistoryPhone(null);
                    setError(null);
                  }}
                  className="rounded border border-border bg-[#18181b] px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-[#202025] hover:text-foreground transition-colors"
                >
                  Tomorrow
                </button>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={busy || day.loading}
              onClick={() => void day.reload()}
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy || day.loading ? "animate-spin" : ""}`} />
              <span>Refresh queues</span>
            </Button>
          </div>

          {/* Queue Filter Tabs */}
          {day.data && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/80 px-4 py-2 bg-[#161618]">
              <button
                type="button"
                onClick={() => {
                  setActiveQueueTab("ALL");
                  setQueuePage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeQueueTab === "ALL"
                    ? "bg-primary text-primary-foreground shadow-xs font-bold"
                    : "text-muted-foreground hover:bg-[#1f1f23] hover:text-foreground"
                }`}
              >
                All Queues ({all.length})
              </button>
              {day.data.queues.map((q) => (
                <button
                  key={q.code}
                  type="button"
                  onClick={() => {
                    setActiveQueueTab(q.code);
                    setQueuePage(1);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeQueueTab === q.code
                      ? "bg-primary text-primary-foreground shadow-xs font-bold"
                      : "text-muted-foreground hover:bg-[#1f1f23] hover:text-foreground"
                  }`}
                >
                  {q.name} ({q.bookings.length})
                </button>
              ))}
              {Boolean(day.data.legacy.length) && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveQueueTab("LEGACY");
                    setQueuePage(1);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeQueueTab === "LEGACY"
                      ? "bg-primary text-primary-foreground shadow-xs font-bold"
                      : "text-muted-foreground hover:bg-[#1f1f23] hover:text-foreground"
                  }`}
                >
                  Legacy ({day.data.legacy.length})
                </button>
              )}
            </div>
          )}

          <LoadState loading={day.loading} error={day.error} retry={day.reload} />

          {error && (
            <p role="alert" className="p-4 text-sm text-rose-400">
              {error} The queue has been refreshed; review it before another change.
            </p>
          )}

          {day.data?.closed && (
            <p className="p-4 text-sm font-semibold text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
              Closed · {day.data.closed.reason}
            </p>
          )}

          {/* Bookings Table with Pagination */}
          {day.data && (
            <>
              <BookingRows
                bookings={pagedQueueBookings}
                queueCode={activeQueueTab !== "ALL" && activeQueueTab !== "LEGACY" ? activeQueueTab : undefined}
                filter={filter}
                role={role}
                busy={busy}
                onSelect={setSelected}
                onReorder={reorder}
              />

              {/* Pagination Bar for Queue Day */}
              {activeBookings.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 bg-[#141416]">
                  <p className="text-xs text-muted-foreground">
                    Showing{" "}
                    <span className="font-bold text-foreground">
                      {(queuePage - 1) * QUEUE_PAGE_SIZE + 1}
                    </span>{" "}
                    to{" "}
                    <span className="font-bold text-foreground">
                      {Math.min(queuePage * QUEUE_PAGE_SIZE, activeBookings.length)}
                    </span>{" "}
                    of <span className="font-bold text-foreground">{activeBookings.length}</span> bookings
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={queuePage <= 1}
                      onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                      className="rounded border border-border bg-[#18181b] px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-[#202025] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      Previous
                    </button>
                    <span className="px-2 text-xs font-bold text-muted-foreground">
                      Page {queuePage} of {totalQueuePages}
                    </span>
                    <button
                      type="button"
                      disabled={queuePage >= totalQueuePages}
                      onClick={() => setQueuePage((p) => Math.min(totalQueuePages, p + 1))}
                      className="rounded border border-border bg-[#18181b] px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-[#202025] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Standalone History View (if accessed via legacy historyOnly) */}
      {role === "ADMIN" && historyOnly && (
        <section className="rounded-xl border border-border bg-[#121214] p-5 shadow-xs space-y-4">
          <div>
            <h2 className="text-base font-bold text-foreground">Customer booking history</h2>
            <p className="text-xs text-muted-foreground">
              Read-only phone lookup. Nothing is saved in browser storage.
            </p>
          </div>
          <form
            key={date}
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const phone = String(new FormData(e.currentTarget).get("phone")).trim();
              if (phone === historyPhone) void history.reload();
              else setHistoryPhone(phone);
            }}
          >
            <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs font-semibold text-muted-foreground">
              Customer phone
              <input
                name="phone"
                required
                maxLength={64}
                autoComplete="off"
                placeholder="Enter customer phone..."
                className={fieldClass}
              />
            </label>
            <Button disabled={history.loading} className="min-h-[40px] px-4 font-bold">
              Look up history
            </Button>
            <Button
              type="reset"
              variant="outline"
              className="min-h-[40px]"
              onClick={() => setHistoryPhone(null)}
            >
              Clear history
            </Button>
          </form>
          <LoadState
            loading={history.loading}
            error={history.error}
            retry={history.reload}
          />
          {history.data && (
            <div className="mt-4 space-y-2">
              {history.data.bookings.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No bookings found for this customer.
                </p>
              )}
              {history.data.bookings.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-border bg-[#18181b]/50 p-3 text-left text-xs transition-colors hover:border-primary/40 hover:bg-[#18181b] focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setSelected(b.id)}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-primary">{b.referenceCode}</span>
                      <span className="font-semibold text-foreground">{b.bookingDate}</span>
                      <span className="text-muted-foreground">· {b.queueName}</span>
                      <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300">
                        {statusLabel(b.status)}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {b.services.join(", ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-foreground">
                      {totalLabel(b.totals)}
                    </span>
                    <span className="text-xs font-semibold text-primary underline">Open</span>
                  </div>
                </button>
              ))}
              {history.data.truncated && (
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  Showing the latest 50 bookings.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Booking Detail Modal */}
      {selected && (
        <BookingDetail
          key={selected}
          id={selected}
          role={role}
          queues={day.data?.queues ?? []}
          onChanged={day.reload}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export function BookingsTab({
  role,
  listView = false,
  initialView = "BOOKINGS",
  onNavigateCalendar,
}: {
  role: UserRole;
  listView?: boolean;
  initialView?: "BOOKINGS" | "CALENDAR" | "HISTORY";
  onNavigateCalendar?: () => void;
}) {
  const [view, setView] = React.useState<"BOOKINGS" | "CALENDAR" | "HISTORY">(
    initialView === "HISTORY" && role !== "ADMIN" ? "BOOKINGS" : initialView,
  );

  if (listView) {
    return <BookingsList role={role} onNavigateCalendar={onNavigateCalendar} />;
  }

  // If history view is explicitly requested
  if (view === "HISTORY") {
    return (
      <div className="min-w-0 space-y-4">
        <div className="min-w-0 space-y-2">
          <div
            role="group"
            aria-label="Bookings view"
            className="inline-flex flex-wrap gap-1.5 rounded-lg border border-border bg-[#121214] p-1"
          >
            <Button
              id="bookings-view-BOOKINGS"
              variant="outline"
              aria-pressed="false"
              onClick={() => setView("BOOKINGS")}
            >
              Bookings
            </Button>
            <Button
              id="bookings-view-CALENDAR"
              variant="outline"
              aria-pressed="false"
              onClick={() => setView("CALENDAR")}
            >
              Calendar
            </Button>
            {role === "ADMIN" && (
              <Button
                id="bookings-view-HISTORY"
                variant="default"
                aria-pressed="true"
                onClick={() => setView("HISTORY")}
              >
                History
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Look up a customer’s past bookings by phone.
          </p>
        </div>
        <BookingsList role={role} historyOnly={true} />
      </div>
    );
  }

  // If calendar view is explicitly requested (e.g. legacy bookmark or prop)
  if (view === "CALENDAR") {
    return (
      <div className="min-w-0 space-y-4">
        <div className="min-w-0 space-y-2">
          <div
            role="group"
            aria-label="Bookings view"
            className="inline-flex flex-wrap gap-1.5 rounded-lg border border-border bg-[#121214] p-1"
          >
            <Button
              id="bookings-view-BOOKINGS"
              variant="outline"
              aria-pressed="false"
              onClick={() => setView("BOOKINGS")}
            >
              Bookings
            </Button>
            <Button
              id="bookings-view-CALENDAR"
              variant="default"
              aria-pressed="true"
              onClick={() => setView("CALENDAR")}
            >
              Calendar
            </Button>
            {role === "ADMIN" && (
              <Button
                id="bookings-view-HISTORY"
                variant="outline"
                aria-pressed="false"
                onClick={() => setView("HISTORY")}
              >
                History
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Choose a date to see its customer bookings.
          </p>
        </div>
        <CalendarTab role={role} />
      </div>
    );
  }

  return (
    <BookingsList
      role={role}
      historyOnly={false}
      onNavigateCalendar={onNavigateCalendar}
    />
  );
}
