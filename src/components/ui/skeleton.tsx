import * as React from "react";

export function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-white/[0.06] ${className}`}
      {...props}
    />
  );
}

export function AdminRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="divide-y divide-border/60 rounded-lg border border-border/70 bg-[#121214]"
    >
      <span className="sr-only">Loading shop data...</span>
      <div className="flex items-center justify-between gap-4 border-b border-border/70 bg-[#18181b]/60 px-4 py-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-1 items-center gap-3 p-4 sm:grid-cols-4 xl:grid-cols-7"
        >
          <Skeleton className="h-4 w-24" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20 opacity-70" />
          </div>
          <Skeleton className="hidden h-3.5 w-32 sm:block" />
          <div className="hidden space-y-1.5 xl:block">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-16 opacity-70" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="hidden h-4 w-16 xl:block" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-14 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminBoardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_18rem] lg:items-start"
    >
      <span className="sr-only">Loading shop data...</span>
      <div className="space-y-3 rounded-lg border border-border bg-[#121214] p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-28 w-full rounded-md" />
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
      <div className="space-y-4">
        {[0, 1].map((c) => (
          <div
            key={c}
            className="space-y-3 rounded-lg border border-border bg-[#121214] p-4"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-40 opacity-70" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className="h-44 w-full rounded-md" />
              <Skeleton className="h-44 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-[#121214] p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    </div>
  );
}

export function AdminShellSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-dvh flex-col overflow-hidden bg-[#09090b] text-[#f5f5f4] md:flex-row"
    >
      <span className="sr-only">Loading shop data...</span>
      {/* Sidebar Skeleton */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-[#121214] md:flex">
        <div className="flex h-20 items-center justify-center border-b border-border px-4">
          <Skeleton className="h-7 w-24" />
        </div>
        <div className="flex-1 space-y-6 px-3.5 py-5">
          {[4, 4, 1].map((count, g) => (
            <div
              key={g}
              className={g > 0 ? "border-t border-border/60 pt-5" : ""}
            >
              <Skeleton className="mb-2.5 ml-3 h-2.5 w-20" />
              <div className="space-y-2">
                {Array.from({ length: count }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-md" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-2.5">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-20 shrink-0 items-center border-b border-border bg-[#121214] px-4 sm:px-8 lg:px-10">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-2.5 w-32" />
              <Skeleton className="h-6 w-40" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>
        </header>
        <main className="flex-1 space-y-6 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-[1600px] space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-[#121214] p-4"
                >
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-20" />
                  <Skeleton className="mt-3 h-2.5 w-32 opacity-70" />
                </div>
              ))}
            </div>
            <AdminRowsSkeleton rows={5} />
          </div>
        </main>
      </div>
    </div>
  );
}
