"use client";
import * as React from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BayType } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "./client";
import { fieldClass } from "./use-admin-resource";

// P1-20 item 4 (LE 2026-10-28): ADMIN adds, renames and removes bays inline on the board rows,
// through the existing audited routes (POST /api/admin/bays, PATCH /api/admin/bays/[id]).
// Remove = deactivate, so history is kept; the server refuses it while a car is in the bay.
type Bay = { id: string; name: string; bayType: BayType; sortOrder: number; updatedAt: string; cards: { id: string }[] };
type Request = { url: string; method: "POST" | "PATCH"; body: Record<string, unknown> };

const key = (name: string) => name.trim().toLowerCase();
export const addBayRequest = (bayType: BayType, name: string, bays: readonly Pick<Bay, "sortOrder">[]): Request => ({
  url: "/api/admin/bays",
  method: "POST",
  body: { name: name.trim(), bayType, sortOrder: bays.reduce((max, b) => Math.max(max, b.sortOrder), 0) + 1 },
});
export const renameBayRequest = (bay: Pick<Bay, "id" | "updatedAt">, name: string): Request => ({
  url: "/api/admin/bays/" + bay.id,
  method: "PATCH",
  body: { expectedUpdatedAt: bay.updatedAt, name: name.trim() },
});
export const removeBayRequest = (bay: Pick<Bay, "id" | "updatedAt">): Request => ({
  url: "/api/admin/bays/" + bay.id,
  method: "PATCH",
  body: { expectedUpdatedAt: bay.updatedAt, isActive: false },
});
// Names are unique across the shop (the database key ignores case and spaces at the ends).
export function bayNameError(name: string, bays: readonly Pick<Bay, "id" | "name">[], ownId?: string): string | null {
  if (!name.trim()) return "Enter a bay name.";
  if (name.trim().length > 40) return "Use at most 40 characters.";
  const same = bays.find((b) => key(b.name) === key(name));
  if (same && same.id === ownId) return "That is already this bay's name.";
  if (same) return "A bay with this name already exists.";
  return null;
}
export const removeBayBlocked = (bay: Pick<Bay, "name" | "cards">): string | null =>
  bay.cards.length ? `Move the car out of ${bay.name} before removing it.` : null;

async function send(request: Request): Promise<string | null> {
  try {
    await adminRequest(request.url, { method: request.method, body: request.body });
    return null;
  } catch (e) {
    if (e instanceof AdminRequestError && e.status === 401) {
      window.location.replace("/admin/login");
      return "";
    }
    if (e instanceof AdminRequestError) return [e.message, ...Object.values(e.fieldErrors).flat()].filter((m, i, all) => all.indexOf(m) === i).join(" ");
    return "The change could not be confirmed. Refresh the board before trying again.";
  }
}

