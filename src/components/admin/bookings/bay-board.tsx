"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type {
  AdminBoardCard,
  AdminDayBoard,
  AdminDoneCard,
  AdminWaitingCard,
  AdminWriteResult,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./client";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { shopDate, statusLabel } from "./model";
import { bayPayload, canDrop, isControlTarget, plateLabel, writeFeedback } from "./board-model";
import { AddBay, addBayButtonId, BayMenu } from "./bay-controls";
import { AddContainer, ContainerMenu, Modal } from "./container-controls";
import { placementPrompt, usualForLine, waitingTag } from "./container-model";
import { BookingDetail } from "./booking-detail";
import { DepositBadge } from "./deposit-badge";

// P1-23: only ADMIN moves cars, and never while a move is being written or its outcome is in doubt.
export const cardDraggable = (role: UserRole, busy: boolean, blocked: boolean) =>
  role === "ADMIN" && !busy && !blocked;

// P1-62 A2 (LE 2026-11-07): one fixed Waiting lane, the containers in the middle, one fixed Done lane. Any car can go in any empty bay;
// a container's optional "usually for" label only asks "Place it anyway?" and never blocks. Phone: three tabs, one zone at a time.
type Zone = "WAITING" | "BAYS" | "DONE";
const ZONES: { id: Zone; label: string }[] = [
  { id: "WAITING", label: "Waiting" },
  { id: "BAYS", label: "Bays" },
  { id: "DONE", label: "Done" },
];
type BoardBay = AdminDayBoard["containers"][number]["bays"][number];
type Pending = { card: AdminBoardCard; bayId: string; text: string };

// One grey outline pill for every service tag: no colour per kind.
const pill = "inline-flex min-w-0 max-w-full items-center truncate rounded-md border border-border bg-[#121214] px-2 py-0.5 text-xs font-medium leading-tight text-muted-foreground";
const lane = "min-w-0 flex-col gap-3 rounded border border-border bg-[#0f0f11] p-3 lg:sticky lg:top-0 lg:h-[calc(100dvh-13rem)] lg:overflow-y-auto";
const finishTime = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });

