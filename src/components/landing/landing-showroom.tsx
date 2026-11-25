"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";

export type ShowroomPick = {
  id: string; name: string; kind: string; description: string | null;
  photo?: { src: string; alt: string; position?: string };
  // No duration: service times are not guaranteed (LE 2026-11-20).
  percent: number | null; saving: string | null;
  rows: { size: string; price: string; regular: string | null }[];
  details: string;
};

const SLIDE_MS = 7000;

const REDUCED = "(prefers-reduced-motion: reduce)";
const onMotionChange = (notify: () => void) => { const m = matchMedia(REDUCED); m.addEventListener("change", notify); return () => m.removeEventListener("change", notify); };

// Counts up to `value` whenever `run` turns on; the server-rendered markup already holds the final number.
function CountTo({ value, run }: { value: number; run: boolean }) {
  const node = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = node.current;
    if (!el || !run || matchMedia(REDUCED).matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      el.textContent = String(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); el.textContent = String(value); };
  }, [value, run]);
  return <span ref={node}>{value}</span>;
}

const noSubscribe = () => () => {};

// LE 2026-11-20 showroom (refs: Lamborghini's one-model stage, Porsche's spec numbers, McLaren's
// progress slider): one top pick at a time on a full-width stage, with tabs, arrows, swipe and a slow autoplay.
// Autoplay waits until the showroom is on screen, pauses on hover or focus, stops for good once the visitor takes
// control, and never runs for reduced motion. Every pick is in the server HTML (inactive ones hidden), so it all
// works without JavaScript too. A change keeps the outgoing pick on stage (inert) while the new shot wipes over it.
export function LandingShowroom({ picks, booking }: { picks: ShowroomPick[]; booking: { label: string; href: string } }) {
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [seen, setSeen] = useState(false);
  const [held, setHeld] = useState(false);
  const [manual, setManual] = useState(false);
  // Before hydration (server snapshot) nothing autoplays and nothing waits for an entrance.
  const still = useSyncExternalStore(onMotionChange, () => matchMedia(REDUCED).matches, () => true);
  const live = useSyncExternalStore(noSubscribe, () => true, () => false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const touch = useRef<number | null>(null);
  const many = picks.length > 1;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setSeen(true); }, { threshold: .2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const show = (index: number, direction: "next" | "prev") => {
    const i = (index + picks.length) % picks.length;
    if (i === active) return i;
    setPrev(active);
    setDir(direction);
    setActive(i);
    return i;
  };
  const playing = many && seen && !held && !manual && !still;
  useEffect(() => {
    if (!playing) return;
    const next = setTimeout(() => { setPrev(active); setDir("next"); setActive((active + 1) % picks.length); }, SLIDE_MS);
    return () => clearTimeout(next);
  }, [playing, active, picks.length]);
  // The outgoing pick leaves the stage once the new shot has covered it.
  useEffect(() => {
    if (prev === null) return;
    const done = setTimeout(() => setPrev(null), 1200);
    return () => clearTimeout(done);
  }, [prev, active]);
  const go = (index: number, focus = false, direction?: "next" | "prev") => {
    setManual(true);
    const i = show(index, direction ?? (index < active ? "prev" : "next"));
    if (focus) tabs.current[i]?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); go(e.key === "Home" ? 0 : picks.length - 1, true); }
    else if (step) { e.preventDefault(); go(active + step, true, step > 0 ? "next" : "prev"); }
  };
  return <div ref={root} className="landing-showroom" data-many={many} data-dir={dir} data-seen={live ? seen : undefined}
    onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
    onFocus={() => setHeld(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHeld(false); }}
    onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
    onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 50) go(active + (dx < 0 ? 1 : -1), false, dx < 0 ? "next" : "prev"); }}>
    <div className="landing-showroom-stage">
    {picks.map((p, i) => {
      const state = i === active ? "in" : i === prev ? "out" : undefined;
      return <article key={p.id} className="landing-showroom-panel" id={`landing-pick-${i}`} hidden={!state} data-state={state} inert={state === "out" || undefined}
        {...(many ? { role: "tabpanel", "aria-labelledby": `landing-pick-tab-${i}` } : {})}>
        <div className="landing-showroom-photo">
          {p.photo && <Image src={p.photo.src} alt={p.photo.alt} width={1600} height={1200} sizes="100vw" style={p.photo.position ? { objectPosition: p.photo.position } : undefined} />}
          <span className="landing-featured-tag" data-promo={p.percent !== null}>{p.percent !== null ? "Promo" : "Featured"}</span>
          {p.percent !== null && <p className="landing-featured-off"><span className="landing-sr">Up to {p.percent}% off</span><span className="landing-featured-off-vis" aria-hidden="true">
            <small>Up to</small><span className="landing-featured-figure"><strong><CountTo value={p.percent} run={seen && i === active} />%</strong><small>off</small></span>
          </span></p>}
        </div>
        <div className="landing-showroom-info">
          {/* Left: the pick and its actions. Right: the price card. */}
          <div className="landing-showroom-copy">
            <p className="landing-featured-kind">{p.kind}</p>
            <h3>{p.name}</h3>
            {p.description && <p className="landing-featured-text">{p.description}</p>}
            <div className="landing-featured-actions">
              {/* Outline, not gold: the gold budget keeps gold buttons to the hero, closing band and phone bar; gold here means a discount. */}
              <a className="landing-kbtn landing-k-outline" href={booking.href}><span className="landing-k-label"><span>{booking.label}</span></span><span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span></a>
              <a className="landing-text-link landing-featured-more" href={p.details}>Details<ArrowUpRight aria-hidden="true" /></a>
            </div>
          </div>
          <div className="landing-showroom-card">
            {/* The percent is the hero on the photo; the spec line carries the peso saving. */}
            {p.saving && <dl className="landing-showroom-specs"><div><dt>You save up to</dt><dd>{p.saving}</dd></div></dl>}
            <dl className="landing-featured-prices">{p.rows.map((r) => <div key={r.size}>
              <dt>{r.size}</dt>
              <dd>{r.regular
                ? <><span className="landing-sr">Promo price </span><strong>{r.price}</strong><s><span className="landing-sr">, regular price </span>{r.regular}</s></>
                : <strong>{r.price}</strong>}</dd>
            </div>)}</dl>
          </div>
        </div>
      </article>;
    })}
    </div>
    {many && <div className="landing-showroom-bar">
      {/* Each tab is a segment; the open one fills with the autoplay timer. */}
      <div className="landing-showroom-tabs" role="tablist" aria-label="Top picks" onKeyDown={onTabKey}>{picks.map((p, i) =>
        <button key={p.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`landing-pick-tab-${i}`} aria-selected={i === active} aria-controls={`landing-pick-${i}`} tabIndex={i === active ? 0 : -1} onClick={() => go(i)}>
          <span className="landing-showroom-line" aria-hidden="true">{i === active && <i key={active} data-run={playing} style={{ animationDuration: `${SLIDE_MS}ms` }} />}</span>
          <span className="landing-showroom-index">0{i + 1}</span>{p.kind}
        </button>)}
      </div>
      <div className="landing-showroom-arrows">
        <button type="button" className="landing-showroom-arrow" aria-label="Previous pick" onClick={() => go(active - 1, false, "prev")}><ChevronLeft aria-hidden="true" /></button>
        <button type="button" className="landing-showroom-arrow" aria-label="Next pick" onClick={() => go(active + 1, false, "next")}><ChevronRight aria-hidden="true" /></button>
      </div>
    </div>}
  </div>;
}
