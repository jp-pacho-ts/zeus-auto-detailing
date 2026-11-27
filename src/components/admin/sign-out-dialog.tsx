"use client";

import * as React from "react";
import { AnimatePresence, MotionConfig, m } from "motion/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// Asks before ending the staff session, so a stray tap in the account menu never signs anyone out.
export function SignOutDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const stay = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open || !dialog.current || dialog.current.open) return;
    // The native modal traps focus and makes the portal behind it inert.
    dialog.current.showModal();
    stay.current?.focus();
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <m.dialog
            ref={dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            aria-describedby="sign-out-text"
            onCancel={(e) => {
              e.preventDefault();
              onCancel();
            }}
            className="fixed inset-0 m-0 grid h-full max-h-none w-full max-w-none place-items-center bg-transparent p-4 text-foreground backdrop:bg-transparent"
          >
            <m.div
              aria-hidden="true"
              onClick={onCancel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />
            <m.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="relative w-full max-w-sm space-y-4 rounded-xl border border-border bg-panel p-6 shadow-2xl"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
                <LogOut className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="space-y-1.5">
                <h2 id="sign-out-title" className="text-base font-bold">Sign out?</h2>
                <p id="sign-out-text" className="text-sm text-muted-foreground">
                  You will need your email and password to get back into the dashboard.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button ref={stay} variant="outline" onClick={onCancel}>
                  Stay signed in
                </Button>
                <Button variant="destructive" onClick={onConfirm}>
                  Sign out
                </Button>
              </div>
            </m.div>
          </m.dialog>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
