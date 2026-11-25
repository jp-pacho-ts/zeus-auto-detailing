"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AdminBookingDeductionPreview, AdminBookingDetail } from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../client";
import { money } from "../model";
import { writeFeedback } from "../board-model";
import { Select } from "../use-admin-resource";
import { label } from "./shared";

export function BookingDeductionCorrection({ booking, disabled, onSaved }: { booking: AdminBookingDetail; disabled: boolean; onSaved: () => void }) {
  const [lineId, setLineId] = useState("");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<AdminBookingDeductionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lines = booking.lines.filter((line) => !line.removed);

  async function request(save: boolean) {
    if (busy || disabled || !lineId || (save && !preview)) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminRequest<AdminBookingDeductionPreview>(`/api/admin/bookings/${booking.id}/commission`, {
        method: "POST",
        body: { lineId, deductionCentavos: Math.round(Number(amount) * 100), ...(save ? { expected: preview!.token } : {}) },
      });
      setPreview(result);
      setSaved(save);
      if (save) {
        onSaved();
        window.dispatchEvent(new Event("zeus:commissions-changed"));
      }
    } catch (err) {
      setPreview(null);
      setError(err instanceof AdminRequestError ? writeFeedback(err.detail).message : "Could not reach the server. Preview again.");
    } finally {
      setBusy(false);
    }
  }

  if (!lines.length) return null;
  return (
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">Change deduction for this booking</summary>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void request(false); }}>
        <label className={label}>
          Service
          <Select required value={lineId} disabled={busy || disabled}
            onChange={(e) => { setLineId(e.target.value); setPreview(null); setSaved(false); }}>
            <option value="">Choose a service</option>
            {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
          </Select>
        </label>
        <label className={label}>
          Deduction (PHP)
          <input type="number" min="0" max="1000000" step="0.01" required value={amount} disabled={busy || disabled}
            onChange={(e) => { setAmount(e.target.value); setPreview(null); setSaved(false); }}
            className="h-10 w-32 rounded-md border border-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary" />
        </label>
        <Button variant="outline" disabled={busy || disabled}>Preview correction</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Enter 0 to remove the deduction. Preview uses today&apos;s rates to calculate the difference for this service.</p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {preview && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">Deduction {money(preview.previousDeductionCentavos)} → {money(Math.round(Number(amount) * 100))}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums" aria-label="Deduction correction per worker">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th scope="col">Worker</th><th scope="col" className="text-right">Paid</th>
                <th scope="col" className="text-right">Corrected</th><th scope="col" className="text-right">Adjustment</th>
              </tr></thead>
              <tbody>{preview.rows.map((row) => (
                <tr key={row.entryId} className="border-t border-border">
                  <td className="py-1">{row.name}</td><td className="text-right">{money(row.paidCentavos)}</td>
                  <td className="text-right">{money(row.correctedCentavos)}</td><td className="text-right">{money(row.differenceCentavos)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {saved ? <p role="status" className="text-sm">Booking deduction correction saved.</p> : (
            <Button type="button" disabled={busy || disabled || preview.previousDeductionCentavos === Math.round(Number(amount) * 100)}
              onClick={() => void request(true)}>Save correction</Button>
          )}
        </div>
      )}
    </details>
  );
}
