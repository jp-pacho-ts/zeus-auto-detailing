"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AdminQueueCaps } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "./client";
import { fieldClass, LoadState, useAdminResource } from "./use-admin-resource";
export function CapSettings({
  date,
  onChanged,
}: {
  date: string;
  onChanged: () => unknown;
}) {
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
        setMessage("Queue cap updated.");
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
            : "Cap update failed. Refresh before retrying.",
        );
        void caps.reload();
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className="rounded border border-border bg-[#121214] p-4 sm:p-6"
      aria-labelledby="caps-title"
    >
      <h2 id="caps-title" className="font-bold">
        Queue caps · {date}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Caps count car visits. An unconfigured cap means fully booked. Changes
        cannot go below committed visits.
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
        return (
          <div
            key={q.code + q.revision + (override?.revision ?? 0)}
            className="mt-4 border-t border-border pt-4"
          >
            <h3 className="text-sm font-bold">{q.name}</h3>
            <p className="text-xs text-muted-foreground">
              Committed: {q.committed.find((d) => d.date === date)?.count ?? 0}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get("cap"),
                  );
                  if (window.confirm(`Update ${q.name}'s default cap?`))
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
                  Default cap · {q.name}
                  <input
                    type="number"
                    name="cap"
                    min={0}
                    max={500}
                    defaultValue={q.dailyCap ?? ""}
                    placeholder="Unconfigured"
                    className={fieldClass}
                  />
                </label>
                <Button className="mt-2" disabled={busy}>
                  Save default cap
                </Button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = Number(
                    new FormData(e.currentTarget).get("cap"),
                  );
                  if (window.confirm(`Set ${q.name}'s cap for ${date}?`))
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
                  Date cap · {q.name}
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
                  <Button disabled={busy}>Save date cap</Button>
                  {override && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove this date override and use the default cap?",
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
          </div>
        );
      })}
    </section>
  );
}