export function BayBoard({ role }: { role: UserRole }) {
  const [date, setDate] = React.useState(shopDate),
    [selected, setSelected] = React.useState<string | null>(null),
    [zone, setZone] = React.useState<Zone>("BAYS"),
    [pending, setPending] = React.useState<Pending | null>(null);
  const resource = useAdminResource<AdminDayBoard>("/api/admin/board?date=" + date),
    reloadBoardOnly = resource.load;
  // Keep the last board mounted while refetching so lanes never unmount and the scroll position stays put.
  const [lastBoard, setLastBoard] = React.useState<AdminDayBoard | null>(() => resource.data);
  const [boardGen, setBoardGen] = React.useState(0);
  if (resource.data && resource.data !== lastBoard) setLastBoard(resource.data);
  const board = resource.data ?? lastBoard;

  const [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [refusal, setRefusal] = React.useState(false),
    [blocked, setBlocked] = React.useState(false),
    [review, setReview] = React.useState<string | null>(null);
  // F1: after a failed reload the retained cards are stale, so they stay read-only until one succeeds.
  const locked = blocked || resource.error !== null;
  const writing = React.useRef(false),
    mounted = React.useRef(true),
    focus = React.useRef<string | null>(null),
    drag = React.useRef<AdminBoardCard | null>(null),
    pressedControl = React.useRef(false),
    restoreFocus = React.useRef<string | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);

  const showStatus = React.useCallback((text: string, isRefusal = false) => {
    setMessage(text);
    setRefusal(isRefusal);
  }, []);
  const clearDrag = React.useCallback(() => {
    drag.current = null;
    pressedControl.current = false;
    setDragging(null);
  }, []);
  const reloadBoard = React.useCallback(async () => {
    // Reload replaces the source article, so its dragend may never be delivered.
    clearDrag();
    return reloadBoardOnly();
  }, [clearDrag, reloadBoardOnly]);

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
    if (!dragging) return;
    const onEnd = () => clearDrag();
    document.addEventListener("drop", onEnd);
    document.addEventListener("dragend", onEnd);
    window.addEventListener("blur", onEnd);
    return () => {
      document.removeEventListener("drop", onEnd);
      document.removeEventListener("dragend", onEnd);
      window.removeEventListener("blur", onEnd);
    };
  }, [dragging, clearDrag]);

  // After a write, focus goes back to the card; never to <body>.
  React.useEffect(() => {
    if (board && !resource.loading && focus.current && !busy) {
      const target = document.getElementById(focus.current);
      target?.focus({ preventScroll: true });
      if (!target || document.activeElement !== target) document.getElementById("board-status")?.focus({ preventScroll: true });
      focus.current = null;
    }
  }, [board, resource.loading, busy]);
  // P1-30: when the details dialog closes, focus goes back to that card's reference button, else to the day field.
  React.useEffect(() => {
    if (selected !== null || !restoreFocus.current || resource.loading) return;
    const target = document.getElementById(restoreFocus.current) ?? document.getElementById("board-day-input");
    restoreFocus.current = null;
    target?.focus({ preventScroll: true });
  }, [selected, resource.loading]);

  async function bayChanged(text: string) {
    showStatus(text, false);
    await reloadBoard();
  }
  async function refresh() {
    // Only a successful board reload settles an uncertain write; a failed one keeps the lock.
    const loaded = await reloadBoard();
    if (loaded && mounted.current) {
      setBlocked(false);
      setReview(null);
    }
  }
  // Shared by move and finish: the failure handling is the same (sign-in, stale card, unknown outcome).
  async function write(card: AdminBoardCard | AdminDoneCard, work: () => Promise<unknown>, doing: string, done: string, unverified: string, after: Zone) {
    if (role !== "ADMIN" || writing.current || locked) return;
    writing.current = true;
    setBusy(true);
    showStatus(doing, false);
    try {
      await work();
      if (!mounted.current) return;
      setZone(after);
      focus.current = "board-card-" + card.id;
      await reloadBoard();
      showStatus(done, false);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof AdminRequestError && e.status === 401) {
        window.location.replace("/admin/login");
        return;
      }
      const feedback = writeFeedback(e instanceof AdminRequestError ? e.detail : { message: unverified });
      focus.current =
        (feedback.review || !(e instanceof AdminRequestError) || e.commitState === "UNKNOWN" ? "board-card-" : "board-move-") + card.id;
      if (e instanceof AdminRequestError && feedback.review) {
        setBlocked(true);
        setReview(card.id);
      }
      if (!(e instanceof AdminRequestError) || e.commitState === "UNKNOWN") setBlocked(true);
      await resource.reload();
      showStatus(feedback.message, true);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const move = (card: AdminBoardCard, bayId: string | null) =>
    write(card, () => adminRequest<AdminWriteResult>("/api/admin/bookings/" + card.id + "/bay", { method: "PUT", body: bayPayload(card, date, bayId) }),
      "Moving car...", "Car moved.", "Could not verify the move. Refresh before trying again.", bayId ? "BAYS" : "WAITING");

  // P1-34 (LE 2026-10-31): drop a car on Done, or choose "Done (finish)" in its move control. Every service is marked done and the booking
  // completed in one server write, after a confirm in plain words. A car must be in a bay or in service (the server decides too).
  const canFinishCard = (card: AdminBoardCard) => role === "ADMIN" && (card.assignedBayId !== null || card.status === "IN_PROGRESS");
  async function finish(card: AdminBoardCard) {
    if (role !== "ADMIN" || writing.current || locked) return;
    if (!canFinishCard(card)) {
      setBoardGen((g) => g + 1);
      showStatus("Move this car into a bay before finishing it.", true);
      return;
    }
    const sure = window.confirm(
      "Finish " + card.referenceCode + "? All its services will be marked done and the booking completed. A finished car can't be moved back.",
    );
    if (!sure) {
      setBoardGen((g) => g + 1); // the card snaps back to where it was
      return;
    }
    await write(card, () => adminRequest<AdminWriteResult>("/api/admin/bookings/" + card.id + "/finish", { method: "POST", body: { expectedRevision: card.revision } }),
      "Finishing car...", "Car finished.", "Could not verify the finish. Refresh before trying again.", "DONE");
  }

  const containers = board?.containers ?? [];
  const allBays: BoardBay[] = containers.flatMap((c) => c.bays);
  const openCards: AdminBoardCard[] = board ? [...board.waiting, ...allBays.flatMap((b) => b.cards)] : [];
  const queueName = (code: string) => board?.queues.find((q) => q.code === code)?.name ?? code;

  // Placing a car in a bay: any empty active bay takes any car. A labelled container asks once when the car is not what it is usually for.
  function place(card: AdminBoardCard, bayId: string) {
    if (role !== "ADMIN" || busy || locked) return;
    const container = containers.find((c) => c.bays.some((b) => b.id === bayId)),
      bay = allBays.find((b) => b.id === bayId);
    if (!container || !bay) return;
    if (!canDrop(role, card, bay)) {
      setBoardGen((g) => g + 1);
      showStatus(bay.cards.length ? "This bay is busy. The car stayed where it was." : "This bay is not available.", true);
      void resource.reload();
      return;
    }
    const text = placementPrompt({ queueCode: card.queueCode, queueName: queueName(card.queueCode) }, container);
    if (text) setPending({ card, bayId, text });
    else void move(card, bayId);
  }
  function dropOnBay(e: React.DragEvent, bayId: string) {
    e.preventDefault();
    const card = drag.current;
    clearDrag();
    if (card) place(card, bayId);
  }
  function dropOnWaiting(e: React.DragEvent) {
    e.preventDefault();
    const card = drag.current;
    clearDrag();
    if (!card || busy || locked || role !== "ADMIN") return;
    if (card.assignedBayId === null) return;
    void move(card, null);
  }
  function dropOnDone(e: React.DragEvent) {
    e.preventDefault();
    const card = drag.current;
    clearDrag();
    if (!card || busy || locked || role !== "ADMIN") return;
    void finish(card);
  }
  const acceptsDrops = () => role === "ADMIN" && !busy && !locked;

  function openFromCardClick(e: React.MouseEvent<HTMLElement>, id: string) {
    if (isControlTarget(e.target)) return;
    if (window.getSelection()?.toString()) return;
    setSelected(id);
  }
  const emptySlot = "flex min-h-24 items-center justify-center rounded border border-dashed border-border px-3 text-xs text-muted-foreground";

  function doneView(b: AdminDoneCard) {
    return (
      <article
        key={b.id + "-" + boardGen}
        className="min-w-0 cursor-pointer space-y-2 rounded-lg border border-border bg-[#18181b] p-3 leading-tight transition-colors hover:border-border/80"
        aria-label={b.referenceCode}
        onClick={(e) => openFromCardClick(e, b.id)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
          <button
            id={"board-card-" + b.id}
            className="-my-2 inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-left font-mono text-xs font-bold tracking-wide text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setSelected(b.id)}
          >
            {b.referenceCode}
          </button>
          <span data-service-tag className={pill}>{waitingTag({ queueName: b.queueName, lines: b.lines })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 pt-0.5">
          <p className="min-w-0 break-words text-sm font-bold tracking-tight text-foreground">
            {b.vehicleModel} <span className="font-mono text-xs font-semibold text-muted-foreground">· {plateLabel(b.vehiclePlate)}</span>
          </p>
          <span className="shrink-0 rounded border border-border/80 bg-[#121214] px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground">
            {b.sizeCode}
          </span>
        </div>
        <p className="break-words text-xs text-muted-foreground" title={b.lines.map((l) => l.name).join(", ")}>
          Finished {finishTime(b.finishedAt)} · <span className="font-medium text-foreground">{b.workers.map((w) => w.name).join(", ") || "No staff recorded"}</span>
        </p>
      </article>
    );
  }

  function cardView(card: AdminBoardCard) {
    const canDrag = cardDraggable(role, busy, locked);
    const firstLine = card.lines[0];
    const extraLines = Math.max(0, card.lines.length - 1);
    const allLinesTitle = card.lines.map((l) => `${l.name} · ${statusLabel(l.workStatus)}`).join(", ");
    const staffNames = card.assignedWorkers.map((w) => w.name + (w.isActive ? "" : " (inactive)")).join(", ") || "Unassigned";
    return (
      <article
        key={card.id + "-" + boardGen}
        className={
          "min-w-0 space-y-2.5 rounded-lg border border-border bg-[#18181b] p-3 leading-tight transition-colors hover:border-border/80" +
          (canDrag ? " cursor-grab active:cursor-grabbing" : " cursor-pointer") +
          (dragging === card.id ? " opacity-50 ring-2 ring-primary" : "")
        }
        aria-label={card.referenceCode}
        // P1-23 (LE 2026-10-29): the whole ADMIN card is the drag source. A press that starts on a control keeps that control's own behavior.
        draggable={role === "ADMIN" ? canDrag : undefined}
        onPointerDown={(e) => {
          pressedControl.current = Boolean((e.target as Element).closest("button, select, input, textarea, a, label"));
        }}
        onDragStart={(e) => {
          if (!canDrag || pressedControl.current) return e.preventDefault();
          drag.current = card;
          setDragging(card.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.id);
        }}
        onDragEnd={clearDrag}
        // P1-30 (LE 2026-10-30): a click anywhere on the card opens the EXISTING booking details. Controls keep their own behaviour.
        onClick={(e) => openFromCardClick(e, card.id)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
          <button
            id={"board-card-" + card.id}
            className="-my-2 inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-left font-mono text-xs font-bold tracking-wide text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setSelected(card.id)}
          >
            {card.referenceCode}
          </button>
          <span data-service-tag className={pill}>
            {waitingTag({ queueName: "queueName" in card ? (card as AdminWaitingCard).queueName : queueName(card.queueCode), lines: card.lines })}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 pt-0.5">
          <p className="min-w-0 break-words text-sm font-bold tracking-tight text-foreground">
            {card.vehicleModel} <span className="font-mono text-xs font-semibold text-muted-foreground">· {plateLabel(card.vehiclePlate)}</span>
          </p>
          <span className="shrink-0 rounded border border-border/80 bg-[#121214] px-1.5 py-0.5 font-mono text-[11px] font-bold text-foreground">
            {card.sizeCode}
          </span>
        </div>
        {firstLine && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-[#121214] px-2.5 py-1.5 text-xs" title={allLinesTitle}>
            <p className="min-w-0 truncate text-muted-foreground">
              <span className="font-semibold text-foreground">{firstLine.name}</span> · {statusLabel(firstLine.workStatus)}
              {extraLines > 0 ? ` · +${extraLines} more` : ""}
            </p>
            <span className="shrink-0 rounded bg-[#1e1e22] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              · {card.progress.done}/{card.progress.total} done
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs leading-tight text-muted-foreground">
          <span>
            {statusLabel(card.status)}
            {card.bookingDate < date ? " · Carry-over " + card.bookingDate : " · " + card.bookingDate}
          </span>
          <span>
            Staff: <span className="font-medium text-foreground">{staffNames}</span>
          </span>
        </div>
        {card.depositStatus && card.depositStatus !== "NONE" && (
          <p>
            <DepositBadge status={card.depositStatus} />
          </p>
        )}
        {role === "ADMIN" && (
          <form
            className="border-t border-border/50 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("bay"));
              if (value === "DONE") void finish(card);
              else if (value) place(card, value);
              else void move(card, null);
            }}
          >
            <div className="flex items-center gap-1.5">
              <select
                name="bay"
                aria-label={"Move " + card.referenceCode + " to bay"}
                className="min-h-[44px] min-w-0 flex-1 rounded-md border border-border bg-[#121214] px-2.5 py-1 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                defaultValue=""
                disabled={busy || locked}
              >
                <option value="" disabled={!card.assignedBayId}>Waiting</option>
                {containers.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.bays
                      .filter((b) => b.isActive)
                      .map((b) => (
                        <option key={b.id} value={b.id} disabled={!canDrop(role, card, b)}>
                          {b.name}
                          {b.cards.length ? " · Busy" : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
                {canFinishCard(card) && <option value="DONE">Done (finish)</option>}
              </select>
              <Button id={"board-move-" + card.id} size="sm" className="shrink-0 px-3" disabled={busy || locked} type="submit" variant="outline">
                Move car
              </Button>
            </div>
          </form>
        )}
      </article>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center">
        <label className="min-w-0 flex items-center gap-2 text-xs">
          Board day
          <input
            id="board-day-input"
            aria-label="Board day"
            type="date"
            value={date}
            disabled={busy}
            className={fieldClass + " w-44"}
            onChange={(e) => {
              if (e.target.value) {
                clearDrag();
                setDate(e.target.value);
                setSelected(null);
                showStatus("", false);
              }
            }}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        One car per bay until done or returned to Waiting. Any car can go in any empty bay. Earlier open cars stay visible.
      </p>
      <div
        data-board-notice={refusal && message ? "refusal" : undefined}
        className={
          refusal && message
            ? "sticky top-2 z-20 flex items-center justify-between gap-3 rounded border border-amber-500/40 bg-[#18181b] px-3 py-2 text-amber-200 shadow-lg"
            : ""
        }
      >
        <p id="board-status" tabIndex={-1} role="status" aria-live="polite" className="min-w-0 flex-1 break-words text-sm focus:outline-none">
          {message}
        </p>
        {refusal && message && (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-xs text-amber-200 hover:text-foreground" onClick={() => showStatus("", false)}>
            Dismiss
          </Button>
        )}
      </div>
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
      <LoadState loading={!board && resource.loading} error={resource.error} retry={refresh} />
      {board?.closed && <p className="text-sm">Shop closed · {board.closed.reason}</p>}
      {board && (
        <>
          {/* Phone: one zone at a time. From lg all three zones sit side by side. */}
          <div role="group" aria-label="Board area" className="flex gap-2 lg:hidden">
            {ZONES.map((z) => (
              <Button key={z.id} variant={zone === z.id ? "default" : "outline"} className="min-h-[44px] flex-1" aria-pressed={zone === z.id} onClick={() => setZone(z.id)}>
                {z.label} {z.id === "WAITING" ? board.waiting.length : z.id === "DONE" ? board.done.length : allBays.filter((b) => b.cards.length).length}
              </Button>
            ))}
          </div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)_18rem] lg:items-start">
            <section
              aria-label="Waiting"
              data-board-zone="WAITING"
              className={(zone === "WAITING" ? "flex " : "hidden ") + "lg:flex " + lane}
              onDragOver={(e) => { if (acceptsDrops()) e.preventDefault(); }}
              onDrop={dropOnWaiting}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 tabIndex={-1} className="text-base font-bold">Waiting ({board.waiting.length})</h2>
                <span className="text-xs text-muted-foreground">All services</span>
              </div>
              {board.waiting.map(cardView)}
              {!board.waiting.length && <p className={emptySlot + " flex-1"}>No waiting cars</p>}
              <p className="mt-auto text-xs text-muted-foreground">Every waiting car is here. The tag is its main service.{role === "ADMIN" && " Drop a car here to return it to Waiting."}</p>
            </section>

            <div data-board-zone="BAYS" className={(zone === "BAYS" ? "grid " : "hidden ") + "min-w-0 gap-3 lg:grid"}>
              {containers.map((c) => {
                const shown = c.bays.filter((b) => b.isActive || b.cards.length);
                return (
                  <article key={c.id} aria-label={c.name} data-container={c.id} className="min-w-0 space-y-3 rounded border border-border bg-[#0f0f11] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 tabIndex={-1} className="break-words text-base font-bold">{c.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {usualForLine(c.usualQueues)} · {shown.filter((b) => b.cards.length).length} of {shown.length} in use
                        </p>
                      </div>
                      {role === "ADMIN" && (
                        <div className="flex shrink-0 items-center gap-2">
                          <AddBay containerId={c.id} label={c.name} bays={board.bays} onDone={(text) => { focus.current = addBayButtonId(c.id); return bayChanged(text); }} />
                          <ContainerMenu container={c} containers={containers} queues={board.queues} onDone={bayChanged} />
                        </div>
                      )}
                    </div>
                    <div data-board-row-scroll className="flex gap-3 overflow-x-auto pb-1">
                      {shown.map((b) => (
                        <section
                          key={b.id}
                          aria-label={b.name}
                          data-board-column={b.id}
                          className="flex min-w-[17rem] max-w-[21rem] flex-1 shrink-0 flex-col gap-2.5 rounded-lg border border-border bg-[#121214] p-3"
                          onDragOver={(e) => { if (acceptsDrops()) e.preventDefault(); }}
                          onDrop={(e) => dropOnBay(e, b.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <h4 tabIndex={-1} className="min-w-0 break-words text-sm font-bold">{b.name}</h4>
                            {role === "ADMIN" && b.isActive && <BayMenu bay={b} bays={board.bays} containers={containers} onDone={bayChanged} />}
                          </div>
                          {!b.isActive && <p className="text-xs text-muted-foreground">Inactive</p>}
                          {b.cards.map(cardView)}
                          {!b.cards.length && <p className={emptySlot + " flex-1"}>{role === "ADMIN" ? "Empty. Drop a car here." : "Empty."}</p>}
                        </section>
                      ))}
                      {!shown.length && <p className={emptySlot + " flex-1"}>{role === "ADMIN" ? "No bays yet. Use Add bay." : "No bays yet."}</p>}
                    </div>
                  </article>
                );
              })}
              {role === "ADMIN" && <AddContainer containers={containers} onDone={bayChanged} />}
            </div>

            <section
              aria-label="Done"
              data-board-zone="DONE"
              className={(zone === "DONE" ? "flex " : "hidden ") + "lg:flex " + lane}
              onDragOver={(e) => { if (acceptsDrops()) e.preventDefault(); }}
              onDrop={dropOnDone}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 tabIndex={-1} className="text-base font-bold">Done ({board.done.length})</h2>
                <span className="text-xs text-muted-foreground">Finished</span>
              </div>
              {board.done.map(doneView)}
              {!board.done.length && <p className={emptySlot + " flex-1"}>No cars finished yet</p>}
              <p className="mt-auto text-xs text-muted-foreground">{role === "ADMIN" && "Drop a finished car here, or use Done (finish) on its card. "}Shows who worked and when it finished.</p>
            </section>
          </div>
          <p className="text-xs text-muted-foreground">
            {openCards.length} open cars · Open a card for the service checklist and assigned staff.
          </p>
        </>
      )}
      {pending && (
        <Modal id="place-anyway" title="Place it anyway?" onClose={() => { setPending(null); setBoardGen((g) => g + 1); }}>
          <p className="text-sm">{pending.text}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => { setPending(null); setBoardGen((g) => g + 1); }}>Cancel</Button>
            <Button onClick={() => { const p = pending; setPending(null); void move(p.card, p.bayId); }}>Place it anyway</Button>
          </div>
        </Modal>
      )}
      {selected && (
        <BookingDetail
          key={selected}
          id={selected}
          role={role}
          queues={board?.queues.map((q) => ({ ...q, isActive: true, effectiveCap: null, committed: q.waiting.length, bookings: [] })) ?? []}
          onChanged={refresh}
          onClose={() => {
            restoreFocus.current = "board-card-" + selected;
            setSelected(null);
            if (review) void refresh();
          }}
        />
      )}
    </div>
  );
}
