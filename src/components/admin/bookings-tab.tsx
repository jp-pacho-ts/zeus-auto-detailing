"use client";
import * as React from "react";
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
import { BayBoard } from "./bookings/bay-board";
import { CapSettings } from "./bookings/cap-settings";

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
  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      aria-label="Bookings table, scroll horizontally for more columns"
    >
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-[#18181b] text-muted-foreground">
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
                className="p-4 font-semibold uppercase tracking-wider"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filtered(bookings).map((b) => (
            <tr key={b.id} className="hover:bg-[#18181b]/50">
              <td className="p-4 font-mono font-bold text-primary">
                <button
                  className="min-h-[44px] underline focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => onSelect(b.id)}
                >
                  {b.referenceCode}
                </button>
              </td>
              <td className="p-4 font-medium">
                {b.customerName}
                <p className="text-muted-foreground">{b.vehicleModel}</p>
              </td>
              <td className="p-4 text-muted-foreground">
                {b.lines
                  .filter((l) => !l.removed)
                  .map((l) => l.name)
                  .join(", ") || b.serviceName}
              </td>
              <td className="p-4 text-muted-foreground">
                {b.bookingDate}
                <p>{b.bay?.name ?? "Unassigned"}</p>
              </td>
              <td className="p-4">
                <span
                  className={`inline-block rounded border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.status === "CONFIRMED" || b.status === "COMPLETED" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" : b.status === "PENDING" ? "border-amber-500/30 bg-amber-500/15 text-amber-400" : b.status === "IN_PROGRESS" ? "border-blue-500/30 bg-blue-500/15 text-blue-400" : "border-rose-500/30 bg-rose-500/15 text-rose-400"}`}
                >
                  {statusLabel(b.status)}
                </span>
              </td>
              <td className="p-4 tabular-nums">{totalLabel(b.totals)}</td>
              <td className="p-4">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onSelect(b.id)}>
                    Open
                  </Button>
                  {role === "ADMIN" &&
                    queueCode &&
                    b.status !== "CANCELLED" &&
                    ([-1, 1] as const).map((direction) => (
                      <Button
                        key={direction}
                        variant="outline"
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
      {filtered(bookings).length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          No bookings match this view.
        </p>
      )}
    </div>
  );
}

function BookingsList({
  role,
  showCaps = false,
}: {
  role: UserRole;
  showCaps?: boolean;
}) {
  const [date, setDate] = React.useState(shopDate),
    [filter, setFilter] = React.useState("ALL"),
    [selected, setSelected] = React.useState<string | null>(null),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null);
  const day = useAdminResource<AdminDayQueues>(
    `/api/admin/queues?date=${date}`,
  );
  const [listing, setListing] = React.useState<{
      url: string;
      body?: string;
    } | null>(null),
    [historyPhone, setHistoryPhone] = React.useState<string | null>(null);
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
  const all = day.data
    ? [...day.data.queues.flatMap((q) => q.bookings), ...day.data.legacy]
    : [];
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
  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      q = String(form.get("q")).trim(),
      from = String(form.get("from")),
      to = String(form.get("to")),
      status = String(form.get("status"));
    const params = {
      from,
      to,
      limit: 25,
      ...(status === "ALL" ? {} : { status: [status] }),
    };
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
  function nextPage() {
    if (!list.data?.nextCursor || !listing) return;
    if (listing.body)
      setListing({
        ...listing,
        body: JSON.stringify({
          ...JSON.parse(listing.body),
          cursor: list.data.nextCursor,
        }),
      });
    else
      setListing({
        ...listing,
        url:
          listing.url.replace(/&cursor=[^&]*/, "") +
          `&cursor=${encodeURIComponent(list.data.nextCursor)}`,
      });
  }
  return (
    <div className="space-y-6">
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
      <section className="rounded border border-border bg-[#121214]">
        <div className="flex flex-wrap items-end gap-4 border-b border-border p-4">
          <label className="text-xs">
            Queue day
            <input
              type="date"
              value={date}
              required
              className={fieldClass}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setSelected(null);
                  setListing(null);
                  setHistoryPhone(null);
                  setError(null);
                }
              }}
            />
          </label>
          <label className="text-xs">
            Booking status
            <select
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
          <Button
            variant="outline"
            disabled={busy || day.loading}
            onClick={() => void day.reload()}
          >
            Refresh queues
          </Button>
        </div>
        <LoadState loading={day.loading} error={day.error} retry={day.reload} />
        {error && (
          <p role="alert" className="p-4 text-sm text-rose-400">
            {error} The queue has been refreshed; review it before another
            change.
          </p>
        )}
        {day.data?.closed && (
          <p className="p-4 text-sm text-amber-400">
            Closed · {day.data.closed.reason}
          </p>
        )}
        {day.data?.queues.map((q) => (
          <section key={q.code} aria-label={q.name + " queue"}>
            <div className="border-y border-border bg-[#18181b] p-4">
              <h2 className="text-sm font-bold">{q.name}</h2>
              <p className="text-xs text-muted-foreground">
                {q.committed} committed ·{" "}
                {q.effectiveCap === null
                  ? "no limit"
                  : `Limit ${q.effectiveCap}`}
                {!q.isActive ? " · Inactive" : ""}
              </p>
            </div>
            <BookingRows
              bookings={q.bookings}
              queueCode={q.code}
              filter={filter}
              role={role}
              busy={busy}
              onSelect={setSelected}
              onReorder={reorder}
            />
          </section>
        ))}
        {Boolean(day.data?.legacy.length) && (
          <section>
            <h2 className="p-4 font-bold">Legacy bookings</h2>
            <BookingRows
              bookings={day.data!.legacy}
              filter={filter}
              role={role}
              busy={busy}
              onSelect={setSelected}
              onReorder={reorder}
            />
          </section>
        )}
      </section>
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
      <section className="rounded border border-border bg-[#121214] p-4">
        <h2 className="font-bold">Find bookings</h2>
        <form
          key={date}
          onSubmit={search}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
            Name, phone, last 4 digits or reference
            <input
              name="q"
              maxLength={80}
              className={fieldClass}
              autoComplete="off"
            />
          </label>
          <label className="text-xs">
            From
            <input
              name="from"
              type="date"
              required
              defaultValue={date}
              className={fieldClass}
            />
          </label>
          <label className="text-xs">
            To
            <input
              name="to"
              type="date"
              required
              defaultValue={date}
              className={fieldClass}
            />
          </label>
          <label className="text-xs">
            Search status
            <select name="status" className={fieldClass}>
              {[
                "ALL",
                "PENDING",
                "CONFIRMED",
                "IN_PROGRESS",
                "COMPLETED",
                "CANCELLED",
              ].map((s) => (
                <option key={s} value={s}>
                  {s === "ALL" ? "All" : statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={list.loading}>Search bookings</Button>
          {listing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setListing(null)}
            >
              Clear search
            </Button>
          )}
        </form>
        <LoadState
          loading={list.loading}
          error={list.error}
          retry={list.reload}
        />
        {list.data && (
          <>
            <BookingRows
              bookings={list.data.items}
              filter="ALL"
              role={role}
              busy={busy}
              onSelect={setSelected}
              onReorder={reorder}
            />
            {list.data.nextCursor && (
              <Button variant="outline" onClick={nextPage}>
                Next bookings page
              </Button>
            )}
          </>
        )}
      </section>
      {role === "ADMIN" && (
        <section className="rounded border border-border bg-[#121214] p-4">
          <h2 className="font-bold">Customer booking history</h2>
          <p className="text-xs text-muted-foreground">
            Read-only phone lookup. Nothing is saved in browser storage.
          </p>
          <form
            key={date}
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const phone = String(new FormData(e.currentTarget).get("phone"));
              if (phone === historyPhone) void history.reload();
              else setHistoryPhone(phone);
            }}
          >
            <label className="min-w-0 basis-full sm:basis-0 flex-1 text-xs">
              Customer phone
              <input
                name="phone"
                required
                maxLength={64}
                autoComplete="off"
                className={fieldClass}
              />
            </label>
            <Button disabled={history.loading}>Look up history</Button>
            <Button
              type="reset"
              variant="outline"
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
              {history.data.bookings.length === 0 && (
                <p className="text-sm">No bookings found.</p>
              )}
              {history.data.bookings.map((b) => (
                <button
                  key={b.id}
                  className="block min-h-[44px] w-full rounded border border-border p-3 text-left text-sm hover:bg-[#18181b] focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setSelected(b.id)}
                >
                  {b.referenceCode} · {b.bookingDate} · {b.queueName} ·{" "}
                  {statusLabel(b.status)}
                  <span className="block text-xs text-muted-foreground">
                    {b.services.join(", ")} · {totalLabel(b.totals)}
                  </span>
                </button>
              ))}
              {history.data.truncated && (
                <p className="text-xs">Showing the latest 50 bookings.</p>
              )}
            </div>
          )}
        </section>
      )}
      {showCaps && role === "ADMIN" && (
        <CapSettings key={date} date={date} onChanged={day.reload} />
      )}
    </div>
  );
}

// Keep Calendar's existing list/cap view. Bookings opens on the operational board.
export function BookingsTab({
  role,
  showCaps = false,
}: {
  role: UserRole;
  showCaps?: boolean;
}) {
  const [view, setView] = React.useState<"BOARD" | "LIST">("BOARD");
  if (showCaps) return <BookingsList role={role} showCaps />;
  return (
    <div className="min-w-0 space-y-4">
      <div role="group" aria-label="Bookings view" className="flex gap-2">
        <Button
          variant={view === "BOARD" ? "default" : "outline"}
          aria-pressed={view === "BOARD"}
          onClick={() => setView("BOARD")}
        >
          Board
        </Button>
        <Button
          variant={view === "LIST" ? "default" : "outline"}
          aria-pressed={view === "LIST"}
          onClick={() => setView("LIST")}
        >
          List / history
        </Button>
      </div>
      {view === "BOARD" ? (
        <BayBoard role={role} />
      ) : (
        <BookingsList role={role} />
      )}
    </div>
  );
}
