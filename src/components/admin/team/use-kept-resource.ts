"use client";
import * as React from "react";
import { adminRequest, AdminRequestError, requestGeneration } from "../bookings/client";

// Like useAdminResource, but the last good answer stays on screen while a reload runs. The shared hook clears its data
// first, which would unmount a panel in the middle of a save and lose its message and open dialog.
export function useKeptResource<T>(url: string | null) {
  const [state, setState] = React.useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  const gate = React.useRef(requestGeneration());
  const load = React.useCallback(async (): Promise<boolean> => {
    if (!url) return false;
    const ticket = gate.current.next();
    try {
      const data = await adminRequest<T>(url);
      if (!gate.current.current(ticket)) return false;
      setState({ url, data, error: null });
      return true;
    } catch (e) {
      if (!gate.current.current(ticket)) return false;
      if (e instanceof AdminRequestError && e.status === 401) {
        window.location.replace("/admin/login");
        return false;
      }
      const message = e instanceof Error ? e.message : "Could not load. Please retry.";
      // Data that belongs to a different query must not stay visible under an error for this one.
      setState((prev) => ({ url, data: prev.url === url ? prev.data : null, error: message }));
      return false;
    }
  }, [url]);
  React.useEffect(() => {
    const currentGate = gate.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      currentGate.clear();
    };
  }, [load]);
  const reload = React.useCallback(async () => {
    await load();
  }, [load]);
  const answered = state.url === url;
  return {
    data: url ? state.data : null,
    error: url && answered ? state.error : null,
    // True until the first answer for this exact query arrives; old data may still be shown meanwhile.
    loading: Boolean(url) && !answered,
    reload,
  };
}
