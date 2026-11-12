"use client";
import * as React from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBoardContainer } from "@/types/admin-contracts";
import { fieldClass } from "./use-admin-resource";
import { RELOADED, type Request, send } from "./bay-controls";
import { queueLabel, usualForLine } from "./container-model";

// P1-62 A2: ADMIN adds, renames, labels and removes containers on the Bays tab of the board. A container is a named group of bays. Remove is
// a deactivate (history is kept); the server refuses it while the container has a bay or a car, and for the last container.
type Container = Pick<AdminBoardContainer, "id" | "name" | "usualQueues" | "updatedAt"> & { bays: { id: string; name: string; isActive: boolean; cards: unknown[] }[] };
const key = (name: string) => name.trim().toLowerCase();

export const addContainerRequest = (id: string, name: string): Request => ({ url: "/api/admin/bay-containers", method: "POST", body: { id, name: name.trim() } });
export const renameContainerRequest = (c: Pick<Container, "id" | "updatedAt">, name: string): Request => ({
  url: "/api/admin/bay-containers/" + c.id, method: "PATCH", body: { expectedUpdatedAt: c.updatedAt, name: name.trim() },
});
export const labelContainerRequest = (c: Pick<Container, "id" | "updatedAt">, usualQueues: string[]): Request => ({
  url: "/api/admin/bay-containers/" + c.id, method: "PATCH", body: { expectedUpdatedAt: c.updatedAt, usualQueues },
});
export const removeContainerRequest = (c: Pick<Container, "id" | "updatedAt">): Request => ({
  url: "/api/admin/bay-containers/" + c.id + "/remove", method: "POST", body: { expectedUpdatedAt: c.updatedAt },
});

// Names are unique across containers and bays together (the database key ignores case and spaces at the ends).
export function containerNameError(name: string, taken: readonly { id: string; name: string }[], ownId?: string): string | null {
  if (!name.trim()) return "Enter a container name.";
  if (name.trim().length > 40) return "Use at most 40 characters.";
  const same = taken.find((t) => key(t.name) === key(name));
  if (same && same.id === ownId) return "That is already this container's name.";
  if (same) return "A container or bay with this name already exists.";
  return null;
}
export function removeContainerBlocked(c: Container, count: number): string | null {
  if (count <= 1) return "There must always be at least one container.";
  if (c.bays.some((b) => b.cards.length)) return `Move the cars out of ${c.name} before removing it.`;
  if (c.bays.some((b) => b.isActive)) return `Move or remove the bays in ${c.name} first.`;
  return null;
}

