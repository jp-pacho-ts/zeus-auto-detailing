import { formatPesos } from "@/lib/commission";

export interface RankedRow {
  key: string;
  label: string;
  centavos: number;
}

// Largest first, one hue. The list itself is the table view: every name and amount is plain text, the bar is only a picture of it.
export function RankedBars({
  rows,
  empty,
  selectedKey,
  onSelectKey,
}: {
  rows: RankedRow[];
  empty: string;
  selectedKey?: string | null;
  onSelectKey?: (key: string) => void;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const highest = Math.max(...rows.map((r) => r.centavos), 1);
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((row) => {
        const isSelected = selectedKey ? row.key === selectedKey : false;
        const widthPct = Math.max(1, Math.round((row.centavos / highest) * 100));
        return (
          <li
            key={row.key}
            onClick={() => onSelectKey?.(row.key)}
            className={`grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors sm:grid-cols-[minmax(0,10rem)_1fr_auto] ${
              onSelectKey ? "cursor-pointer" : ""
            } ${isSelected ? "border border-primary/50 bg-primary/10" : "hover:bg-zinc-800/40"}`}
          >
            <span className={`break-words text-sm ${isSelected ? "font-semibold text-primary" : "text-foreground"}`}>
              {row.label}
            </span>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800/80">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isSelected ? "bg-primary" : "bg-primary/80"}`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {formatPesos(row.centavos)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
