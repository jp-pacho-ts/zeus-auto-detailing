import * as React from "react";

export interface MetricCardProps {
  title: string;
  value: string;
  meta: string;
}

export function MetricCard({ title, value, meta }: MetricCardProps) {
  return (
    <div className="rounded border border-border bg-[#18181b] p-5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <b className="mt-2 block text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {value}
      </b>
      <small className="mt-1 block text-xs font-semibold text-emerald-400">
        {meta}
      </small>
    </div>
  );
}
