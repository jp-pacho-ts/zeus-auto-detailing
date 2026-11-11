import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";

export interface MetricCardProps {
  title: string;
  value: string;
  meta?: string;
}

export function MetricCard({ title, value, meta }: MetricCardProps) {
  const isLoading = value === "—";
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-[#161619] p-4 transition-colors hover:border-primary/40 hover:bg-[#18181c]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60 transition-transform group-hover:scale-125" aria-hidden="true" />
      </div>
      {isLoading ? (
        <>
          <Skeleton className="mt-2.5 h-7 w-24" />
          <span className="sr-only">{value}</span>
        </>
      ) : (
        <b className="mt-2 block font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-3xl">
          {value}
        </b>
      )}
      {meta ? (
        <small className="mt-1.5 block text-xs font-medium text-emerald-400">
          {meta}
        </small>
      ) : null}
    </div>
  );
}
