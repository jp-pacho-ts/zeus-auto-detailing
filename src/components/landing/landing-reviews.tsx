"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, MessageSquareQuote } from "lucide-react";

const subscribe = () => () => {};

// Owner-approved review content has not been supplied. Slots have no names, stars or invented quotations.
export function LandingReviews() {
  const [active, setActive] = useState(0);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const move = (direction: number) => { const viewport = track.current; if (!viewport) return; viewport.scrollBy({ left: direction * (viewport.querySelector("article")!.getBoundingClientRect().width + 24), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); };
  return <section id="reviews" className="landing-section landing-wrap landing-reviews" aria-labelledby="landing-reviews-title">
    <div className="landing-review-head"><div><p className="landing-eyebrow">Customer feedback</p><h2 id="landing-reviews-title">Customer experiences<span className="landing-gold-dot">.</span></h2></div><div className="landing-review-intro"><p>Owner-approved customer feedback will be published here.</p><div className="landing-review-controls" aria-label="Feedback card controls"><button type="button" disabled={!ready || active === 0} onClick={() => move(-1)} aria-label="Previous feedback card"><ArrowLeft aria-hidden="true" /></button><button type="button" disabled={!ready || active === 2} onClick={() => move(1)} aria-label="Next feedback card"><ArrowRight aria-hidden="true" /></button><span aria-live="polite">{active + 1} / 3</span></div></div></div>
    <div className="landing-review-window"><div ref={track} className="landing-review-track" tabIndex={0} aria-label="Preview feedback slots. No published reviews yet."
      onScroll={(e) => { const width = e.currentTarget.querySelector("article")!.getBoundingClientRect().width + 24; setActive(Math.max(0, Math.min(2, Math.round(e.currentTarget.scrollLeft / width)))); }}
      onPointerDown={(e) => { if (e.pointerType !== "mouse" || e.button !== 0) return; drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft }; e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.classList.add("is-dragging"); }}
      onPointerMove={(e) => { if (drag.current) { e.preventDefault(); e.currentTarget.scrollLeft = drag.current.left - (e.clientX - drag.current.x); } }}
      onPointerUp={(e) => { drag.current = null; e.currentTarget.classList.remove("is-dragging"); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onLostPointerCapture={(e) => { drag.current = null; e.currentTarget.classList.remove("is-dragging"); }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); move(e.key === "ArrowLeft" ? -1 : 1); } }}>
      {["The everyday refresh", "A finish worth caring for", "The next chapter"].map((title, i) => <article className="landing-review-card" key={title}><div className="landing-review-card-top"><MessageSquareQuote aria-hidden="true" /><span>0{i + 1}</span></div><span className="landing-review-pending">Review awaiting owner approval</span><h3>{title}</h3><p>Customer feedback will appear here.</p><div className="landing-review-card-bottom"><span className="landing-review-avatar" aria-hidden="true">Z</span><span>Reserved for a Zeus customer<br /><small>Verified quote to be added</small></span></div></article>)}
    </div>
    <p className="landing-review-disclaimer">Preview content slots. No ratings or customer testimonials are claimed.</p></div>
  </section>;
}
