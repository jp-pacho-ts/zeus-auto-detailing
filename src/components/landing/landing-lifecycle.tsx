"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// One motion owner. Only images and framing move; text, prices and actions stay put.
export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  const rowPlayed = useRef(false);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const one = (selector: string) => root.querySelector<HTMLElement>(selector);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const media = gsap.matchMedia();
    media.add({ motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 1200px)", phone: "(max-width: 767px)", short: "(max-height: 700px)" }, (context) => {
      const { motion, desktop, phone, short } = context.conditions as { motion: boolean; desktop: boolean; phone: boolean; short: boolean };
      if (!motion) return;
      const owned: { scene: Element; animation: gsap.core.Animation; elements: Element[] }[] = [];
      const hint = (active: boolean, elements: Element[]) => elements.forEach((el) => { (el as HTMLElement).style.willChange = active ? "transform" : ""; });
      const scene = (element: HTMLElement, elements: Element[], start: string, end: string, scrub = .3) => {
        const timeline = gsap.timeline({ scrollTrigger: { trigger: element, start, end, scrub, invalidateOnRefresh: true, onToggle: (self) => hint(self.isActive, elements) } });
        owned.push({ scene: element, animation: timeline, elements });
        return timeline;
      };
      const hero = one(".landing-hero"), frame = one(".landing-media-frame"), layer = one(".landing-media-layer");
      // M1 is off on phones and stacked tablets. Fixed scrim and copy never move.
      if (desktop && hero && frame && layer) {
        // Keep the optional outlined word static: hero + two process images stay within the three-layer cap.
        scene(hero, [layer], "top top", "bottom top", .35)
          .fromTo(layer, { y: 0 }, { y: () => frame.offsetHeight * .06, duration: 1, ease: "none" }, 0);
      }
      const process = one(".landing-process"), wide = one(".landing-process-wide img"), close = one(".landing-process-close img");
      if (desktop && process && wide && close) {
        scene(process, [wide, close], "top 85%", "bottom 35%")
          .fromTo(wide, { x: -16 }, { x: 0, duration: .7, ease: "none" }, 0)
          .fromTo(close, { x: 16 }, { x: 0, duration: .5, ease: "none" }, .2);
      }
      // Only the first initial row receives a crop settle; category/vehicle changes never replay it.
      const grid = root.querySelector<HTMLElement>(".landing-panel .landing-grid");
      if (!phone && grid && !rowPlayed.current) {
        const photos = [...grid.children].slice(0, desktop ? 3 : 2).flatMap((card) => [...card.querySelectorAll(".landing-photo img")]);
        if (photos.length) {
          const reveal = context.add("firstRow", () => {
            if (rowPlayed.current) return;
            rowPlayed.current = true;
            const animation = gsap.fromTo(photos, { y: -12 }, { y: 0, duration: .45, stagger: .06, ease: "power2.out", onStart: () => hint(true, photos), onComplete: () => hint(false, photos) });
            owned.push({ scene: grid, animation, elements: photos });
          }) as () => void;
          ScrollTrigger.create({ trigger: grid, start: "top 80%", once: true, onEnter: reveal });
        }
      }
      const coatings = one(".landing-coatings-editorial"), coating = one(".landing-coating-photo img"), edge = one(".landing-coating-edge");
      if (desktop && coatings && coating && edge) {
        scene(coatings, [coating, edge], "top 85%", "top 20%")
          .fromTo(coating, { scale: 1.04 }, { scale: 1, duration: 1, ease: "none" }, 0)
          .fromTo(edge, { x: -16 }, { x: 0, duration: .25, ease: "none" }, 0);
      }
      const band = one(".landing-band");
      if (band && !short) {
        const doors = [...band.querySelectorAll<HTMLElement>(".landing-door")], image = band.querySelector("img");
        const elements = [...doors, ...(!phone && image ? [image] : [])];
        if (doors.length === 2) {
          const timeline = scene(band, elements, "top top", "bottom bottom", .35);
          // Each door covers <=20% of the frame at entry: the central aperture already exposes >=60%.
          timeline.fromTo(doors[0], { x: 0, xPercent: phone ? -85 : -61 }, { xPercent: -101, duration: .45, ease: "none" }, 0)
            .fromTo(doors[1], { x: 0, xPercent: phone ? 85 : 61 }, { xPercent: 101, duration: .45, ease: "none" }, 0);
          if (!phone && image) timeline.fromTo(image, { scale: 1.04 }, { scale: 1, duration: .55, ease: "none" }, .1);
          // Hold the completed image for the final 35%; copy never participates in this timeline.
          timeline.to({}, { duration: .35 }, .65);
        }
      }
      const focus = (event: FocusEvent) => {
        if (!(event.target instanceof Node)) return;
        for (const item of owned) if (item.scene.contains(event.target)) {
          item.animation.scrollTrigger?.disable(false);
          item.animation.progress(1).pause(); hint(false, item.elements);
        }
      };
      root.addEventListener("focusin", focus);
      return () => { root.removeEventListener("focusin", focus); for (const item of owned) hint(false, item.elements); };
    });
    // Refresh after reserved media/font layout settles, and after real content-height changes only.
    let live = true, settle = () => {};
    const poster = one(".landing-media img") as HTMLImageElement | null;
    const loaded = new Promise<void>((done) => { settle = done; if (!poster || poster.complete) done(); else { poster.addEventListener("load", settle); poster.addEventListener("error", settle); } });
    Promise.all([document.fonts.ready, loaded]).then(() => { if (live) ScrollTrigger.refresh(); });
    const main = root.querySelector("main"), watch = new ResizeObserver(() => ScrollTrigger.refresh());
    if (main) watch.observe(main);
    return () => { live = false; watch.disconnect(); poster?.removeEventListener("load", settle); poster?.removeEventListener("error", settle); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
