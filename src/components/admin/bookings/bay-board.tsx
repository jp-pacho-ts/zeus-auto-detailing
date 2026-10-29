"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type {
  AdminBoardCard,
  AdminDayBoard,
  AdminDayQueues,
  AdminQueueBooking,
  AdminWriteResult,
  BayType,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./client";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { shopDate, statusLabel } from "./model";
import {
  bayPayload,
  boardLanes,
  canDrop,
  plateLabel,
  writeFeedback,
} from "./board-model";
import { AddBay, addBayButtonId, BayMenu } from "./bay-controls";
import { BookingDetail } from "./booking-detail";
import { DepositBadge } from "./deposit-badge";

// viewSwitch: BookingsTab's Board / List switch, drawn on the left of the board toolbar (P1-22).
export function BayBoard({ role, viewSwitch }: { role: UserRole; viewSwitch?: React.ReactNode }) {
  const [date, setDate] = React.useState(shopDate),
    [picked, setPicked] = React.useState<Partial<Record<BayType, string>>>({}),
    [selected, setSelected] = React.useState<string | null>(null);
  const resource = useAdminResource<AdminDayBoard>(
      "/api/admin/board?date=" + date,
    ),
    board = resource.data,
    reloadBoardOnly = resource.reload;
  // Done: the day's completed visits come from the day queue view (read-only).
  const dayView = useAdminResource<AdminDayQueues>(
      "/api/admin/queues?date=" + date,
    ),
    reloadDay = dayView.reload;
  const reloadBoard = React.useCallback(async () => {
    await Promise.all([reloadBoardOnly(), reloadDay()]);
  }, [reloadBoardOnly, reloadDay]);
  const [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [blocked, setBlocked] = React.useState(false),
    [review, setReview] = React.useState<string | null>(null);
  const writing = React.useRef(false),
    mounted = React.useRef(true),
    focus = React.useRef<string | null>(null),
    drag = React.useRef<AdminBoardCard | null>(null);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    const onFocus = () => {
      if (!writing.current) void reloadBoard();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadBoard]);
  React.useEffect(() => {
    if (board && focus.current && !busy) {
      document.getElementById(focus.current)?.focus();
      focus.current = null;
    }
  }, [board, busy]);
  async function bayChanged(text: string) {
    setMessage(text);
    await reloadBoard();
  }
  async function refresh() {
    await reloadBoard();
    if (mounted.current) {
      setBlocked(false);
      setReview(null);
    }
  }
  async function move(card: AdminBoardCard, bayId: string | null) {
    if (role !== "ADMIN" || writing.current || blocked) return;
    writing.current = true;
    setBusy(true);
    setMessage("Moving car...");
    try {
      await adminRequest<AdminWriteResult>(
        "/api/admin/bookings/" + card.id + "/bay",
        { method: "PUT", body: bayPayload(card, date, bayId) },
      );
      if (!mounted.current) return;
      const lane = board?.queues.find((q) => q.code === card.queueCode)?.bayType;
      if (lane) setPicked((p) => ({ ...p, [lane]: bayId ?? card.queueCode }));
      focus.current = "board-card-" + card.id;
      setMessage("Car moved.");
      await reloadBoard();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof AdminRequestError && e.status === 401) {
        window.location.replace("/admin/login");
        return;
      }
      const feedback = writeFeedback(
        e instanceof AdminRequestError
          ? e.detail
          : {
              message:
                "Could not verify the move. Refresh before trying again.",
            },
      );
      focus.current =
        (feedback.review ||
        !(e instanceof AdminRequestError) ||
        e.commitState === "UNKNOWN"
          ? "board-card-"
          : "board-move-") + card.id;
      setMessage(feedback.message);
      if (e instanceof AdminRequestError && feedback.review) {
        setBlocked(true);
        setReview(card.id);
      }
      if (!(e instanceof AdminRequestError) || e.commitState === "UNKNOWN")
        setBlocked(true);
      await resource.reload();
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const cards = board
    ? [
        ...board.queues.flatMap((q) => q.waiting),
        ...board.bays.flatMap((b) => b.cards),
      ]
    : [];
  function drop(e: React.DragEvent, bayId: string | null, queue?: string) {
    e.preventDefault();
    const card = drag.current;
    drag.current = null;
    if (!card || busy || blocked || role !== "ADMIN") return;
    if (queue && (card.queueCode !== queue || card.assignedBayId === null)) {
      setMessage("Return a car to its own Waiting queue.");
      return;
    }
    const bay = board?.bays.find((b) => b.id === bayId),
      allowed = board?.queues.find((q) => q.code === card.queueCode)?.bayType;
    if (bay && !canDrop(role, card, bay, allowed)) {
      setMessage(
        bay.cards.length
          ? "This bay is busy. The car stayed in its column."
          : "This bay does not take this queue.",
      );
      void resource.reload();
      return;
    }
    void move(card, bayId);
  }
  // One row per bay type: Waiting queue(s) -> bays -> Done. Below md each row shows one picked
  // column; from md the row's columns wrap, so nothing scrolls sideways.
  const lanes = board
    ? boardLanes(board, dayView.data).map((lane) => {
        const columns = [
          ...lane.waiting.map((q) => ({
            id: q.code,
            label: "Waiting · " + q.name,
            subtitle: "",
            cards: q.waiting,
            done: null,
            bay: null,
          })),
          ...lane.bays.map((b) => ({
            id: b.id,
            label: b.name,
            subtitle: b.isActive ? "" : "Inactive",
            cards: b.cards,
            done: null,
            bay: b.isActive ? b : null,
          })),
          {
            id: "DONE-" + lane.bayType,
            label: "Done · " + lane.label,
            subtitle: "Finished today",
            cards: [] as AdminBoardCard[],
            done: lane.done,
            bay: null,
          },
        ];
        const want = picked[lane.bayType];
        return {
          ...lane,
          columns,
          active: columns.some((c) => c.id === want) ? want! : columns[0].id,
        };
      })
    : [];
  // Card heights measured for P1-22: ADMIN about 410px (move controls), STAFF about 226px.
  const emptySlot =
    "flex min-h-24 flex-1 items-center justify-center px-3 text-xs text-muted-foreground " +
    (role === "ADMIN" ? "md:min-h-[26rem]" : "md:min-h-[14rem]");
  function doneView(b: AdminQueueBooking) {
    return (
      <article
        key={b.id}
        className="min-w-0 space-y-1 rounded border border-border bg-[#18181b] p-4"
        aria-label={b.referenceCode}
      >
        <button
          className="min-h-[44px] break-all text-left font-mono font-bold text-primary underline focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setSelected(b.id)}
        >
          {b.referenceCode}
        </button>
        <p className="break-words text-sm font-semibold">
          {b.vehicleModel} · {plateLabel(b.vehiclePlate)}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {b.lines
            .filter((l) => !l.removed)
            .map((l) => l.name)
            .join(", ") || b.serviceName}
        </p>
      </article>
    );
  }
  function cardView(card: AdminBoardCard) {
    const allowed = board?.queues.find(
      (q) => q.code === card.queueCode,
    )?.bayType;
    return (
      <article
        key={card.id}
        className="min-w-0 space-y-3 rounded border border-border bg-[#18181b] p-4"
        aria-label={card.referenceCode}
      >
        <button
          id={"board-card-" + card.id}
          className="min-h-[44px] break-all text-left font-mono font-bold text-primary underline focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setSelected(card.id)}
        >
          {card.referenceCode}
        </button>
        <p className="break-words text-sm font-semibold">
          {card.vehicleModel} · {plateLabel(card.vehiclePlate)}
        </p>
        <p className="text-xs text-muted-foreground">
          {card.sizeCode} · {statusLabel(card.status)}
          {card.bookingDate < date
            ? " · Carry-over " + card.bookingDate
            : " · " + card.bookingDate}
        </p>
        <ul className="space-y-1 break-words text-sm">
          {card.lines.map((l) => (
            <li key={l.id}>
              {l.name} · {statusLabel(l.workStatus)}
            </li>
          ))}
        </ul>
        <p className="break-words text-xs">
          Staff:{" "}
          {card.assignedWorkers
            .map((w) => w.name + (w.isActive ? "" : " (inactive)"))
            .join(", ") || "Unassigned"}
        </p>
        <p className="text-xs" aria-label="Service progress">
          {card.progress.done}/{card.progress.total} done
        </p>
        {card.depositStatus !== "NONE" && (
          <p>
            <DepositBadge status={card.depositStatus} />
          </p>
        )}
        {role === "ADMIN" && (
          <>
            <button
              type="button"
              draggable={!busy && !blocked}
              disabled={busy || blocked}
              aria-label={"Drag " + card.referenceCode}
              className="min-h-[44px] text-xs underline focus-visible:ring-2 focus-visible:ring-primary"
              onDragStart={(e) => {
                drag.current = card;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", card.id);
              }}
              onDragEnd={() => {
                drag.current = null;
              }}
            >
              Drag to bay
            </button>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const value = String(new FormData(e.currentTarget).get("bay"));
                void move(card, value || null);
              }}
            >
              <label className="block text-xs">
                Move {card.referenceCode} to bay
                <select
                  name="bay"
                  aria-label={"Move " + card.referenceCode + " to bay"}
                  className={fieldClass}
                  defaultValue=""
                  disabled={busy || blocked}
                >
                  <option value="" disabled={!card.assignedBayId}>
                    Waiting ·{" "}
                    {board?.queues.find((q) => q.code === card.queueCode)?.name}
                  </option>
                  {board?.bays
                    .filter((b) => b.bayType === allowed)
                    .map((b) => (
                      <option
                        key={b.id}
                        value={b.id}
                        disabled={!canDrop(role, card, b, allowed)}
                      >
                        {b.name}
                        {b.cards.length ? " · Busy" : ""}
                        {!b.isActive ? " · Inactive" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                id={"board-move-" + card.id}
                disabled={busy || blocked}
                type="submit"
                variant="outline"
              >
                Move car
              </Button>
            </form>
          </>
        )}
      </article>
    );
  }
  return (
    <div className="min-w-0 space-y-4">
      {/* P1-22: one toolbar row from lg (switch left, day and refresh right); two lines below. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        {viewSwitch}
        <div className="flex items-end gap-3">
          <label className="min-w-0 flex-1 text-xs lg:flex lg:flex-none lg:items-center lg:gap-2">
            Board day
            <input
              aria-label="Board day"
              type="date"
              value={date}
              disabled={busy}
              className={fieldClass + " lg:mt-0 lg:w-44"}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setSelected(null);
                  setMessage("");
                }
              }}
            />
          </label>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void refresh()}
            disabled={busy}
          >
            Refresh board
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        One car per bay until done or returned to Waiting. Earlier open cars
        stay visible.
      </p>
      <p role="status" aria-live="polite" className="break-words text-sm">
        {message}
      </p>
      {blocked && (
        <div role="alert" className="text-sm">
          {review
            ? "Someone changed this booking. Review its current revision before another move."
            : "The move outcome is uncertain. Refresh before another move."}
          {review && (
            <Button variant="outline" onClick={() => setSelected(review)}>
              Review current booking
            </Button>
          )}
        </div>
      )}
      <LoadState
        loading={resource.loading}
        error={resource.error}
        retry={refresh}
      />
      {board?.closed && (
        <p className="text-sm">Shop closed · {board.closed.reason}</p>
      )}
      {board && (
        <>
          {lanes.map((lane) => (
            <section
              key={lane.bayType}
              aria-label={lane.label + " row"}
              className="min-w-0 space-y-3 rounded border border-border bg-[#0f0f11] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="text-base font-bold">{lane.label}</h2>
                  <p className="text-xs text-muted-foreground">
                    {lane.counts.waiting} waiting · {lane.counts.inBay} in bay ·{" "}
                    {lane.counts.done} done
                  </p>
                </div>
                {role === "ADMIN" && (
                  <AddBay
                    bayType={lane.bayType}
                    label={lane.label}
                    bays={board.bays}
                    onDone={(text) => {
                      focus.current = addBayButtonId(lane.bayType);
                      return bayChanged(text);
                    }}
                  />
                )}
              </div>
              <label className="block text-xs md:hidden">
                Board column
                <select
                  aria-label={lane.label + " board column"}
                  className={fieldClass}
                  value={lane.active}
                  onChange={(e) =>
                    setPicked((p) => ({ ...p, [lane.bayType]: e.target.value }))
                  }
                >
                  {lane.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.done ? c.done.length : c.cards.length})
                    </option>
                  ))}
                </select>
              </label>
              {/* P1-22: columns stretch to the row's tallest; an empty slot is one card tall from md. */}
              <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
                {lane.columns.map((c) => (
                  <section
                    key={c.id}
                    aria-label={c.label}
                    className={
                      (c.id === lane.active ? "flex " : "hidden ") +
                      "min-w-0 flex-col gap-3 rounded border border-border bg-[#121214] p-3 md:flex"
                    }
                    onDragOver={(e) => {
                      if (!c.done && role === "ADMIN" && !busy && !blocked)
                        e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (c.done) return;
                      drop(
                        e,
                        board.bays.some((b) => b.id === c.id) ? c.id : null,
                        board.queues.some((q) => q.code === c.id)
                          ? c.id
                          : undefined,
                      );
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 tabIndex={-1} className="min-w-0 break-words py-2 text-sm font-bold">
                        {c.label} ({c.done ? c.done.length : c.cards.length})
                      </h3>
                      {role === "ADMIN" && c.bay && (
                        <BayMenu bay={c.bay} bays={board.bays} onDone={bayChanged} />
                      )}
                    </div>
                    {c.subtitle && (
                      <p className="text-xs text-muted-foreground">{c.subtitle}</p>
                    )}
                    {c.done ? (
                      <>
                        {dayView.error && (
                          <p role="alert" className="text-xs text-rose-400">
                            Finished cars could not load. Refresh the board.
                          </p>
                        )}
                        {c.done.map(doneView)}
                        {!c.done.length && !dayView.error && (
                          <p className={emptySlot}>
                            {dayView.loading ? "Loading..." : "No cars finished yet"}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        {c.cards.map(cardView)}
                        {!c.cards.length && (
                          <p className={emptySlot + " rounded border border-dashed border-border"}>
                            {board.bays.some((b) => b.id === c.id)
                              ? "Bay empty"
                              : "No waiting cars"}
                          </p>
                        )}
                      </>
                    )}
                  </section>
                ))}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            {cards.length} open cars · Open a card for the service checklist and
            assigned staff.
          </p>
        </>
      )}
      {selected && (
        <BookingDetail
          key={selected}
          id={selected}
          role={role}
          queues={
            board?.queues.map((q) => ({
              ...q,
              isActive: true,
              effectiveCap: null,
              committed: q.waiting.length,
              bookings: [],
            })) ?? []
          }
          onChanged={refresh}
          onClose={() => {
            setSelected(null);
            if (review) void refresh();
          }}
        />
      )}
    </div>
  );
}
