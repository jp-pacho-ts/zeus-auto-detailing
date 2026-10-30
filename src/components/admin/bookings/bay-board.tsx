"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
   BOARD_LANES,
  bayPayload,
  boardLanes,
  canDrop,
  plateLabel,
  writeFeedback,
} from "./board-model";
import { AddBay, addBayButtonId, BayMenu } from "./bay-controls";
import { BookingDetail } from "./booking-detail";
import { DepositBadge } from "./deposit-badge";

// P1-23: only ADMIN moves cars, and never while a move is being written or its outcome is in doubt.
export const cardDraggable = (role: UserRole, busy: boolean, blocked: boolean) =>
  role === "ADMIN" && !busy && !blocked;

// P1-25 Section 3: controlled edge auto-scroll speed curve while dragging a card.
export const EDGE_ZONE_MAX = 80;
export const EDGE_OUTSIDE = 40;
export const EDGE_SPEED_MIN = 150;
export const EDGE_SPEED_SPAN = 850;
export const FADE_WIDTH_PX = 48;
export const COLUMN_STEP_PX = 252;

export function edgeScrollStep(
  pointerX: number,
  pointerY: number,
  rect: { left: number; right: number; top: number; bottom: number; width: number },
  scroll: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  dtMs: number,
): { dir: -1 | 0 | 1; speed: number; delta: number } {
  if (pointerY < rect.top || pointerY > rect.bottom || rect.width <= 0) {
    return { dir: 0, speed: 0, delta: 0 };
  }
  const zone = Math.min(EDGE_ZONE_MAX, rect.width / 4);
  let dir: -1 | 0 | 1 = 0;
  let depth = 0;
  if (pointerX < rect.left + zone && pointerX > rect.left - EDGE_OUTSIDE) {
    dir = -1;
    depth = (rect.left + zone - pointerX) / zone;
  } else if (pointerX > rect.right - zone && pointerX < rect.right + EDGE_OUTSIDE) {
    dir = 1;
    depth = (pointerX - (rect.right - zone)) / zone;
  }
  depth = Math.min(1, Math.max(0, depth));
  if (!dir || depth <= 0) return { dir: 0, speed: 0, delta: 0 };
  const canScroll =
    dir < 0
      ? scroll.scrollLeft > 0
      : scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1;
  if (!canScroll) return { dir: 0, speed: 0, delta: 0 };
  const dt = Math.max(0, Math.min(50, dtMs)) / 1000;
  const speed = EDGE_SPEED_MIN + EDGE_SPEED_SPAN * depth * depth;
  return { dir, speed, delta: dir * speed * dt };
}

// P1-25 Section 9B: reveal destination column sideways only (never scrollIntoView).
export function revealColumnScrollLeft(
  col: { offsetLeft: number; offsetWidth: number },
  scroller: { scrollLeft: number; clientWidth: number; scrollWidth: number },
): number {
  const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  if (maxScroll <= 0) return 0;
  if (col.offsetLeft < scroller.scrollLeft + FADE_WIDTH_PX) {
    return Math.max(0, Math.min(maxScroll, col.offsetLeft - FADE_WIDTH_PX));
  }
  if (
    col.offsetLeft + col.offsetWidth >
    scroller.scrollLeft + scroller.clientWidth - FADE_WIDTH_PX
  ) {
    return Math.max(
      0,
      Math.min(
        maxScroll,
        col.offsetLeft + col.offsetWidth - scroller.clientWidth + FADE_WIDTH_PX,
      ),
    );
  }
  return scroller.scrollLeft;
}

type RowCueState = {
  measured: boolean;
  overflow: boolean;
  left: boolean;
  right: boolean;
  hotDir: -1 | 0 | 1;
};

const INITIAL_CUE: RowCueState = {
  measured: false,
  overflow: false,
  left: false,
  right: false,
  hotDir: 0,
};

