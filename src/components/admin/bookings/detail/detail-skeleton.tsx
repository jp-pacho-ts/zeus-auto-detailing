import { Skeleton } from "@/components/ui/skeleton";

// Loading state in the shape of the real layout, so nothing jumps when the booking arrives.
export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading booking...</span>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 bg-panel px-4 py-3 sm:px-6">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="space-y-3 rounded-xl border border-border bg-panel p-4 sm:p-5">
          <Skeleton className="h-4 w-20" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-8 w-48 sm:block" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border bg-panel p-4 sm:p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
