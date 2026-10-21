"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type {
  AdminBoardCard,
  AdminDayBoard,
  AdminWriteResult,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./client";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { shopDate, statusLabel } from "./model";
import { bayPayload, canDrop, plateLabel, writeFeedback } from "./board-model";
import { BookingDetail } from "./booking-detail";
import { DepositBadge } from "./deposit-badge";

export function BayBoard({ role }: { role: UserRole }) {
  const [date, setDate] = React.useState(shopDate),
    [column, setColumn] = React.useState("WASH"),
    [selected, setSelected] = React.useState<string | null>(null);
  const resource = useAdminResource<AdminDayBoard>(
      "/api/admin/board?date=" + date,
    ),
    board = resource.data,
    reloadBoard = resource.reload;
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
  async function refresh() {
    await resource.reload();
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
      setColumn(bayId ?? card.queueCode);
      focus.current = "board-card-" + card.id;
      setMessage("Car moved.");
      await resource.reload();
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
  const columns = board
    ? ["WASH", "DETAILING", "PAINT"].flatMap((type) => [
        ...board.queues
          .filter((q) => q.bayType === type)
          .map((q) => ({
            id: q.code,
            label: "Waiting · " + q.name,
            subtitle: q.bayType,
            cards: q.waiting,
          })),
        ...board.bays
          .filter((b) => b.bayType === type)
          .map((b) => ({
            id: b.id,
            label: b.name,
            subtitle: b.bayType + (b.isActive ? "" : " · Inactive"),
            cards: b.cards,
          })),
      ])
    : [];
  const activeColumn = columns.some((c) => c.id === column)
    ? column
    : (columns[0]?.id ?? "");
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
        <DepositBadge status={card.depositStatus} />
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
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          Board day
          <input
            aria-label="Board day"
            type="date"
            value={date}
            disabled={busy}
            className={fieldClass}
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
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh board
        </Button>
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
          <label className="block text-xs md:hidden">
            Board column
            <select
              aria-label="Board column"
              className={fieldClass}
              value={activeColumn}
              onChange={(e) => setColumn(e.target.value)}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.cards.length})
                </option>
              ))}
            </select>
          </label>
          <div
            className="flex min-w-0 gap-4 overflow-x-auto pb-4 focus-visible:ring-2 focus-visible:ring-primary"
            tabIndex={0}
            aria-label="Bay board, scroll horizontally for all columns"
          >
            {columns.map((c) => (
              <section
                key={c.id}
                aria-label={c.label}
                className={
                  (c.id === activeColumn ? "block " : "hidden ") +
                  "w-full min-w-0 shrink-0 space-y-3 rounded border border-border bg-[#121214] p-3 md:block md:w-72"
                }
                onDragOver={(e) => {
                  if (role === "ADMIN" && !busy && !blocked) e.preventDefault();
                }}
                onDrop={(e) =>
                  drop(
                    e,
                    board.bays.some((b) => b.id === c.id) ? c.id : null,
                    board.queues.some((q) => q.code === c.id)
                      ? c.id
                      : undefined,
                  )
                }
              >
                <h3 tabIndex={-1} className="break-words text-sm font-bold">
                  {c.label} ({c.cards.length})
                </h3>
                <p className="text-xs text-muted-foreground">{c.subtitle}</p>
                {c.cards.map(cardView)}
                {!c.cards.length && (
                  <p className="py-4 text-xs text-muted-foreground">
                    {board.bays.some((b) => b.id === c.id)
                      ? "Bay empty"
                      : "No waiting cars"}
                  </p>
                )}
              </section>
            ))}
          </div>
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
