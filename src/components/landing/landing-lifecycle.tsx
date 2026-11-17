"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// One owner for preview-only motion; phone and reduced-motion users keep native scrolling.
export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis({ duration: .85, smoothWheel: true, syncTouch: false, autoRaf: false, prevent: (node) => !!node.closest(".landing-review-track, .landing-mobile-menu, select") });
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      const hero = root.querySelector(".landing-hero-art");
      if (hero) {
        gsap.to(root.querySelector(".landing-word"), { yPercent: -12, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: .5 } });
        gsap.to(root.querySelector(".landing-hero-photo"), { yPercent: 5, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: .5 } });
      }
      for (const frame of root.querySelectorAll(".landing-editorial-photo, .landing-step-photo, .landing-gallery-grid figure, .landing-bleed-media")) {
        const image = frame.querySelector("img");
        if (image) gsap.fromTo(image, { scale: 1.04 }, { scale: 1, duration: 1.1, ease: "power2.out", scrollTrigger: { trigger: frame, start: "top 92%", once: true } });
      }
      gsap.from(root.querySelectorAll(".landing-care-card"), { y: 18, stagger: .08, duration: .65, ease: "power2.out", scrollTrigger: { trigger: root.querySelector(".landing-care-grid"), start: "top 90%", once: true } });
      const progress = root.querySelector(".landing-progress");
      if (progress) gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: true } });
      // Keyboard focus, hash navigation and menu actions must settle immediately.
      const settle = () => { lenis.scrollTo(window.scrollY, { immediate: true, force: true }); };
      root.addEventListener("focusin", settle);
      window.addEventListener("hashchange", settle);
      return () => { root.removeEventListener("focusin", settle); window.removeEventListener("hashchange", settle); gsap.ticker.remove(tick); lenis.destroy(); };
    });
    let live = true;
    document.fonts.ready.then(() => { if (live) ScrollTrigger.refresh(); });
    let scheduled = 0;
    const watch = new ResizeObserver(() => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => ScrollTrigger.refresh()); });
    const main = root.querySelector("main");
    if (main) watch.observe(main);
    return () => { live = false; cancelAnimationFrame(scheduled); watch.disconnect(); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