function NameForm({ id, label, initial, submitLabel, validate, onSubmit, onCancel }: {
  id: string; label: string; initial: string; submitLabel: string;
  validate: (name: string) => string | null; onSubmit: (name: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [name, setName] = React.useState(initial), [error, setError] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const invalid = validate(name);
        if (invalid) return setError(invalid);
        setBusy(true);
        const failed = await onSubmit(name);
        setBusy(false);
        if (failed) setError(failed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <label className="block text-xs" htmlFor={id}>
        {label}
      </label>
      <input
        ref={input}
        id={id}
        value={name}
        maxLength={60}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id + "-error" : undefined}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        className={fieldClass}
      />
      {error && (
        <p id={id + "-error"} role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddBay({ bayType, label, bays, onDone }: { bayType: BayType; label: string; bays: readonly Bay[]; onDone: (message: string) => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    queueMicrotask(() => button.current?.focus());
  };
  if (!open)
    return (
      <Button ref={button} variant="outline" className="w-full border-dashed" aria-label={`Add a ${label.toLowerCase()} bay`} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Add bay
      </Button>
    );
  return (
    <div className="rounded border border-dashed border-border bg-[#121214] p-3">
      <NameForm
        id={"add-bay-" + bayType}
        label={`New ${label.toLowerCase()} bay name`}
        initial=""
        submitLabel="Add bay"
        validate={(name) => bayNameError(name, bays)}
        onSubmit={async (name) => {
          const failed = await send(addBayRequest(bayType, name, bays));
          if (failed !== null) return failed || null;
          close();
          await onDone(`${name.trim()} added.`);
          return null;
        }}
        onCancel={close}
      />
    </div>
  );
}

export function BayMenu({ bay, bays, onDone }: { bay: Bay; bays: readonly Bay[]; onDone: (message: string) => Promise<void> }) {
  const [mode, setMode] = React.useState<"CLOSED" | "MENU" | "RENAME" | "CONFIRM">("CLOSED");
  const [notice, setNotice] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null), items = React.useRef<(HTMLButtonElement | null)[]>([]), keep = React.useRef<HTMLButtonElement>(null);
  const confirmation = React.useRef<HTMLDialogElement>(null);
  const menuId = "bay-menu-" + bay.id;
  const close = () => {
    setMode("CLOSED");
    queueMicrotask(() => trigger.current?.focus());
  };
  React.useEffect(() => {
    if (mode === "MENU") items.current[0]?.focus();
    if (mode === "CONFIRM") {
      if (confirmation.current && !confirmation.current.open) confirmation.current.showModal();
      keep.current?.focus();
    }
  }, [mode]);
  function onMenuKey(e: React.KeyboardEvent) {
    const at = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items.current[(at + (e.key === "ArrowDown" ? 1 : -1) + 2) % 2]?.focus();
    } else if (e.key === "Escape") close();
    else if (e.key === "Tab") setMode("CLOSED");
  }
  async function remove() {
    setBusy(true);
    const failed = await send(removeBayRequest(bay));
    setBusy(false);
    if (failed !== null) {
      if (failed) setNotice(failed);
      setMode("CLOSED");
      return;
    }
    setMode("CLOSED");
    await onDone(`${bay.name} removed. Its booking history is kept.`);
  }
  if (mode === "RENAME")
    return (
      <NameForm
        id={"rename-bay-" + bay.id}
        label={`New name for ${bay.name}`}
        initial={bay.name}
        submitLabel="Save name"
        validate={(name) => bayNameError(name, bays, bay.id)}
        onSubmit={async (name) => {
          const failed = await send(renameBayRequest(bay, name));
          if (failed !== null) return failed || null;
          setMode("CLOSED");
          await onDone(`Renamed to ${name.trim()}.`);
          return null;
        }}
        onCancel={close}
      />
    );
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={`Options for ${bay.name}`}
        aria-haspopup="menu"
        aria-expanded={mode === "MENU"}
        aria-controls={mode === "MENU" ? menuId : undefined}
        onClick={() => {
          setNotice(null);
          setMode(mode === "MENU" ? "CLOSED" : "MENU");
        }}
        className="inline-flex h-9 min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted-foreground hover:bg-[#18181b] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {mode === "MENU" && (
        <div id={menuId} role="menu" aria-label={`${bay.name} options`} onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-1 w-40 rounded border border-border bg-[#18181b] p-1 shadow-lg">
          {["Rename", "Remove"].map((label, i) => (
            <button
              key={label}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                if (label === "Rename") return setMode("RENAME");
                const blocked = removeBayBlocked(bay);
                if (blocked) {
                  setNotice(blocked);
                  return close();
                }
                setMode("CONFIRM");
              }}
              className="flex min-h-[44px] w-full items-center rounded px-3 text-left text-sm hover:bg-[#27272a] focus-visible:bg-[#27272a] focus-visible:outline-none"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "CONFIRM" && (
        <dialog
          ref={confirmation}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={menuId + "-title"}
          aria-describedby={menuId + "-text"}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const first = buttons[0], last = buttons.at(-1);
            if (document.activeElement === (e.shiftKey ? first : last)) {
              e.preventDefault();
              (e.shiftKey ? last : first)?.focus();
            }
          }}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm space-y-3 rounded border border-border bg-[#121214] p-5 text-foreground backdrop:bg-black/60"
        >
          <h4 id={menuId + "-title"} className="font-bold">Remove {bay.name}?</h4>
          <p id={menuId + "-text"} className="text-sm text-muted-foreground">
            Cars can no longer be moved into it. Its booking history is kept, and it can be brought back under Bay Calendar, Bays.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={keep} variant="outline" onClick={close}>
              Keep bay
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              Remove bay
            </Button>
          </div>
        </dialog>
      )}
      {notice && (
        <p role="alert" className="mt-1 max-w-56 text-xs text-amber-400">
          {notice}
        </p>
      )}
    </div>
  );
}
