"use client";

import * as React from "react";
import { ImageUp, RefreshCw } from "lucide-react";
import {
  PROOF_TYPES,
  canSendProof,
  checkProofFile,
  depositWords,
  freezeRequest,
  proofUploadError,
  sendFrozen,
  toBase64,
  type FrozenRequest,
} from "@/components/booking/manage-booking";
import type { DepositProofUploadData, ManagedDayBookingView } from "@/types/contracts";

// P1-18: an optional screenshot of the customer's deposit payment, sent through the management
// session (POST /api/bookings/manage/deposit-proofs). One screenshot per request; files are never
// shown back. An unconfirmed send is retried with the same key and image, so it is stored once.
export function DepositProofSection({
  view,
  onUpdated,
  onSignedOut,
}: {
  view: ManagedDayBookingView;
  onUpdated: (view: ManagedDayBookingView) => void;
  onSignedOut: (message: string) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [inputKey, setInputKey] = React.useState(0);
  const [error, setError] = React.useState("");
  const [sent, setSent] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [retry, setRetry] = React.useState<FrozenRequest | null>(null);
  const { deposit } = view;
  const open = canSendProof(view);

  const choose = (chosen: File | null) => {
    setSent("");
    setError(chosen ? checkProofFile(chosen, deposit) ?? "" : "");
    setFile(chosen && !checkProofFile(chosen, deposit) ? chosen : null);
  };

  const send = async (request: FrozenRequest) => {
    setPending(true);
    setError("");
    try {
      const result = await sendFrozen<DepositProofUploadData>(fetch, request);
      if (result.ok) {
        setRetry(null);
        setFile(null);
        setInputKey((k) => k + 1);
        setSent("Your screenshot was sent.");
        onUpdated(result.data.booking);
        return;
      }
      const shown = proofUploadError(result.error);
      if (shown.signedOut) return onSignedOut(shown.message);
      setRetry(shown.retrySame ? request : null);
      setError(shown.message);
    } finally {
      setPending(false);
    }
  };

  const start = async () => {
    if (!file || pending) return;
    let image: string;
    try {
      image = toBase64(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setError("This file could not be read. Choose it again.");
      return;
    }
    await send(freezeRequest("/api/bookings/manage/deposit-proofs", { bookingId: view.id, idempotencyKey: crypto.randomUUID(), image }));
  };

  return (
    <section aria-labelledby="deposit-title" className="rounded border border-border bg-card p-6 sm:p-8">
      <h2 id="deposit-title" className="text-lg font-bold text-foreground">Send deposit screenshot</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Optional. If you paid a deposit, send a screenshot of the payment so the shop can check it.
      </p>

      <div className="mt-4 rounded border border-border/60 bg-[#121214] p-4 text-sm">
        <p className="font-semibold text-foreground" role="status" aria-live="polite">
          {depositWords(deposit)}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {deposit.proofsSent} of {deposit.proofsAllowed} screenshots sent
        </p>
      </div>

      {open && (
        <div className="mt-4">
          <label htmlFor="deposit-file" className="text-sm font-semibold text-foreground">
            Payment screenshot
          </label>
          <p id="deposit-file-help" className="mt-1 text-xs text-zinc-400">
            JPEG, PNG or WebP, up to 5 MB. Up to {deposit.proofsAllowed} screenshots per booking.
          </p>
          <input
            key={inputKey}
            id="deposit-file"
            type="file"
            accept={PROOF_TYPES.join(",")}
            disabled={pending || retry !== null}
            aria-describedby={error ? "deposit-file-help deposit-error" : "deposit-file-help"}
            aria-invalid={Boolean(error) && !retry}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full min-h-[48px] rounded border border-input bg-card px-3 py-2.5 text-sm text-foreground file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            {retry ? (
              <button
                type="button"
                onClick={() => void send(retry)}
                disabled={pending}
                className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {pending ? "Sending…" : "Retry the same screenshot"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void start()}
                disabled={!file || pending}
                className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ImageUp className="h-4 w-4" aria-hidden="true" />
                {pending ? "Sending…" : "Send screenshot"}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p id="deposit-error" role="alert" className="mt-3 rounded border border-destructive p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {sent && !error && <p className="mt-3 text-sm text-emerald-400">{sent}</p>}
    </section>
  );
}
