"use client";
import * as React from "react";
import type { AdminAnalyticsBucket, AdminAnalyticsBucketUnit } from "@/types/admin-contracts";
import { barText, bucketAxisLabel, bucketLabel, compactPesos, niceTicks } from "./analytics-model";

const LEFT = 48, RIGHT = 4, TOP = 18, BOTTOM = 24, MAX_BAR = 24;

// One series, one colour, one axis. Plain SVG: the table beside it holds every value, and hover and keyboard show the same text.
export function ColumnChart({ rows, unit }: { rows: AdminAnalyticsBucket[]; unit: AdminAnalyticsBucketUnit }) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState<number | null>(null);
  const [focusable, setFocusable] = React.useState(0);
  React.useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 500 ? 200 : 250, plot = height - TOP - BOTTOM, band = (width - LEFT - RIGHT) / rows.length;
  const bar = Math.min(MAX_BAR, Math.max(3, band - 2));
  const highest = Math.max(...rows.map((r) => r.revenueCentavos));
  const ticks = niceTicks(highest), top = ticks.at(-1) || 1;
  const y = (value: number) => TOP + plot - (value / top) * plot;
  const everyNth = Math.ceil(36 / Math.max(band, 1));
  const peak = rows.findIndex((r) => r.revenueCentavos === highest);
  const shown = active === null ? null : rows[active];

  function move(event: React.KeyboardEvent, index: number) {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : null;
    if (next === null || next < 0 || next >= rows.length) return;
    event.preventDefault();
    setFocusable(next);
    wrap.current?.querySelector<SVGGElement>(`[data-bar="${next}"]`)?.focus();
  }

  return (
    <div ref={wrap} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label="Revenue chart. Use the arrow keys to move between bars, or Show as table for every value." className="block">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={LEFT} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
              <text x={LEFT - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{compactPesos(tick)}</text>
            </g>
          ))}
          {rows.map((row, index) => {
            const x = LEFT + index * band, h = row.revenueCentavos > 0 ? Math.max(2, (row.revenueCentavos / top) * plot) : 0;
            const left = x + (band - bar) / 2, tip = TOP + plot - h, r = Math.min(4, bar / 2, h);
            return (
              <g
                key={row.start}
                data-bar={index}
                role="img"
                aria-label={`${bucketLabel(row, unit)}: ${barText(row)}`}
                tabIndex={index === focusable ? 0 : -1}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => { setActive(index); setFocusable(index); }}
                onBlur={() => setActive(null)}
                onKeyDown={(event) => move(event, index)}
                className="outline-none"
              >
                <rect x={x} y={TOP} width={band} height={plot} fill="transparent" className={active === index ? "stroke-muted-foreground" : ""} strokeWidth={1} />
                {h > 0 && (
                  <path
                    d={`M${left} ${TOP + plot}V${tip + r}Q${left} ${tip} ${left + r} ${tip}H${left + bar - r}Q${left + bar} ${tip} ${left + bar} ${tip + r}V${TOP + plot}Z`}
                    className={active === index ? "fill-primary-hover" : "fill-primary"}
                  />
                )}
                {index === peak && h > 0 && (
                  <text x={x + band / 2} y={Math.max(11, tip - 5)} textAnchor="middle" className="fill-foreground text-[11px] tabular-nums">{compactPesos(row.revenueCentavos)}</text>
                )}
                {index % everyNth === 0 && (
                  <text x={x + band / 2} y={height - 7} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">{bucketAxisLabel(row, unit)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {shown && active !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded border border-border bg-black px-3 py-2 text-xs text-foreground"
          style={{ top: 0, ...(LEFT + active * band > width / 2 ? { right: width - (LEFT + active * band) } : { left: LEFT + (active + 1) * band }) }}
        >
          <b className="block">{bucketLabel(shown, unit)}</b>
          {barText(shown)}
        </div>
      )}
    </div>
  );
}
