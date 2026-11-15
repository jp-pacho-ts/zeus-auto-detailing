"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(useGSAP, ScrollTrigger);

// The one motion owner (17.11.4): M1 hero parallax, M2 card reveal, M3 closing band, plus the H2 rise.
// Transforms only. SSR text and actions stay visible even if GSAP or a trigger fails.
export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const one = (selector: string) => root.querySelector<HTMLElement>(selector);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const media = gsap.matchMedia();
    media.add({ motion: "(prefers-reduced-motion: no-preference)", phone: "(max-width: 767px)" }, (context) => {
      const { motion, phone } = context.conditions as { motion: boolean; phone: boolean };
      if (!motion) return;
      const k = phone ? 0.5 : 1;
      const hero = one(".landing-hero"), frame = one(".landing-media-frame"), layer = one(".landing-media-layer"), word = one(".landing-word");
      const scrubbed: HTMLElement[] = [];
      const hint = (on: boolean, els: Element[]) => els.forEach((el) => { (el as HTMLElement).style.willChange = on ? "transform" : ""; });
      if (hero && frame && layer && word) {
        // The word rises 12 px once; yPercent keeps it apart from the parallax y below.
        gsap.from(word, { yPercent: () => 12 / Math.max(1, word.offsetHeight) * 100, duration: .45, ease: "power2.out" });
        // M1: footage 0.3x and word 0.5x (halved on phones). The footage travel is capped by its 15% overscan so no edge shows.
        const els = [layer, word]; scrubbed.push(...els);
        gsap.timeline({ scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6, invalidateOnRefresh: true, onToggle: (self) => hint(self.isActive, els) } })
          .fromTo(layer, { y: 0 }, { y: () => Math.min(0.3 * k * hero.offsetHeight, 0.15 * frame.offsetHeight), ease: "none" }, 0)
          .fromTo(word, { y: 0 }, { y: () => 0.5 * k * hero.offsetHeight, ease: "none" }, 0);
      }
      // M2: cards are visible from first paint; they rise 24 px once, never on tab changes. y only (UI/UX 2026-11-15): a scale re-rasters each card.
      const reveal = context.add("reveal", (batch: Element[]) => gsap.from(batch, { y: 24, duration: .45, ease: "power2.out", stagger: .06, overwrite: true, onStart: () => hint(true, batch), onComplete: () => hint(false, batch) })) as (batch: Element[]) => void;
      const cards = root.querySelectorAll(".landing-reveal");
      // Parse the transforms once here, so starting a batch mid-scroll never forces a style and layout read.
      gsap.set(cards, { y: 0 });
      ScrollTrigger.batch(cards, { start: "top 88%", once: true, onEnter: (batch) => reveal(batch) });
      // M3: CSS-sticky stage (no GSAP pin). Doors part, the image settles, the heading lines rise; text is never hidden.
      const band = one(".landing-band");
      if (band) {
        const doors = band.querySelectorAll(".landing-door"), image = band.querySelector("img"), lines = band.querySelectorAll(".landing-band-line");
        const els = [...doors, ...(image ? [image] : []), ...lines]; scrubbed.push(...(els as HTMLElement[]));
        const timeline = gsap.timeline({ scrollTrigger: { trigger: band, start: "top top", end: "bottom bottom", scrub: 0.6, onToggle: (self) => hint(self.isActive, els) } });
        // CSS parks the doors off-stage for no-JS; x: 0 drops that parsed offset so only xPercent moves them.
        timeline.fromTo(doors[0], { x: 0, xPercent: 0 }, { xPercent: -101, ease: "none" }, 0).fromTo(doors[1], { x: 0, xPercent: 0 }, { xPercent: 101, ease: "none" }, 0);
        if (image) timeline.fromTo(image, { scale: 1.12 }, { scale: 1, ease: "none" }, 0);
        timeline.fromTo(lines, { y: 40 }, { y: 0, stagger: .15, ease: "none" }, 0);
      }
      root.querySelectorAll(".landing-section h2").forEach((heading) => gsap.from(heading, { y: 12, duration: .45, ease: "power2.out", scrollTrigger: { trigger: heading, start: "top 90%", once: true } }));
      return () => hint(false, [...scrubbed, ...cards]);
    });
    // One refresh once fonts and the hero poster have settled the layout.
    let live = true, settle = () => {};
    const poster = one(".landing-media img") as HTMLImageElement | null;
    const loaded = new Promise<void>((done) => { settle = done; if (!poster || poster.complete) done(); else { poster.addEventListener("load", settle); poster.addEventListener("error", settle); } });
    Promise.all([document.fonts.ready, loaded]).then(() => { if (live) ScrollTrigger.refresh(); });
    // Tab enhancement after hydration, tab changes and the estimate result change the page height; re-measure the triggers.
    const main = root.querySelector("main"), watch = new ResizeObserver(() => ScrollTrigger.refresh());
    if (main) watch.observe(main);
    return () => { live = false; watch.disconnect(); poster?.removeEventListener("load", settle); poster?.removeEventListener("error", settle); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
