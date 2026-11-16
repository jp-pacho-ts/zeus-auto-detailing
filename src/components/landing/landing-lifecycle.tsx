"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { bandScrolls } from "./landing-model";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// One motion owner (P1-90 identity 9). Only image layers, masks and the decorative word move; text, prices and controls stay put.
// Phones (767 px and below) get no scroll-linked motion: the method-b gate failed with motion there (P1-89).
export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const one = (selector: string) => root.querySelector<HTMLElement>(selector);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const media = gsap.matchMedia();
    media.add({ motion: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 768px)", stage: "(min-width: 1024px) and (min-height: 700px)", phone: "(max-width: 767px)", short: "(max-height: 700px)" }, (context) => {
      const { motion, wide, stage, phone, short } = context.conditions as Record<"motion" | "wide" | "stage" | "phone" | "short", boolean>;
      if (!motion) return;
      const owned: { scene: Element; animation: gsap.core.Animation; elements: Element[] }[] = [];
      const hint = (active: boolean, elements: Element[]) => elements.forEach((el) => { (el as HTMLElement).style.willChange = active ? "transform, clip-path" : ""; });
      const scene = (element: HTMLElement, elements: Element[], start: string, end: string, scrub = .4) => {
        const timeline = gsap.timeline({ scrollTrigger: { trigger: element, start, end, scrub, invalidateOnRefresh: true, onToggle: (self) => hint(self.isActive, elements) } });
        owned.push({ scene: element, animation: timeline, elements });
        return timeline;
      };
      // H1: the footage settles and the outlined word drifts up as the hero leaves.
      const hero = one(".landing-hero"), layer = one(".landing-media-layer"), word = one(".landing-word");
      if (wide && hero && layer && word) {
        scene(hero, [layer, word], "top top", "bottom top")
          .fromTo(layer, { scale: 1.08 }, { scale: 1, ease: "none" }, 0)
          .fromTo(word, { yPercent: 0 }, { yPercent: -35, ease: "none" }, 0);
      }
      // P1: each work photo opens from an inset mask while its image counter-moves; the step whose photo crosses 55% lights up.
      const work = one(".landing-stage");
      if (stage && work) {
        const steps = [...work.querySelectorAll<HTMLElement>(".landing-step")];
        const light = (step: string) => steps.forEach((el) => el.classList.toggle("is-on", el.dataset.step === step));
        work.classList.add("is-live"); light(steps[0]?.dataset.step ?? "");
        for (const photo of work.querySelectorAll<HTMLElement>(".landing-stage-photo")) {
          const image = photo.querySelector("img");
          scene(photo, [photo], "top 95%", "center 55%").fromTo(photo, { clipPath: "inset(12% 8% 12% 8% round 28px)" }, { clipPath: "inset(0% 0% 0% 0% round 20px)", ease: "none" });
          if (image) scene(photo, [image], "top bottom", "bottom top").fromTo(image, { yPercent: -10 }, { yPercent: 0, ease: "none" });
          ScrollTrigger.create({ trigger: photo, start: "top 55%", end: "bottom 55%", onToggle: (self) => { if (self.isActive) light(photo.dataset.step ?? ""); } });
        }
        context.add(() => () => { work.classList.remove("is-live"); steps.forEach((el) => el.classList.remove("is-on")); });
      }
      // C1: the framed coating photo opens to full bleed as it enters, and its image settles.
      const bleed = one(".landing-bleed"), bleedMedia = one(".landing-bleed-media"), bleedImage = one(".landing-bleed-media img");
      if (stage && bleed && bleedMedia && bleedImage) {
        const edge = () => `inset(6% ${Math.max(32, (innerWidth - 1200) / 2)}px 6% ${Math.max(32, (innerWidth - 1200) / 2)}px round 24px)`;
        scene(bleed, [bleedMedia, bleedImage], "top 90%", "top 10%")
          .fromTo(bleedMedia, { clipPath: edge }, { clipPath: "inset(0% 0px 0% 0px round 0px)", ease: "none" }, 0)
          .fromTo(bleedImage, { scale: 1.12 }, { scale: 1, ease: "none" }, 0);
      }
      // G1: the smaller gallery frame drifts into line.
      const small = one(".landing-gallery-small");
      if (stage && small) scene(small, [small], "top 80%", "top 30%").fromTo(small, { y: 24 }, { y: 0, ease: "none" });
      // M3: the closing band's doors part and its image settles (unchanged from P1-89).
      const band = one(".landing-band");
      if (band && bandScrolls({ phone, short })) {
        const doors = [...band.querySelectorAll<HTMLElement>(".landing-door")], image = band.querySelector("img");
        const elements = [...doors, ...(image ? [image] : [])];
        if (doors.length === 2) {
          const timeline = scene(band, elements, "top top", "bottom bottom", .35);
          // Each door covers <=20% of the frame at entry: the central aperture already exposes >=60%.
          timeline.fromTo(doors[0], { x: 0, xPercent: -61 }, { xPercent: -101, duration: .45, ease: "none" }, 0)
            .fromTo(doors[1], { x: 0, xPercent: 61 }, { xPercent: 101, duration: .45, ease: "none" }, 0);
          if (image) timeline.fromTo(image, { scale: 1.04 }, { scale: 1, duration: .55, ease: "none" }, .1);
          // Hold the completed image for the final 35%; copy never participates in this timeline.
          timeline.to({}, { duration: .35 }, .65);
        }
      }
      const focus = (event: FocusEvent) => {
        if (!(event.target instanceof Node)) return;
        for (const item of owned) if (item.scene.contains(event.target) || item.scene.parentElement?.contains(event.target)) {
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
