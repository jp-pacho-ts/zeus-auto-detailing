"use client";
import * as React from "react";
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
  const reload = React.useCallback(async () => {
    abort.current?.abort();
    const ticket = gate.current.next();
    setState({ key, data: null, error: null, loading: Boolean(url) });
    if (!url) return;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const value = await adminRequest<T>(url, {
        method,
        body: body === undefined ? undefined : JSON.parse(body),
        signal: controller.signal,
      });
      if (gate.current.current(ticket))
        setState({ key, data: value, error: null, loading: false });
    } catch (e) {
      if (gate.current.current(ticket) && !controller.signal.aborted) {
        if (e instanceof AdminRequestError && e.status === 401) {
          window.location.replace("/admin/login");
          return;
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
  }, [url, method, body, key]);
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
  return { ...current, setData, reload };
}
export const fieldClass =
  "mt-1 min-h-[44px] w-full rounded border border-border bg-[#18181b] px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry: () => unknown;
}) {
  return (
    <>
      {loading && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading shop data...
        </p>
      )}
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
