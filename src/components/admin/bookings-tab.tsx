"use client";
import * as React from "react";
import Link from "next/link";
import {
  Search,
  Calendar as CalendarIcon,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { shopDay, statusPill } from "./bookings/detail/shared";
import {
  DayStepper,
  LoadState,
  Select,
  dateClass,
  fieldClass,
  useAdminResource,
} from "./bookings/use-admin-resource";
import { BookingDetail } from "./bookings/booking-detail";
import { CalendarTab } from "./calendar-tab";

// P1-76: one booking per row; the whole row opens its details (the P1-75 Dashboard pattern). Reorder stays as its own buttons.
export function BookingRows({
  bookings,
  queueCode,
  queueNames,
  showDate = false,
  emptyText,
  filter,
  role,
  busy,
  onSelect,
  onReorder,
}: {
  bookings: AdminQueueBooking[];
  queueCode?: string;
  queueNames: Record<string, string>;
  showDate?: boolean;
  emptyText: string;
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
  const displayed = filter === "ALL" ? bookings : bookings.filter((b) => b.status === filter);
  if (!displayed.length) return <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y divide-border/70">
      {displayed.map((b) => {
        const services = b.lines.filter((l) => !l.removed).map((l) => l.name).join(", ") || b.serviceName;
        const queue = b.queueCode ? (queueNames[b.queueCode] ?? b.queueCode) : "Older booking";
        const canReorder = role === "ADMIN" && queueCode && b.status !== "CANCELLED";
        return (
          <li key={b.id} className="flex items-stretch">
            <button
              type="button"
              id={"booking-row-" + b.id}
              onClick={() => onSelect(b.id)}
              className="group flex min-h-[44px] min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold text-foreground">
                    {queue}
                    {b.queuePosition ? ` #${b.queuePosition}` : ""}
                  </span>
                  <span className={statusPill(b.status)}>{statusLabel(b.status)}</span>
                  <span className="font-mono text-xs text-muted-foreground">{b.referenceCode}</span>
                  {showDate && <span className="text-xs text-muted-foreground">{shopDay(b.bookingDate)}</span>}
                </span>
                <span className="block truncate text-sm font-medium text-foreground">
                  {b.customerName} · {b.vehicleModel}
                  {b.vehiclePlate ? ` · ${b.vehiclePlate}` : ""}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {services} · {b.bay?.name ?? "Unassigned bay"}
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap text-right">
                <span className="block font-mono text-xs font-semibold tabular-nums text-foreground">{money(b.totals.currentTotalCentavos)}</span>
                {b.totals.forQuoteCount > 0 && <span className="block text-xs text-muted-foreground">+{b.totals.forQuoteCount} for quote</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
            {canReorder && (
              <span className="flex shrink-0 flex-col justify-center gap-1 border-l border-border/70 px-2">
                {([-1, 1] as const).map((direction) => (
                  <Button
                    key={direction}
                    variant="outline"
                    size="sm"
                    className="h-9 min-h-0 w-9 p-0 text-xs font-bold"
                    aria-label={`Move ${b.referenceCode} ${direction === -1 ? "up" : "down"}`}
                    disabled={busy || !reorderPayload(bookings, b.id, direction)}
                    onClick={() => void onReorder(queueCode, bookings, b.id, direction)}
                  >
                    {direction === -1 ? "↑" : "↓"}
                  </Button>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type RangePreset = "TODAY" | "TOMORROW" | "THIS_WEEK" | "NEXT_WEEK" | "LAST_WEEK" | "THIS_MONTH" | "NEXT_MONTH";

const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

// Weeks run Monday to Sunday in the shop's own calendar day.
export function presetRange(p: RangePreset, today: string): { from: string; to: string } {
  if (p === "TODAY") return { from: today, to: today };
  if (p === "TOMORROW") return { from: addDays(today, 1), to: addDays(today, 1) };
  if (p === "THIS_MONTH" || p === "NEXT_MONTH") {
    const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) + (p === "NEXT_MONTH" ? 1 : 0);
    return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }
  const shift = p === "LAST_WEEK" ? -7 : p === "NEXT_WEEK" ? 7 : 0;
  const monday = addDays(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7) + shift);
  return { from: monday, to: addDays(monday, 6) };
}

function Pager({ label, canPrev, canNext, onPrev, onNext }: {
  label: string; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <span className="text-xs tabular-nums text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={!canPrev} onClick={onPrev}>Previous</Button>
        <Button type="button" variant="outline" size="sm" disabled={!canNext} onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}

function HistoryList({ data, onOpen }: { data: AdminCustomerHistory; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {data.bookings.length === 0 ? "No bookings found for this customer." : `${data.bookings.length} past bookings`}
      </p>
      {data.bookings.map((b) => (
        <button
          key={b.id}
          type="button"
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left text-xs transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => onOpen(b.id)}
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-primary">{b.referenceCode}</span>
              <span className="font-semibold text-foreground">{b.bookingDate}</span>
              <span className="text-muted-foreground">· {b.queueName} · {statusLabel(b.status)}</span>
            </div>
            <p className="text-muted-foreground">{b.services.join(", ")}</p>
          </div>
          <span className="shrink-0 font-mono font-bold tabular-nums text-foreground">{totalLabel(b.totals)}</span>
        </button>
      ))}
      {data.truncated && <p className="pt-1 text-center text-xs text-muted-foreground">Showing the latest 50 bookings.</p>}
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

  const [mode, setMode] = React.useState<"DAY" | "SEARCH" | "HISTORY">(historyOnly ? "HISTORY" : "DAY");
  const [q, setQ] = React.useState("");
  const [range, setRange] = React.useState<RangePreset | "CUSTOM">("THIS_WEEK");

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

  function runSearch(next: { q?: string; from?: string; to?: string; status?: string } = {}) {
    const text = (next.q ?? q).trim(), from = next.from ?? searchFrom, to = next.to ?? searchTo, status = next.status ?? filter;
    const params = { from, to, limit: 25, ...(status === "ALL" ? {} : { status: [status] }) };
    setSearchPage(1);
    setCursorHistory([]);
    setListing(
      text
        ? { url: "/api/admin/bookings/search", body: JSON.stringify({ ...params, q: text }) }
        : { url: `/api/admin/bookings?from=${from}&to=${to}&limit=25${status === "ALL" ? "" : `&status=${status}`}` },
    );
  }

  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    runSearch();
  }

  // Search opens on this week's bookings, so the list is never empty on arrival.
  function openSearch() {
    setMode("SEARCH");
    if (listing) return;
    const r = range === "CUSTOM" ? { from: searchFrom, to: searchTo } : presetRange(range, shopDate());
    setSearchFrom(r.from);
    setSearchTo(r.to);
    runSearch(r);
  }

  function searchFromBar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMode("SEARCH");
    const r = range === "CUSTOM" ? { from: searchFrom, to: searchTo } : presetRange(range, shopDate());
    setSearchFrom(r.from);
    setSearchTo(r.to);
    runSearch(r);
  }

  function goDay(next: string) {
    setDate(next);
    setQueuePage(1);
    setSelected(null);
    setError(null);
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

  const today = shopDate();
  const statusSelect = (
    <label className="min-w-0 text-xs font-semibold text-muted-foreground sm:w-44">
      Status
      <Select
        name="status"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          if (mode === "SEARCH") runSearch({ status: e.target.value });
        }}
      >
        {["ALL", "PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((s) => (
          <option key={s} value={s}>
            {s === "ALL" ? "All statuses" : statusLabel(s)}
          </option>
        ))}
      </Select>
    </label>
  );
  const open = all.filter((b) => b.status !== "CANCELLED");
  const segment = (active: boolean) =>
    `min-h-[36px] rounded-md px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      active ? "bg-raised text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
    }`;
  const tab = (active: boolean) =>
    `-mb-px min-h-[40px] border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;
  const queueNames: Record<string, string> = Object.fromEntries((day.data?.queues ?? []).map((x) => [x.code, x.name]));
  const pickQueue = (code: string) => {
    setActiveQueueTab(code);
    setQueuePage(1);
  };

  return (
    <div className="space-y-4">
      {!historyOnly && (
        <>
          {/* One view switch on the left, page actions on the right */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Bookings mode" className="inline-flex rounded-lg border border-border bg-panel p-0.5">
              <button id="bookings-view-BOOKINGS" type="button" aria-pressed={mode === "DAY"} className={segment(mode === "DAY")} onClick={() => setMode("DAY")}>
                Day
              </button>
              <button type="button" aria-pressed={mode === "SEARCH"} className={segment(mode === "SEARCH")} onClick={openSearch}>
                Search
              </button>
              {role === "ADMIN" && (
                <button type="button" aria-pressed={mode === "HISTORY"} className={segment(mode === "HISTORY")} onClick={() => setMode("HISTORY")}>
                  History
                </button>
              )}
            </div>
            {/* P1-76: search is always one box away; Enter shows the results in the Search view. */}
            {mode !== "SEARCH" && (
              <form role="search" onSubmit={searchFromBar} className="relative order-last w-full sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search bookings"
                  maxLength={80}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoComplete="off"
                  placeholder="Name, phone, last 4 or reference"
                  className={fieldClass.replace("mt-1 ", "") + " pl-9"}
                />
              </form>
            )}
            <div className="flex items-center gap-2">
              <Button id="bookings-view-CALENDAR" variant="outline" size="sm" onClick={onNavigateCalendar} className="gap-1.5">
                <CalendarIcon className="h-4 w-4" aria-hidden="true" />
                Calendar
              </Button>
              <Link
                href="/book"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New booking
              </Link>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-panel">
            {mode === "DAY" && (
              <div>
                {/* P1-76: one 44 px toolbar; on phones the filters share the second row. */}
                <div className="flex flex-wrap items-end justify-between gap-3 p-4">
                  <DayStepper label="Queue day" value={date} today={today} onChange={goDay} />
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    {statusSelect}
                    {day.data && (
                      <label className="min-w-0 text-xs font-semibold text-muted-foreground sm:hidden">
                        Queue
                        <Select value={activeQueueTab} onChange={(e) => pickQueue(e.target.value)}>
                          <option value="ALL">All ({all.length})</option>
                          {day.data.queues.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.name} ({x.bookings.length}{x.effectiveCap === null ? "" : `/${x.effectiveCap}`})
                            </option>
                          ))}
                          {Boolean(day.data.legacy.length) && <option value="LEGACY">Legacy ({day.data.legacy.length})</option>}
                        </Select>
                      </label>
                    )}
                  </div>
                </div>

                {day.data && (
                  <p className="px-4 pb-3 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{open.length}</span> bookings ·{" "}
                    <span className="font-semibold tabular-nums text-foreground">
                      {money(open.reduce((n, b) => n + b.totals.currentTotalCentavos, 0))}
                    </span>{" "}
                    current charges ·{" "}
                    <span className="font-semibold text-foreground">{all.filter((b) => b.status === "IN_PROGRESS").length}</span> in progress ·{" "}
                    <span className="font-semibold text-foreground">{all.filter((b) => b.status === "PENDING").length}</span> to confirm
                  </p>
                )}

                {day.data && (
                  <div role="tablist" aria-label="Queues" className="hidden flex-wrap gap-1 border-b border-border px-4 sm:flex">
                    <button type="button" role="tab" aria-selected={activeQueueTab === "ALL"} className={tab(activeQueueTab === "ALL")} onClick={() => pickQueue("ALL")}>
                      All <span className="tabular-nums text-muted-foreground">{all.length}</span>
                    </button>
                    {day.data.queues.map((q) => (
                      <button
                        key={q.code}
                        type="button"
                        role="tab"
                        aria-selected={activeQueueTab === q.code}
                        title={`${q.committed} committed · ${q.effectiveCap === null ? "no limit" : `Limit ${q.effectiveCap}`}${q.isActive ? "" : " · Inactive"}`}
                        className={tab(activeQueueTab === q.code)}
                        onClick={() => pickQueue(q.code)}
                      >
                        {q.name}{" "}
                        <span className="tabular-nums text-muted-foreground">
                          {q.bookings.length}{q.effectiveCap === null ? "" : `/${q.effectiveCap}`}
                        </span>
                      </button>
                    ))}
                    {Boolean(day.data.legacy.length) && (
                      <button type="button" role="tab" aria-selected={activeQueueTab === "LEGACY"} className={tab(activeQueueTab === "LEGACY")} onClick={() => pickQueue("LEGACY")}>
                        Legacy <span className="tabular-nums text-muted-foreground">{day.data.legacy.length}</span>
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
                  <p className="border-b border-amber-500/20 bg-amber-500/10 p-4 text-sm font-semibold text-amber-400">
                    Closed · {day.data.closed.reason}
                  </p>
                )}

                {day.data && (
                  <>
                    <BookingRows
                      bookings={pagedQueueBookings}
                      queueCode={activeQueueTab !== "ALL" && activeQueueTab !== "LEGACY" ? activeQueueTab : undefined}
                      queueNames={queueNames}
                      emptyText="No bookings on this day."
                      filter={filter}
                      role={role}
                      busy={busy}
                      onSelect={setSelected}
                      onReorder={reorder}
                    />
                    {totalQueuePages > 1 && (
                      <Pager
                        label={`${(queuePage - 1) * QUEUE_PAGE_SIZE + 1}–${Math.min(queuePage * QUEUE_PAGE_SIZE, activeBookings.length)} of ${activeBookings.length}`}
                        canPrev={queuePage > 1}
                        canNext={queuePage < totalQueuePages}
                        onPrev={() => setQueuePage((p) => Math.max(1, p - 1))}
                        onNext={() => setQueuePage((p) => Math.min(totalQueuePages, p + 1))}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "SEARCH" && (
              <div>
                <form onSubmit={search} className="flex flex-wrap items-end gap-3 p-4">
                  <label className="min-w-0 flex-1 basis-full text-xs font-semibold text-muted-foreground sm:basis-64">
                    Name, phone, last 4 digits or reference
                    <span className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <input
                        name="q"
                        type="search"
                        maxLength={80}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className={fieldClass + " pl-9 pr-10"}
                        autoComplete="off"
                        placeholder="e.g. Juan Dela Cruz, 0917…, ZEUS-1234"
                      />
                      {q && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          className="absolute right-1 top-1/2 mt-0.5 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          onClick={() => { setQ(""); runSearch({ q: "" }); }}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </label>
                  <label className="text-xs font-semibold text-muted-foreground">
                    Dates
                    <Select
                      aria-label="Date range"
                      value={range}
                      onChange={(e) => {
                        const next = e.target.value as typeof range;
                        setRange(next);
                        if (next !== "CUSTOM") {
                          const r = presetRange(next, today);
                          setSearchFrom(r.from);
                          setSearchTo(r.to);
                          runSearch(r);
                        }
                      }}
                    >
                      <option value="TODAY">Today</option>
                      <option value="TOMORROW">Tomorrow</option>
                      <option value="THIS_WEEK">This week</option>
                      <option value="NEXT_WEEK">Next week</option>
                      <option value="LAST_WEEK">Last week</option>
                      <option value="THIS_MONTH">This month</option>
                      <option value="NEXT_MONTH">Next month</option>
                      <option value="CUSTOM">Custom range…</option>
                    </Select>
                  </label>
                  {range === "CUSTOM" && (
                    <>
                      <label className="text-xs font-semibold text-muted-foreground">
                        From
                        <input name="from" type="date" required value={searchFrom} onChange={(e) => setSearchFrom(e.target.value)} className={dateClass + " block"} />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">
                        To
                        <input name="to" type="date" required value={searchTo} onChange={(e) => setSearchTo(e.target.value)} className={dateClass + " block"} />
                      </label>
                    </>
                  )}
                  {statusSelect}
                  <Button disabled={list.loading} className="px-4">
                    Search
                  </Button>
                </form>

                <LoadState loading={list.loading} error={list.error} retry={list.reload} />
                {list.data && (
                  <div className="border-t border-border">
                    <BookingRows bookings={list.data.items} queueNames={queueNames} showDate emptyText="No bookings match this search." filter="ALL" role={role} busy={busy} onSelect={setSelected} onReorder={reorder} />
                    {(searchPage > 1 || list.data.nextCursor) && (
                      <Pager
                        label={`Page ${searchPage}`}
                        canPrev={searchPage > 1 && !list.loading}
                        canNext={Boolean(list.data.nextCursor) && !list.loading}
                        onPrev={prevSearchPage}
                        onNext={nextSearchPage}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {mode === "HISTORY" && role === "ADMIN" && (
              <div className="space-y-3 p-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const phone = String(new FormData(e.currentTarget).get("phone")).trim();
                    if (phone === historyPhone) void history.reload();
                    else setHistoryPhone(phone);
                  }}
                  className="flex flex-wrap items-end gap-3"
                >
                  <label className="min-w-0 flex-1 basis-full text-xs font-semibold text-muted-foreground sm:basis-64">
                    Customer phone
                    <input name="phone" type="tel" required maxLength={64} autoComplete="off" placeholder="e.g. 09171234567" className={fieldClass} />
                  </label>
                  <Button disabled={history.loading} className="min-h-[40px] px-4">
                    Look up
                  </Button>
                </form>
                <LoadState loading={history.loading} error={history.error} retry={history.reload} />
                {history.data && <HistoryList data={history.data} onOpen={setSelected} />}
              </div>
            )}
          </section>
        </>
      )}

      {/* Standalone History View (if accessed via legacy historyOnly) */}
      {role === "ADMIN" && historyOnly && (
        <section className="rounded-xl border border-border bg-panel p-5 shadow-xs space-y-4">
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
          {history.data && <HistoryList data={history.data} onOpen={setSelected} />}
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
            className="inline-flex flex-wrap gap-1.5 rounded-lg border border-border bg-panel p-1"
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
            className="inline-flex flex-wrap gap-1.5 rounded-lg border border-border bg-panel p-1"
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
