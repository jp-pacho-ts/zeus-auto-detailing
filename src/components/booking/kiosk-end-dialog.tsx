"use client";

import * as React from "react";

// Kiosk dialogs share one shape: a modal with Keep booking as the focused default (Escape keeps too) and End session beside it.
function KioskModal({ title, description, onKeep, onEnd, children }: {
  title: string;
  description: React.ReactNode;
  onKeep: () => void;
  onEnd: () => void;
  children?: React.ReactNode;
}) {
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
      <h2 id={titleId} className="text-2xl font-semibold">{title}</h2>
      <p id={descriptionId} className="mt-3 text-base text-muted-foreground">{description}</p>
      {children}
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

// End session asks first, so a stray tap does not wipe a customer's order.
export function KioskEndDialog({ onKeep, onEnd }: { onKeep: () => void; onEnd: () => void }) {
  return <KioskModal title="End this booking?" description="Your choices will be cleared and the kiosk will go back to the start screen." onKeep={onKeep} onEnd={onEnd} />;
}

// The last minute before an idle booking ends: a live countdown and a shrinking bar. The wizard ends the session at zero.
export function KioskIdleDialog({ deadline, total, onKeep, onEnd }: { deadline: number; total: number; onKeep: () => void; onEnd: () => void }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, []);
  const left = Math.max(0, deadline - now);
  const seconds = Math.ceil(left / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <KioskModal title="Are you still there?" onKeep={onKeep} onEnd={onEnd}
      description={<>This booking ends in <span role="timer" className="font-semibold tabular-nums text-foreground">{clock}</span> and the kiosk goes back to the start screen.</>}>
      <div aria-hidden="true" className="mt-6 h-1 overflow-hidden rounded-full bg-white/10">
        <div data-part="idle-bar" className="h-full origin-left bg-primary" style={{ transform: `scaleX(${left / total})` }} />
      </div>
    </KioskModal>
  );
}
