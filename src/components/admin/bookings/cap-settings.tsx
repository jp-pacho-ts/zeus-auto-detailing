"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AdminQueueCaps } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "./client";
import { dateClass, fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
import { shopDay } from "./detail/shared";
// P1-77: each line of work reads as one sentence with an Edit button; the day picker comes last, not first.
export function CapSettings({
  date,
  onChanged,
  onDateChange,
}: {
  date: string;
  onChanged: () => unknown;
  onDateChange?: (date: string) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const caps = useAdminResource<AdminQueueCaps[]>(
    `/api/admin/schedule/caps?from=${date}&to=${date}`,
  );
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState<string | null>(null),
    [message, setMessage] = React.useState<string | null>(null);
  const writing = React.useRef(false),
    mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save(
    code: string,
    body: unknown,
    override: boolean,
    method = "PUT",
  ) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await adminRequest(
        `/api/admin/schedule/caps/${code}${override ? `/${date}` : ""}`,
        { method, body },
      );
      if (mounted.current) {
        setMessage("Queue limit updated.");
        void caps.reload();
        void onChanged();
      }
    } catch (e) {
      if (mounted.current) {
        if (e instanceof AdminRequestError && e.status === 401) {
          window.location.replace("/admin/login");
          return;
        }
        setError(
          e instanceof Error
            ? e.message
            : "Limit update failed. Refresh before retrying.",
        );
        void caps.reload();
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section aria-labelledby="caps-title">
      <h3 id="caps-title" className="text-sm font-semibold text-foreground">
        Limits on {shopDay(date)}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Limits are off by default. Leave the default blank for no limit. An
        enabled limit counts car visits and cannot go below committed visits.
      </p>
      <LoadState
        loading={caps.loading}
        error={caps.error}
        retry={caps.reload}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {caps.data?.map((q) => {
        const override = q.overrides.find((d) => d.date === date);
        const booked = q.committed.find((d) => d.date === date)?.count ?? 0;
        const open = editing === q.code;
        return (
          <div
            key={q.code + q.revision + (override?.revision ?? 0)}
            className="mt-3 border-t border-border pt-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-sm">
                <span className="font-semibold text-foreground">{q.name}</span>{" "}
                <span className="text-muted-foreground">
                  {q.dailyCap === null ? "No daily limit" : `Up to ${q.dailyCap} cars a day`} · {booked} booked
                  {override ? ` · this day: up to ${override.dailyCap}` : ""}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={open}
                aria-label={(open ? "Close " : "Edit ") + q.name + " limits"}
                onClick={() => setEditing(open ? null : q.code)}
              >
                {open ? "Close" : "Edit"}
              </Button>
            </div>
            {open && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get("cap"),
                  );
                  if (window.confirm(`Update ${q.name}'s default limit?`))
                    void save(
                      q.code,
                      {
                        expectedRevision: q.revision,
                        dailyCap: value === "" ? null : Number(value),
                      },
                      false,
                    );
                }}
              >
                <label className="text-xs">
                  Default limit · {q.name}
                  <input
                    type="number"
                    name="cap"
                    min={0}
                    max={500}
                    defaultValue={q.dailyCap ?? ""}
                    placeholder="Off (no limit)"
                    className={fieldClass}
                  />
                </label>
                <Button className="mt-2" disabled={busy}>
                  Save default limit
                </Button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = Number(
                    new FormData(e.currentTarget).get("cap"),
                  );
                  if (
                    window.confirm(
                      `Set ${q.name}'s optional limit for ${date}?`,
                    )
                  )
                    void save(
                      q.code,
                      {
                        expectedRevision: override?.revision ?? null,
                        dailyCap: value,
                      },
                      true,
                    );
                }}
              >
                <label className="text-xs">
                  Date limit (optional) · {q.name}
                  <input
                    type="number"
                    name="cap"
                    min={0}
                    max={500}
                    required
                    defaultValue={override?.dailyCap ?? ""}
                    className={fieldClass}
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={busy}>Save date limit</Button>
                  {override && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove this date override and use the default limit?",
                          )
                        )
                          void save(
                            q.code,
                            { expectedRevision: override.revision },
                            true,
                            "DELETE",
                          );
                      }}
                    >
                      Remove override
                    </Button>
                  )}
                </div>
              </form>
            </div>
            )}
          </div>
        );
      })}
      {onDateChange && (
        <label className="mt-4 block border-t border-border pt-4 text-xs font-semibold text-muted-foreground">
          Day shown (booked counts and one-day limits)
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value) onDateChange(e.target.value);
            }}
            className={dateClass + " block"}
          />
        </label>
      )}
    </section>
  );
}
