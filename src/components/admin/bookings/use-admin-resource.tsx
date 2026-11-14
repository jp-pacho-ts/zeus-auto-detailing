"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
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
const dateBase =
  "w-auto min-w-[10.5rem] " + fieldBase + " [&::-webkit-calendar-picker-indicator]:ml-2 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70";
export const dateClass = "mt-1 " + dateBase;
// The same date field with no top margin, for one that sits beside its label (the Bay board's Board day).
export const dateBare = dateBase;

// P1-76: one select style. A native select (keyboard, screen readers and phone pickers unchanged) with our own chevron 12 px in.
export function Select({ className = "", wrapperClassName = "mt-1", ...props }: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={"relative block " + wrapperClassName}>
      <select {...props} className={"w-full appearance-none pr-9 " + fieldBase + " " + className} />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </span>
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
