import { formatPesos } from "@/lib/commission";

export interface RankedRow { key: string; label: string; centavos: number }

// Largest first, one hue. The list itself is the table view: every name and amount is plain text, the bar is only a picture of it.
export function RankedBars({ rows, empty }: { rows: RankedRow[]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const highest = rows[0].centavos;
  return (
    <ul className="mt-2">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 py-2 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
          <span className="break-words text-foreground">{row.label}</span>
          <svg className="h-2.5 w-full" aria-hidden="true">
            <rect width={`${Math.max(1, (row.centavos / highest) * 100)}%`} height="10" rx="3" className="fill-primary" />
          </svg>
          <span className="text-xs tabular-nums text-foreground">{formatPesos(row.centavos)}</span>
        </li>
      ))}
    </ul>
  );
}
