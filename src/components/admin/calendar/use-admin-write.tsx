"use client";
import * as React from "react";
import { AdminRequestError } from "../bookings/client";

// One write at a time per screen; the server's message and field messages are shown as-is.
export function useAdminWrite() {
  const [busy, setBusy] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [error, setError] = React.useState<{ text: string; lines: string[] } | null>(null);
  const writing = React.useRef(false);
  const run = React.useCallback(async (done: string, work: () => Promise<unknown>): Promise<boolean> => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setMessage("");
    setError(null);
    try {
      await work();
      setMessage(done);
      return true;
    } catch (e) {
      if (e instanceof AdminRequestError && e.status === 401) {
        window.location.replace("/admin/login");
        return false;
      }
      setError({
        text: e instanceof Error ? e.message : "The change could not be saved. Reload and try again.",
        lines: e instanceof AdminRequestError ? Object.values(e.fieldErrors).flat() : [],
      });
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, message, error, run };
}

export function WriteFeedback({ message, error }: { message: string; error: { text: string; lines: string[] } | null }) {
  return (
    <>
      <p role="status" aria-live="polite" className="text-sm text-emerald-400">
        {message}
      </p>
      {error && (
        <div role="alert" className="text-sm text-rose-400">
          <p>{error.text}</p>
          {error.lines.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {error.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