// viewSwitch: BookingsTab's Board / List switch, drawn on the left of the board toolbar (P1-22).
export function BayBoard({
  role,
  viewSwitch,
}: {
  role: UserRole;
  viewSwitch?: React.ReactNode;
}) {
  const [date, setDate] = React.useState(shopDate),
    [picked, setPicked] = React.useState<Partial<Record<BayType, string>>>({}),
    [selected, setSelected] = React.useState<string | null>(null);
  const resource = useAdminResource<AdminDayBoard>(
      "/api/admin/board?date=" + date,
    ),
    reloadBoardOnly = resource.reload;
  // Done: the day's completed visits come from the day queue view (read-only).
  const dayView = useAdminResource<AdminDayQueues>(
      "/api/admin/queues?date=" + date,
    ),
    reloadDay = dayView.reload;

  // P1-25 Section 9B: keep the last board and day queues mounted while refetching so rows never
  // unmount and #admin-content.scrollTop / row scrollLeft stay put.
  const [lastBoard, setLastBoard] = React.useState<AdminDayBoard | null>(
    () => resource.data,
  );
  const [boardGen, setBoardGen] = React.useState(0);
  const [lastDay, setLastDay] = React.useState<AdminDayQueues | null>(
    () => dayView.data,
  );
  if (resource.data && resource.data !== lastBoard) {
    setLastBoard(resource.data);
  }
  if (dayView.data && dayView.data !== lastDay) {
    setLastDay(dayView.data);
  }
  const board = resource.data ?? lastBoard;
  const dayData =
    dayView.data ??
    (lastDay?.date === board?.date ? lastDay : null);

  const [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [refusal, setRefusal] = React.useState(false),
    [blocked, setBlocked] = React.useState(false),
    [review, setReview] = React.useState<string | null>(null);
  const writing = React.useRef(false),
    mounted = React.useRef(true),
    focus = React.useRef<string | null>(null),
    reveal = React.useRef<{ lane: BayType; colId: string } | null>(null),
    drag = React.useRef<AdminBoardCard | null>(null),
    pressedControl = React.useRef(false);
  const [dragging, setDragging] = React.useState<string | null>(null);

  const scrollerRefs = React.useRef<Partial<Record<BayType, HTMLDivElement | null>>>({});
  const arrowLeftRefs = React.useRef<Partial<Record<BayType, HTMLButtonElement | null>>>({});
  const arrowRightRefs = React.useRef<Partial<Record<BayType, HTMLButtonElement | null>>>({});
  const cuesRef = React.useRef<Record<BayType, RowCueState>>({
    WASH: INITIAL_CUE,
    DETAILING: INITIAL_CUE,
    PAINT: INITIAL_CUE,
  });
  const [cues, setCues] = React.useState<Record<BayType, RowCueState>>({
    WASH: INITIAL_CUE,
    DETAILING: INITIAL_CUE,
    PAINT: INITIAL_CUE,
  });

  const dragLoop = React.useRef<{
    active: boolean;
    x: number;
    y: number;
    lastOver: number;
    lastTick: number;
    raf: number;
    carry: number;
    hotLane: BayType | null;
    hotDir: -1 | 0 | 1;
  }>({
    active: false,
    x: 0,
    y: 0,
    lastOver: 0,
    lastTick: 0,
    raf: 0,
    carry: 0,
    hotLane: null,
    hotDir: 0,
  });

  const showStatus = React.useCallback(
    (text: string, isRefusal = false, _lane: BayType | null = null) => {
      void _lane;
      setMessage(text);
      setRefusal(isRefusal);
    },
    [],
  );

  const syncRowCue = React.useCallback((bayType: BayType) => {
    const sc = scrollerRefs.current[bayType];
    if (!sc) return;
    const style = typeof window !== "undefined" ? window.getComputedStyle(sc) : null;
    const isFlex = style?.display === "flex";
    const overflow = isFlex && sc.scrollWidth > sc.clientWidth + 1;
    const left = overflow && sc.scrollLeft > 1;
    const right = overflow && sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1;
    const hotDir: -1 | 0 | 1 =
      dragLoop.current.active && dragLoop.current.hotLane === bayType
        ? dragLoop.current.hotDir
        : 0;

    // P1-25 Section 2.2: if a focused arrow button is about to become disabled at its end,
    // move focus to the opposite arrow button before React disables it.
    const leftBtn = arrowLeftRefs.current[bayType];
    const rightBtn = arrowRightRefs.current[bayType];
    if (typeof document !== "undefined") {
      if (leftBtn && document.activeElement === leftBtn && !left && right) {
        rightBtn?.focus({ preventScroll: true });
        queueMicrotask(() => rightBtn?.focus({ preventScroll: true }));
      } else if (rightBtn && document.activeElement === rightBtn && !right && left) {
        leftBtn?.focus({ preventScroll: true });
        queueMicrotask(() => leftBtn?.focus({ preventScroll: true }));
      }
    }

    // Immediate DOM sync on fade overlays so Chrome's native drag auto-scroll is blocked on the
    // very first drag frame without waiting for a React commit.
    const wrap = sc.parentElement;
    if (wrap) {
      const dragActive = dragLoop.current.active;
      for (const side of ["left", "right"] as const) {
        const fade = wrap.querySelector<HTMLElement>(`[data-board-fade="${side}"]`);
        if (!fade) continue;
        const sideOn = side === "left" ? left : right;
        fade.style.pointerEvents = dragActive && sideOn ? "auto" : "none";
      }
    }

    const prev = cuesRef.current[bayType];
    if (
      !prev.measured ||
      prev.overflow !== overflow ||
      prev.left !== left ||
      prev.right !== right ||
      prev.hotDir !== hotDir
    ) {
      const next: RowCueState = { measured: true, overflow, left, right, hotDir };
      cuesRef.current = { ...cuesRef.current, [bayType]: next };
      setCues((curr) => ({ ...curr, [bayType]: next }));
    }
  }, []);

  const syncAllCues = React.useCallback(() => {
    for (const lane of BOARD_LANES) syncRowCue(lane.bayType);
  }, [syncRowCue]);

  const stopDragLoop = React.useCallback(() => {
    if (dragLoop.current.raf) {
      cancelAnimationFrame(dragLoop.current.raf);
    }
    dragLoop.current.active = false;
    dragLoop.current.raf = 0;
    dragLoop.current.lastTick = 0;
    dragLoop.current.carry = 0;
    dragLoop.current.hotLane = null;
    dragLoop.current.hotDir = 0;
    syncAllCues();
  }, [syncAllCues]);

  const clearDrag = React.useCallback(() => {
    drag.current = null;
    pressedControl.current = false;
    setDragging(null);
    stopDragLoop();
  }, [stopDragLoop]);

  const reloadBoard = React.useCallback(async () => {
    // Reload replaces the source article, so its dragend may never be delivered.
    clearDrag();
    await Promise.all([reloadBoardOnly(), reloadDay()]);
  }, [clearDrag, reloadBoardOnly, reloadDay]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (dragLoop.current.raf) cancelAnimationFrame(dragLoop.current.raf);
    };
  }, []);

  React.useEffect(() => {
    const onFocus = () => {
      if (!writing.current) void reloadBoard();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadBoard]);

  // Measure row overflow and scroll cues on mount, board render, window resize, and ResizeObserver.
  React.useEffect(() => {
    if (!board) return;
    syncAllCues();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncAllCues())
        : null;
    for (const lane of BOARD_LANES) {
      const sc = scrollerRefs.current[lane.bayType];
      if (sc && ro) ro.observe(sc);
    }
    window.addEventListener("resize", syncAllCues);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncAllCues);
    };
  }, [board, dayData, syncAllCues]);

  // Document-level drag listeners for edge auto-scroll (P1-25 Section 3).
  React.useEffect(() => {
    if (!dragging) return;
    const onDocDragOver = (e: DragEvent) => {
      if (!dragLoop.current.active) return;
      dragLoop.current.x = e.clientX;
      dragLoop.current.y = e.clientY;
      dragLoop.current.lastOver = performance.now();
    };
    const onDocDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        dragLoop.current.lastOver = 0;
        dragLoop.current.hotLane = null;
        dragLoop.current.hotDir = 0;
        syncAllCues();
      }
    };
    const onEnd = () => clearDrag();
    document.addEventListener("dragover", onDocDragOver, true);
    document.addEventListener("dragleave", onDocDragLeave, true);
    document.addEventListener("drop", onEnd);
    document.addEventListener("dragend", onEnd);
    window.addEventListener("blur", onEnd);
    return () => {
      document.removeEventListener("dragover", onDocDragOver, true);
      document.removeEventListener("dragleave", onDocDragLeave, true);
      document.removeEventListener("drop", onEnd);
      document.removeEventListener("dragend", onEnd);
      window.removeEventListener("blur", onEnd);
    };
  }, [dragging, clearDrag, syncAllCues]);

  React.useEffect(() => {
    if (board && !resource.loading && focus.current && !busy) {
      if (reveal.current) {
        const { lane, colId } = reveal.current;
        reveal.current = null;
        const sc = scrollerRefs.current[lane];
        const col = sc
          ? Array.from(sc.querySelectorAll<HTMLElement>("[data-board-column]")).find(
              (el) => el.getAttribute("data-board-column") === colId,
            )
          : null;
        if (sc && col && window.getComputedStyle(sc).display === "flex") {
          const nextLeft = revealColumnScrollLeft(col, sc);
          if (nextLeft !== sc.scrollLeft) {
            sc.scrollLeft = nextLeft;
            syncRowCue(lane);
          }
        }
      }
      document.getElementById(focus.current)?.focus({ preventScroll: true });
      focus.current = null;
    }
  }, [board, resource.loading, busy, syncRowCue]);

  function startDragLoop(initialX: number, initialY: number) {
    if (dragLoop.current.raf) cancelAnimationFrame(dragLoop.current.raf);
    dragLoop.current = {
      active: true,
      x: initialX,
      y: initialY,
      lastOver: 0,
      lastTick: 0,
      raf: 0,
      carry: 0,
      hotLane: null,
      hotDir: 0,
    };
    const tick = (now: number) => {
      if (!dragLoop.current.active) return;
      if (!dragLoop.current.lastOver) dragLoop.current.lastOver = now;
      const dtMs = dragLoop.current.lastTick ? now - dragLoop.current.lastTick : 0;
      dragLoop.current.lastTick = now;
      let nextHotLane: BayType | null = null;
      let nextHotDir: -1 | 0 | 1 = 0;

      // Stop scrolling if no dragover has arrived for 1s (pointer left window).
      if (now - dragLoop.current.lastOver <= 1000) {
        for (const lane of BOARD_LANES) {
          const sc = scrollerRefs.current[lane.bayType];
          if (!sc || window.getComputedStyle(sc).display !== "flex") continue;
          const rect = sc.getBoundingClientRect();
          if (dragLoop.current.y < rect.top || dragLoop.current.y > rect.bottom) continue;
          const step = edgeScrollStep(
            dragLoop.current.x,
            dragLoop.current.y,
            rect,
            sc,
            dtMs,
          );
          if (step.dir !== 0) {
            nextHotLane = lane.bayType;
            nextHotDir = step.dir;
            if (
              dragLoop.current.hotLane !== nextHotLane ||
              dragLoop.current.hotDir !== nextHotDir
            ) {
              dragLoop.current.carry = 0;
            }
            const totalDelta = step.delta + dragLoop.current.carry;
            const before = sc.scrollLeft;
            sc.scrollLeft = before + totalDelta;
            const actual = sc.scrollLeft - before;
            dragLoop.current.carry = totalDelta - actual;
          }
          break;
        }
      }
      dragLoop.current.hotLane = nextHotLane;
      dragLoop.current.hotDir = nextHotDir;
      syncAllCues();
      dragLoop.current.raf = requestAnimationFrame(tick);
    };
    syncAllCues();
    dragLoop.current.raf = requestAnimationFrame(tick);
  }

  async function bayChanged(text: string) {
    showStatus(text, false);
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
    const lane =
      board?.queues.find((q) => q.code === card.queueCode)?.bayType ?? null;
    showStatus("Moving car...", false);
    try {
      await adminRequest<AdminWriteResult>(
        "/api/admin/bookings/" + card.id + "/bay",
        { method: "PUT", body: bayPayload(card, date, bayId) },
      );
      if (!mounted.current) return;
      const destColId = bayId ?? card.queueCode;
      if (lane) {
        setPicked((p) => ({ ...p, [lane]: destColId }));
        reveal.current = { lane, colId: destColId };
      }
      focus.current = "board-card-" + card.id;
      await reloadBoard();
      showStatus("Car moved.", false);
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
      if (e instanceof AdminRequestError && feedback.review) {
        setBlocked(true);
        setReview(card.id);
      }
      if (!(e instanceof AdminRequestError) || e.commitState === "UNKNOWN")
        setBlocked(true);
      await resource.reload();
      showStatus(feedback.message, true, lane);
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
    // Every drop exit ends the gesture before a rejection or move can reload its source.
    clearDrag();
    if (!card || busy || blocked || role !== "ADMIN") return;
    const cardLane =
      board?.queues.find((q) => q.code === card.queueCode)?.bayType ?? null;
    if (queue && (card.queueCode !== queue || card.assignedBayId === null)) {
      const targetLane =
        board?.queues.find((q) => q.code === queue)?.bayType ?? cardLane;
      showStatus("Return a car to its own Waiting queue.", true, targetLane);
      return;
    }
    const bay = board?.bays.find((b) => b.id === bayId),
      allowed = cardLane ?? undefined;
    if (bay && !canDrop(role, card, bay, allowed)) {
      setBoardGen((g) => g + 1);
      showStatus(
        bay.cards.length
          ? "This bay is busy. The car stayed in its column."
          : "This bay does not take this queue.",
        true,
        bay.bayType ?? cardLane,
      );
      void resource.reload();
      return;
    }
    void move(card, bayId);
  }

  function columnIdUnderPoint(clientX: number, clientY: number): string | null {
    if (typeof document === "undefined" || typeof document.elementsFromPoint !== "function") {
      return null;
    }
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const col = el.closest?.("[data-board-column]");
      const id = col?.getAttribute("data-board-column");
      if (id) return id;
    }
    return null;
  }

  function dropOnColumnId(e: React.DragEvent, colId: string) {
    if (!board || colId.startsWith("DONE-")) {
      clearDrag();
      return;
    }
    drop(
      e,
      board.bays.some((b) => b.id === colId) ? colId : null,
      board.queues.some((q) => q.code === colId) ? colId : undefined,
    );
  }

  // One row per bay type: Waiting queue(s) -> bays -> Done. Below md each row shows one picked
  // column; from md the row's columns sit on one horizontal scrolling line.
  const lanes = board
    ? boardLanes(board, dayData).map((lane) => {
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

  // P1-22 / P1-25 Section 1: keep emptySlot minimum heights unchanged (min-h-24, plus
  // lg:min-h-[26rem] for ADMIN and lg:min-h-[14rem] for STAFF/DETAILER).
  const emptySlot =
    "flex min-h-24 flex-1 items-center justify-center px-3 text-xs text-muted-foreground " +
    (role === "ADMIN" ? "lg:min-h-[26rem]" : "lg:min-h-[14rem]");

  function doneView(b: AdminQueueBooking) {
    const activeLines = b.lines.filter((l) => !l.removed);
    const first = activeLines[0]?.name || b.serviceName;
    const extra = Math.max(0, activeLines.length - 1);
    return (
      <article
        key={b.id + "-" + boardGen}
        className="min-w-0 space-y-1 rounded border border-border bg-[#18181b] p-2.5 leading-tight"
        aria-label={b.referenceCode}
      >
        <button
          className="min-h-[44px] break-all text-left font-mono font-bold text-primary underline focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setSelected(b.id)}
        >
          {b.referenceCode}
        </button>
        <p className="break-words text-sm font-semibold leading-tight">
          {b.vehicleModel} · {plateLabel(b.vehiclePlate)}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={activeLines.map((l) => l.name).join(", ") || b.serviceName}
        >
          {first}
          {extra > 0 ? ` · +${extra} more` : ""}
        </p>
      </article>
    );
  }

  function cardView(card: AdminBoardCard) {
    const allowed = board?.queues.find(
      (q) => q.code === card.queueCode,
    )?.bayType;
    const canDrag = cardDraggable(role, busy, blocked);
    const firstLine = card.lines[0];
    const extraLines = Math.max(0, card.lines.length - 1);
    const allLinesTitle = card.lines
      .map((l) => `${l.name} · ${statusLabel(l.workStatus)}`)
      .join(", ");
    const staffNames =
      card.assignedWorkers
        .map((w) => w.name + (w.isActive ? "" : " (inactive)"))
        .join(", ") || "Unassigned";
    return (
      <article
        key={card.id + "-" + boardGen}
        className={
          "min-w-0 space-y-1.5 rounded border border-border bg-[#18181b] p-2.5 leading-tight" +
          (canDrag ? " cursor-grab active:cursor-grabbing" : "") +
          (dragging === card.id ? " opacity-50 ring-2 ring-primary" : "")
        }
        aria-label={card.referenceCode}
        // P1-23 (LE 2026-10-29): the whole ADMIN card is the drag source. A press that starts on a
        // control (reference, dropdown, Move car) keeps that control's own behavior instead.
        draggable={role === "ADMIN" ? canDrag : undefined}
        onPointerDown={(e) => {
          pressedControl.current = Boolean(
            (e.target as Element).closest(
              "button, select, input, textarea, a, label",
            ),
          );
        }}
        onDragStart={(e) => {
          if (!canDrag || pressedControl.current) return e.preventDefault();
          drag.current = card;
          setDragging(card.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.id);
          startDragLoop(e.clientX, e.clientY);
        }}
        onDragEnd={clearDrag}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            id={"board-card-" + card.id}
            className="min-h-[44px] break-all text-left font-mono font-bold text-primary underline focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setSelected(card.id)}
          >
            {card.referenceCode}
          </button>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            aria-label="Service progress"
          >
            {card.progress.done}/{card.progress.total} done
          </span>
        </div>
        <p className="break-words text-sm font-semibold leading-tight">
          {card.vehicleModel} · {plateLabel(card.vehiclePlate)}
        </p>
        <p className="break-words text-xs leading-tight text-muted-foreground">
          {card.sizeCode} · {statusLabel(card.status)}
          {card.bookingDate < date
            ? " · Carry-over " + card.bookingDate
            : " · " + card.bookingDate}
          {" · Staff: "}
          <span className="text-foreground">{staffNames}</span>
        </p>
        {firstLine && (
          <p
            className="truncate text-xs text-muted-foreground"
            title={allLinesTitle}
          >
            <span className="text-foreground">{firstLine.name}</span> ·{" "}
            {statusLabel(firstLine.workStatus)}
            {extraLines > 0 ? ` · +${extraLines} more` : ""}
          </p>
        )}
        {card.depositStatus && card.depositStatus !== "NONE" && (
          <p>
            <DepositBadge status={card.depositStatus} />
          </p>
        )}
        {role === "ADMIN" && (
          <form
            className="space-y-1 pt-0.5"
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("bay"));
              void move(card, value || null);
            }}
          >
            <p className="text-[11px] leading-tight text-muted-foreground">
              Move {card.referenceCode} to bay · Drag this card to a bay, or use
              Move car.
            </p>
            <div className="flex items-center gap-1.5">
              <select
                name="bay"
                aria-label={"Move " + card.referenceCode + " to bay"}
                className="min-h-[44px] min-w-0 flex-1 rounded border border-border bg-[#18181b] px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
              <Button
                id={"board-move-" + card.id}
                size="sm"
                className="shrink-0 px-2.5"
                disabled={busy || blocked}
                type="submit"
                variant="outline"
              >
                Move car
              </Button>
            </div>
          </form>
        )}
      </article>
    );
  }

  function scrollRowByStep(bayType: BayType, dir: -1 | 1) {
    const sc = scrollerRefs.current[bayType];
    if (!sc) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    sc.scrollBy({
      left: dir * COLUMN_STEP_PX,
      behavior: reduce ? "auto" : "smooth",
    });
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
                  clearDrag();
                  setDate(e.target.value);
                  setSelected(null);
                  showStatus("", false);
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
      <div
        data-board-notice={refusal && message ? "refusal" : undefined}
        className={
          refusal && message
            ? "sticky top-2 z-20 flex items-center justify-between gap-3 rounded border border-amber-500/40 bg-[#18181b] px-3 py-2 text-amber-200 shadow-lg"
            : ""
        }
      >
        <p
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 break-words text-sm"
        >
          {message}
        </p>
        {refusal && message && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs text-amber-200 hover:text-foreground"
            onClick={() => showStatus("", false)}
          >
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
      <LoadState
        loading={!board && resource.loading}
        error={resource.error}
        retry={refresh}
      />
      {board?.closed && (
        <p className="text-sm">Shop closed · {board.closed.reason}</p>
      )}
      {board && (
        <>
          {lanes.map((lane) => {
            const cue = cues[lane.bayType] ?? INITIAL_CUE;
            const dragActive = dragging !== null;
            const hotLeft = dragActive && cue.hotDir === -1 && cue.left;
            const hotRight = dragActive && cue.hotDir === 1 && cue.right;
            const showArrows = !cue.measured || cue.overflow;
            return (
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
                  <div className="flex shrink-0 items-center gap-2">
                    <div
                      data-board-arrows={lane.bayType}
                      className={
                        showArrows ? "hidden gap-1 md:flex" : "hidden gap-1"
                      }
                    >
                      <Button
                        ref={(el) => {
                          arrowLeftRefs.current[lane.bayType] = el;
                        }}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-11 px-0"
                        aria-label={`Show earlier ${lane.label} columns`}
                        disabled={cue.measured ? !cue.left : true}
                        onClick={() => scrollRowByStep(lane.bayType, -1)}
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        ref={(el) => {
                          arrowRightRefs.current[lane.bayType] = el;
                        }}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-11 px-0"
                        aria-label={`Show more ${lane.label} columns`}
                        disabled={cue.measured ? !cue.right : false}
                        onClick={() => scrollRowByStep(lane.bayType, 1)}
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
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
                </div>
                <label className="block text-xs md:hidden">
                  Board column
                  <select
                    aria-label={lane.label + " board column"}
                    className={fieldClass}
                    value={lane.active}
                    onChange={(e) =>
                      setPicked((p) => ({
                        ...p,
                        [lane.bayType]: e.target.value,
                      }))
                    }
                  >
                    {lane.columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label} ({c.done ? c.done.length : c.cards.length})
                      </option>
                    ))}
                  </select>
                </label>
                {/* P1-25: single-line horizontal scrolling row from md up, inside a relative fade wrapper. */}
                <div className="relative" data-board-row-wrap={lane.bayType}>
                  <div
                    ref={(el) => {
                      scrollerRefs.current[lane.bayType] = el;
                    }}
                    data-board-row-scroll={lane.bayType}
                    onScroll={() => syncRowCue(lane.bayType)}
                    className="relative min-w-0 grid grid-cols-1 items-stretch gap-3 md:flex md:overflow-x-auto md:overscroll-x-contain md:pb-2 md:scroll-px-12 [scrollbar-width:thin] [scrollbar-color:#3f3f46_transparent] hover:[scrollbar-color:#52525b_transparent]"
                  >
                    {lane.columns.map((c) => (
                      <section
                        key={c.id}
                        aria-label={c.label}
                        data-board-column={c.id}
                        className={
                          (c.id === lane.active ? "flex " : "hidden ") +
                          "min-w-0 flex-col gap-3 rounded border border-border bg-[#121214] p-3 md:flex md:w-60 md:shrink-0"
                        }
                        onDragOver={(e) => {
                          if (!c.done && role === "ADMIN" && !busy && !blocked)
                            e.preventDefault();
                        }}
                        onDrop={(e) => {
                          if (c.done) return;
                          dropOnColumnId(e, c.id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3
                            tabIndex={-1}
                            className="min-w-0 break-words py-2 text-sm font-bold"
                          >
                            {c.label} ({c.done ? c.done.length : c.cards.length})
                          </h3>
                          {role === "ADMIN" && c.bay && (
                            <BayMenu
                              bay={c.bay}
                              bays={board.bays}
                              onDone={bayChanged}
                            />
                          )}
                        </div>
                        {c.subtitle && (
                          <p className="text-xs text-muted-foreground">
                            {c.subtitle}
                          </p>
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
                                {dayView.loading && !dayData
                                  ? "Loading..."
                                  : "No cars finished yet"}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            {c.cards.map(cardView)}
                            {!c.cards.length && (
                              <p
                                className={
                                  emptySlot +
                                  " rounded border border-dashed border-border"
                                }
                              >
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
                  <div
                    aria-hidden="true"
                    data-board-fade="left"
                    onDragOver={(e) => {
                      const colId = columnIdUnderPoint(e.clientX, e.clientY);
                      if (
                        colId &&
                        !colId.startsWith("DONE-") &&
                        role === "ADMIN" &&
                        !busy &&
                        !blocked
                      ) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => {
                      const colId = columnIdUnderPoint(e.clientX, e.clientY);
                      if (!colId) {
                        clearDrag();
                        return;
                      }
                      dropOnColumnId(e, colId);
                    }}
                    className={
                      "absolute bottom-2 left-0 top-0 hidden w-12 rounded-l bg-gradient-to-r from-[#0f0f11] to-transparent transition-opacity motion-reduce:transition-none md:block " +
                      (cue.left ? "opacity-100 " : "opacity-0 ") +
                      (dragActive && cue.left
                        ? "pointer-events-auto"
                        : "pointer-events-none")
                    }
                  >
                    <div
                      className={
                        "absolute inset-y-0 left-0 bg-primary " +
                        (dragActive && cue.left
                          ? hotLeft
                            ? "w-1 opacity-100"
                            : "w-0.5 opacity-45"
                          : "w-0.5 opacity-0")
                      }
                    />
                    <div
                      className={
                        "absolute left-1 top-10 text-primary " +
                        (dragActive && cue.left
                          ? hotLeft
                            ? "opacity-100"
                            : "opacity-60"
                          : "opacity-0")
                      }
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </div>
                  </div>
                  <div
                    aria-hidden="true"
                    data-board-fade="right"
                    onDragOver={(e) => {
                      const colId = columnIdUnderPoint(e.clientX, e.clientY);
                      if (
                        colId &&
                        !colId.startsWith("DONE-") &&
                        role === "ADMIN" &&
                        !busy &&
                        !blocked
                      ) {
                        e.preventDefault();
                      }
                    }}
                    onDrop={(e) => {
                      const colId = columnIdUnderPoint(e.clientX, e.clientY);
                      if (!colId) {
                        clearDrag();
                        return;
                      }
                      dropOnColumnId(e, colId);
                    }}
                    className={
                      "absolute bottom-2 right-0 top-0 hidden w-12 rounded-r bg-gradient-to-l from-[#0f0f11] to-transparent transition-opacity motion-reduce:transition-none md:block " +
                      (cue.right ? "opacity-100 " : "opacity-0 ") +
                      (dragActive && cue.right
                        ? "pointer-events-auto"
                        : "pointer-events-none")
                    }
                  >
                    <div
                      className={
                        "absolute inset-y-0 right-0 bg-primary " +
                        (dragActive && cue.right
                          ? hotRight
                            ? "w-1 opacity-100"
                            : "w-0.5 opacity-45"
                          : "w-0.5 opacity-0")
                      }
                    />
                    <div
                      className={
                        "absolute right-1 top-10 text-primary " +
                        (dragActive && cue.right
                          ? hotRight
                            ? "opacity-100"
                            : "opacity-60"
                          : "opacity-0")
                      }
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
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