function Modal({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={id + "-title"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)"));
        const first = f[0], last = f.at(-1);
        if (document.activeElement === (e.shiftKey ? first : last)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-panel p-5 text-foreground shadow-2xl backdrop:bg-black/75 backdrop:"
    >
      <div className="space-y-3">
        <h2 id={id + "-title"} className="font-bold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
export { Modal };

function NameDialog({ id, title, initial, submitLabel, validate, onSubmit, onCancel }: {
  id: string; title: string; initial: string; submitLabel: string; validate: (name: string) => string | null;
  onSubmit: (name: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [name, setName] = React.useState(initial), [error, setError] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => input.current?.focus(), []);
  return (
    <Modal id={id} title={title} onClose={() => !busy && onCancel()}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const invalid = validate(name);
          if (invalid) return setError(invalid);
          setBusy(true);
          const failed = await onSubmit(name);
          setBusy(false);
          if (failed) setError(failed);
        }}
      >
        <label className="block text-xs" htmlFor={id}>Container name</label>
        <input ref={input} id={id} value={name} maxLength={60} autoComplete="off" aria-invalid={error ? true : undefined}
          aria-describedby={error ? id + "-error" : undefined} onChange={(e) => { setName(e.target.value); setError(null); }} className={fieldClass} />
        {error && <p id={id + "-error"} role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={busy}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ContainerMenu({ container, containers, queues, onDone }: {
  container: Container; containers: readonly Container[]; queues: readonly { code: string; name: string }[];
  onDone: (message: string) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<"CLOSED" | "MENU" | "RENAME" | "LABEL" | "REMOVE">("CLOSED");
  const [notice, setNotice] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>(container.usualQueues);
  const trigger = React.useRef<HTMLButtonElement>(null), items = React.useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = "container-menu-" + container.id;
  const labels = ["Rename", "Usually for…", "Remove"];
  const close = () => {
    setMode("CLOSED");
    setError(null);
    queueMicrotask(() => trigger.current?.focus());
  };
  React.useEffect(() => {
    if (mode === "MENU") items.current[0]?.focus();
  }, [mode]);
  function onMenuKey(e: React.KeyboardEvent) {
    const at = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items.current[(at + (e.key === "ArrowDown" ? 1 : -1) + labels.length) % labels.length]?.focus();
    } else if (e.key === "Escape") close();
    else if (e.key === "Tab") setMode("CLOSED");
  }
  async function run(request: Request, message: string) {
    setBusy(true);
    const failed = await send(request, true);
    setBusy(false);
    if (failed === null || failed === RELOADED) {
      setMode("CLOSED");
      await onDone(failed ?? message);
    } else if (failed) setError(failed);
  }
  return (
    <div className="relative">
      <button ref={trigger} type="button" aria-label={`Options for ${container.name}`} aria-haspopup="menu" aria-expanded={mode === "MENU"}
        aria-controls={mode === "MENU" ? menuId : undefined}
        onClick={() => { setNotice(null); setMode(mode === "MENU" ? "CLOSED" : "MENU"); }}
        className="inline-flex h-9 min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {mode === "MENU" && (
        <div id={menuId} role="menu" aria-label={`${container.name} options`} onKeyDown={onMenuKey}
          className="absolute right-0 z-20 mt-1 w-44 rounded border border-border bg-card p-1 shadow-lg">
          {labels.map((label, i) => (
            <button key={label} ref={(el) => { items.current[i] = el; }} type="button" role="menuitem" tabIndex={-1}
              onClick={() => {
                if (label === "Rename") return setMode("RENAME");
                if (label === "Usually for…") { setPicked(container.usualQueues); return setMode("LABEL"); }
                const blocked = removeContainerBlocked(container, containers.length);
                if (blocked) { setNotice(blocked); return close(); }
                setMode("REMOVE");
              }}
              className="flex min-h-[44px] w-full items-center rounded px-3 text-left text-sm hover:bg-raised focus-visible:bg-raised focus-visible:outline-none">
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === "RENAME" && (
        <NameDialog id={"rename-container-" + container.id} title={`Rename ${container.name}`} initial={container.name} submitLabel="Save name"
          validate={(n) => containerNameError(n, [...containers, ...containers.flatMap((c) => c.bays)], container.id)}
          onSubmit={async (name) => {
            const failed = await send(renameContainerRequest(container, name), true);
            if (failed !== null && failed !== RELOADED) return failed || null;
            setMode("CLOSED");
            await onDone(failed ?? `Renamed to ${name.trim()}.`);
            return null;
          }}
          onCancel={close} />
      )}
      {mode === "LABEL" && (
        <Modal id={menuId + "-label"} title={`${container.name}: usually for`} onClose={() => !busy && close()}>
          <p className="text-xs text-muted-foreground">Pick the services this container is usually for. It is only a hint: any car can still go in any bay. Pick none for no hint.</p>
          <fieldset className="space-y-1">
            <legend className="sr-only">Usually for</legend>
            {queues.map((q) => (
              <label key={q.code} className="flex min-h-[44px] items-center gap-3 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={picked.includes(q.code)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, q.code] : p.filter((c) => c !== q.code)))} />
                {queueLabel(q.code)}
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            <Button disabled={busy} onClick={() => void run(labelContainerRequest(container, queues.map((q) => q.code).filter((c) => picked.includes(c))), usualForLine(picked) + ".")}>Save</Button>
          </div>
        </Modal>
      )}
      {mode === "REMOVE" && (
        <Modal id={menuId + "-remove"} title={`Remove ${container.name}?`} onClose={() => !busy && close()}>
          <p className="text-sm text-muted-foreground">It disappears from the board. Its booking history is kept, and its name stays reserved.</p>
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={close}>Keep container</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void run(removeContainerRequest(container), `${container.name} removed. Its booking history is kept.`)}>Remove container</Button>
          </div>
        </Modal>
      )}
      {notice && <p role="alert" className="mt-1 max-w-56 text-xs text-amber-400">{notice}</p>}
    </div>
  );
}

// The id is made in the browser and kept until the add succeeds, so a retry after a lost answer is the same request (the server replays it).
export function AddContainer({ containers, onDone }: { containers: readonly Container[]; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = React.useState(""), [error, setError] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const id = React.useRef(crypto.randomUUID());
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded border border-dashed border-border p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const invalid = containerNameError(name, [...containers, ...containers.flatMap((c) => c.bays)]);
        if (invalid) return setError(invalid);
        setBusy(true);
        const failed = await send(addContainerRequest(id.current, name));
        setBusy(false);
        if (failed) return setError(failed);
        if (failed === null) {
          const added = name.trim();
          id.current = crypto.randomUUID();
          setName("");
          await onDone(`${added} added.`);
        }
      }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <label className="block text-xs" htmlFor="add-container-name">New container (a named group of bays)</label>
        <input id="add-container-name" value={name} maxLength={60} autoComplete="off" placeholder="For example, Coating room"
          aria-invalid={error ? true : undefined} aria-describedby={error ? "add-container-error" : undefined}
          onChange={(e) => { setName(e.target.value); setError(null); }} className={fieldClass} />
        {error && <p id="add-container-error" role="alert" className="text-xs text-rose-400">{error}</p>}
      </div>
      <Button id="add-container-button" type="submit" variant="outline" disabled={busy}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Add container
      </Button>
    </form>
  );
}
