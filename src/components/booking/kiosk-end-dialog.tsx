"use client";

import * as React from "react";

// Kiosk only: End session asks first, so a stray tap does not wipe a customer's order. Keep booking is the default and Escape keeps too.
export function KioskEndDialog({ onKeep, onEnd }: { onKeep: () => void; onEnd: () => void }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const keep = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const node = dialog.current;
    // The dialog unmounts rather than closing itself, so hand focus back to End session by hand.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    keep.current?.focus();
    return () => { node?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);

  return (
    <dialog ref={dialog} data-part="end-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onKeep(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-card p-8 text-foreground shadow-xl backdrop:bg-black/80">
      <h2 id={titleId} className="text-2xl font-semibold">End this booking?</h2>
      <p id={descriptionId} className="mt-3 text-base text-muted-foreground">
        Your choices will be cleared and the kiosk will go back to the start screen.
      </p>
      <div className="mt-8 flex flex-wrap justify-end gap-3">
        <button type="button" data-part="back" onClick={onEnd} className="inline-flex items-center justify-center text-sm">
          End session
        </button>
        <button ref={keep} type="button" data-part="primary" onClick={onKeep} className="inline-flex items-center justify-center text-sm">
          Keep booking
        </button>
      </div>
    </dialog>
  );
}
