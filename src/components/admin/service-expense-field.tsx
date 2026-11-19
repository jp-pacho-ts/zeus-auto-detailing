"use client";

import { useId } from "react";

export function ServiceExpenseField({ enabled, onEnabled, amount, onAmount }: {
  enabled: boolean; onEnabled: (value: boolean) => void;
  amount: string; onAmount: (value: string) => void;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-3 border-t border-border pt-4">
      <legend className="text-xs font-semibold text-muted-foreground">Commission deduction</legend>
      <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary" />
        Deduct a cost before percentage commissions
      </label>
      {enabled && (
        <label className="flex items-center justify-between gap-3 text-sm text-foreground">
          <span>Deduction amount (PHP)</span>
          <input type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required
            value={amount} onChange={(e) => onAmount(e.target.value)} aria-describedby={id}
            className="h-9 w-32 rounded-md border border-border bg-card px-3 text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </label>
      )}
      <p id={id} className="text-xs text-muted-foreground">
        Changes apply to future booking completions.
      </p>
    </fieldset>
  );
}
