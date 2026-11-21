"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { adminRequest } from "./bookings/client";

export function DeleteServiceDialog({ service, onClose, onDeleted }: {
  service: { id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const cancel = React.useRef<HTMLButtonElement>(null);
  const writing = React.useRef(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    cancel.current?.focus();
    return () => node?.close();
  }, []);

  async function remove() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/services/${service.id}/delete`, { method: "DELETE" });
      dialog.current?.close();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the service. Please try again.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!writing.current) onClose(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/80">
      <h2 id={titleId} className="text-lg font-semibold">Delete service?</h2>
      <p id={descriptionId} className="mt-3 text-sm text-muted-foreground">
        Permanently delete <strong className="break-words text-foreground">{service.name}</strong> and its pricing? This cannot be undone.
        Services with bookings or other linked records must be deactivated instead.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-rose-400">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancel} type="button" disabled={busy} onClick={onClose}
          className="min-h-11 rounded border border-border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void remove()}
          className="inline-flex min-h-11 items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-4 text-sm font-semibold text-rose-400 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50">
          {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {busy ? "Deleting…" : "Delete service"}
        </button>
      </div>
    </dialog>
  );
}
