"use client";

import { useId } from "react";

const SIZES = { MOTOR: "Motorcycle", S: "Small", M: "Medium", L: "Large", XL: "Extra Large" } as const;
type Size = keyof typeof SIZES;
export type SizeDeductionForm = Partial<Record<Size, { enabled: boolean; amount: string }>>;

export function ServiceExpenseField({ values, onChange }: {
  values: SizeDeductionForm;
  onChange: (value: SizeDeductionForm) => void;
}) {
  const id = useId();
  return (
    <fieldset aria-describedby={id} className="space-y-2 border-t border-border pt-4">
      <legend className="text-xs font-semibold text-muted-foreground">Commission deduction by vehicle size</legend>
      <p id={id} className="text-xs text-muted-foreground">
        Chemical cost deducted before percentage commissions. The default when enabled is ?1,500.
      </p>
      {(Object.keys(SIZES) as Size[]).map((size) => {
        const row = values[size] ?? { enabled: false, amount: "1500" };
        return (
          <div key={size} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1">
            <label className="flex min-h-9 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={row.enabled} className="h-4 w-4 accent-primary"
                onChange={(e) => onChange({ ...values, [size]: { ...row, enabled: e.target.checked } })} />
              {SIZES[size]}
            </label>
            {row.enabled && (
              <input type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" required
                aria-label={`${SIZES[size]} deduction amount (PHP)`} value={row.amount}
                onChange={(e) => onChange({ ...values, [size]: { ...row, amount: e.target.value } })}
                className="h-9 w-32 rounded-md border border-border bg-card px-3 text-right text-sm tabular-nums focus-visible:ring-2 focus-visible:ring-primary" />
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
