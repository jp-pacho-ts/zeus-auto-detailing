"use client";
import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  AdminBoardSkeleton,
  AdminRowsSkeleton,
  AdminShellSkeleton,
} from "@/components/ui/skeleton";
import { adminRequest, AdminRequestError, requestGeneration } from "./client";
export function useAdminResource<T>(
  url: string | null,
  method = "GET",
  body?: string,
) {
  const key = JSON.stringify([url, method, body]);
  const [state, setState] = React.useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ key: "", data: null, error: null, loading: false });
  const gate = React.useRef(requestGeneration()),
    abort = React.useRef<AbortController | null>(null);
  // load resolves true only when this call fetched fresh data (false: failed or superseded).
  const load = React.useCallback(async (): Promise<boolean> => {
    abort.current?.abort();
    const ticket = gate.current.next();
    setState({ key, data: null, error: null, loading: Boolean(url) });
    if (!url) return false;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const value = await adminRequest<T>(url, {
        method,
        body: body === undefined ? undefined : JSON.parse(body),
        signal: controller.signal,
      });
      if (gate.current.current(ticket)) {
        setState({ key, data: value, error: null, loading: false });
        return true;
      }
    } catch (e) {
      if (gate.current.current(ticket) && !controller.signal.aborted) {
        if (e instanceof AdminRequestError && e.status === 401) {
          window.location.replace("/admin/login");
          return false;
        }
        setState({
          key,
          data: null,
          error:
            e instanceof Error ? e.message : "Could not load. Please retry.",
          loading: false,
        });
      }
    }
    return false;
  }, [url, method, body, key]);
  const reload = React.useCallback(async () => {
    await load();
  }, [load]);
  React.useEffect(() => {
    const currentGate = gate.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void reload();
    });
    return () => {
      cancelled = true;
      currentGate.clear();
      abort.current?.abort();
    };
  }, [reload]);
  const current =
    state.key === key
      ? state
      : { data: null, error: null, loading: Boolean(url) };
  const setData = (data: T | null) =>
    setState({ key, data, error: null, loading: false });
  return { ...current, setData, reload, load };
}
const fieldBase =
  "min-h-[44px] rounded border border-border bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";
export const fieldClass = "mt-1 w-full " + fieldBase;
// The same field with no top margin, for a field that is not under a label.
export const fieldBare = "w-full " + fieldBase;
// P1-76: one date style. 44 px tall, sized to its content, the calendar icon kept off the edge.
export const dateClass =
  "mt-1 w-auto min-w-[10.5rem] " + fieldBase + " [&::-webkit-calendar-picker-indicator]:ml-2 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70";

// P1-76: one select style. A native select (keyboard, screen readers and phone pickers unchanged) with our own chevron 12 px in.
export function Select({ className = "", wrapperClassName = "mt-1", ...props }: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={"relative block " + wrapperClassName}>
      <select {...props} className={"w-full appearance-none pr-9 " + fieldBase + " " + className} />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

// P1-76: the day control shared by the Bookings day view and the Bay board: previous, the date, next, Today.
// Pixel sizes, not h-11/w-11: the admin shell sets html to 92.5%, so rem-based 44 comes out at 40.7 px (Lead QA F1).
export function DayStepper({
  label,
  value,
  today,
  onChange,
  disabled = false,
  inputId,
  inputLabel,
}: {
  label: string;
  value: string;
  today: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  inputId?: string;
  inputLabel?: string;
}) {
  const step = (days: number) => {
    const d = new Date(value + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    onChange(d.toISOString().slice(0, 10));
  };
  const square =
    "inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";
  return (
    <div className="flex items-end gap-2">
      <button type="button" aria-label="Previous day" className={square} disabled={disabled} onClick={() => step(-1)}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <label className="text-xs font-semibold text-muted-foreground">
        {label}
        <input
          id={inputId}
          aria-label={inputLabel}
          type="date"
          value={value}
          required
          disabled={disabled}
          className={dateClass + " block"}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </label>
      <button type="button" aria-label="Next day" className={square} disabled={disabled} onClick={() => step(1)}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* On today it reads as selected, not as a broken disabled button. */}
      <button
        type="button"
        aria-pressed={value === today}
        disabled={disabled}
        onClick={() => onChange(today)}
        className={
          "min-h-[44px] rounded border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 " +
          (value === today ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-raised")
        }
      >
        Today
      </button>
    </div>
  );
}
export function LoadState({
  loading,
  error,
  retry,
  variant = "rows",
}: {
  loading: boolean;
  error: string | null;
  retry: () => unknown;
  variant?: "rows" | "board" | "shell";
}) {
  return (
    <>
      {loading &&
        (variant === "shell" ? (
          <AdminShellSkeleton />
        ) : variant === "board" ? (
          <AdminBoardSkeleton />
        ) : (
          <AdminRowsSkeleton />
        ))}
      {error && (
        <div role="alert" className="p-4 text-sm text-rose-400">
          {error}
          <button
            type="button"
            onClick={() => void retry()}
            className="ml-3 min-h-[44px] underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}
