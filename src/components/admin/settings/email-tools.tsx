"use client";

// P1-78 UI (items 1 and 5): send a test email to the shop inbox, and preview each customer email with sample data.
// Security C3: the email HTML goes only into an iframe with an EMPTY sandbox attribute and srcdoc (no scripts, an opaque
// origin, no navigation); the text version is a plain text node. The page's CSP is unchanged.
import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminEmailPreview, AdminEmailPreviewKind } from "@/types/admin-contracts";
import { adminRequest } from "../bookings/client";
import { Select } from "../bookings/use-admin-resource";
import { describeError } from "../team/team-panel";
import { SettingsCard } from "./section-card";
import { PREVIEW_KINDS } from "./settings-model";

export function EmailPreviewView({ label, preview }: { label: string; preview: AdminEmailPreview }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Sample booking, not a real customer.</p>
      <p className="text-sm">
        <span className="text-muted-foreground">Subject: </span>
        <span className="font-semibold text-foreground">{preview.subject}</span>
      </p>
      {preview.html !== null ? (
        <iframe
          sandbox=""
          srcDoc={preview.html}
          title={"Preview: " + label + " email"}
          referrerPolicy="no-referrer"
          className="block h-[360px] w-full rounded-lg border border-border bg-white sm:h-[480px]"
        />
      ) : (
        <p className="text-xs text-muted-foreground">This email is sent as plain text.</p>
      )}
      {preview.html !== null ? (
        <details className="rounded-lg border border-border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Plain text version</summary>
          <p className="whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-xs text-foreground">{preview.text}</p>
        </details>
      ) : (
        <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground">{preview.text}</p>
      )}
    </div>
  );
}

function Result({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <p role={ok ? "status" : "alert"} className={"flex items-center gap-2 text-xs font-medium " + (ok ? "text-emerald-400" : "text-rose-400")}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

// 2026-11-25 (LE, Vercel-style Settings): two cards. The test card's footer shows the send result above its note.
export function EmailTools({ busy, onSendTest, testResult }: { busy: boolean; onSendTest: () => Promise<void>; testResult?: React.ReactNode }) {
  const [kind, setKind] = React.useState<AdminEmailPreviewKind>("confirmation");
  const [preview, setPreview] = React.useState<AdminEmailPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const shown = React.useRef(false); // after the first Show preview, a new choice loads by itself
  const asked = React.useRef(0); // only the latest request may show its answer

  async function load(next: AdminEmailPreviewKind) {
    const id = ++asked.current;
    setLoading(true);
    setPreviewError(null);
    try {
      const data = await adminRequest<AdminEmailPreview>("/api/admin/settings/email-preview?kind=" + encodeURIComponent(next));
      if (id === asked.current) setPreview(data);
    } catch (e) {
      if (id === asked.current) {
        setPreview(null);
        setPreviewError(describeError(e));
      }
    } finally {
      if (id === asked.current) setLoading(false);
    }
  }

  async function sendTest() {
    if (busy || sending) return;
    setSending(true);
    try {
      await onSendTest();
    } finally {
      setSending(false);
    }
  }

  const label = PREVIEW_KINDS.find(([k]) => k === kind)![1];
  return (
    <>
      <SettingsCard
        title="Send a test email"
        description="Sends one short email to the shop inbox, so you know emails are going out."
        result={testResult}
        hint="Goes to the shop inbox only. Up to 3 every 10 minutes."
        action={
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={busy || sending} onClick={() => void sendTest()}>
            {sending ? "Sending…" : "Send a test email"}
          </Button>
        }
      />

      <SettingsCard title="Preview an email" description="See what customers get, filled in with a sample booking.">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground sm:max-w-xs">
              Email to preview
              <Select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as AdminEmailPreviewKind;
                  setKind(next);
                  if (shown.current) void load(next);
                }}
              >
                {PREVIEW_KINDS.map(([k, name]) => (
                  <option key={k} value={k}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={loading}
              onClick={() => {
                shown.current = true;
                void load(kind);
              }}
            >
              {loading ? "Loading…" : "Show preview"}
            </Button>
          </div>
          {previewError && <Result ok={false} text={previewError} />}
          {preview && preview.kind === kind && <EmailPreviewView label={label} preview={preview} />}
        </div>
      </SettingsCard>
    </>
  );
}
