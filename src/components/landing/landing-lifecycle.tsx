"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { mountTextChoreography } from "./landing-text-choreography";
import { mountCareScene } from "./landing-work-scene";
import "lenis/dist/lenis.css";
gsap.registerPlugin(useGSAP, ScrollTrigger);

export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const media = gsap.matchMedia();
    // The poster and booking links are usable before the entrance runs.
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const hero = root.querySelector(".landing-hero");
      const frame = hero?.querySelector(".landing-video-frame");
      if (!hero || !frame || hero.getBoundingClientRect().bottom < innerHeight / 2) return;
      const opening = gsap.timeline({ defaults: { ease: "power4.out" } });
      opening.fromTo(frame, { scale: 1.1 }, { scale: 1, duration: 1.3 }, 0)
        .fromTo(hero.querySelectorAll(".landing-hero-line > span"), { yPercent: 106 }, { yPercent: 0, duration: .85, stagger: .13 }, .08);
      const reveal = () => { opening.progress(1); };
      hero.addEventListener("focusin", reveal);
      return () => hero.removeEventListener("focusin", reveal);
    });
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const frame = root.querySelector(".landing-about-frame");
      const photo = frame?.querySelector("img");
      if (!photo) return;

      // Keep the frame and its gradient fixed while the photograph pulls back.
      gsap.fromTo(photo, { scale: 1.13, yPercent: 3 }, {
        scale: 1,
        yPercent: 0,
        ease: "none",
        scrollTrigger: { trigger: frame, start: "top 94%", end: "top 30%", scrub: .45 },
      });
    });
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const frame = root.querySelector(".landing-concerns-frame");
      const photo = frame?.querySelector("img");
      if (!frame || !photo) return;

      gsap.fromTo(photo, { scale: 1.16 }, {
        scale: 1,
        ease: "none",
        scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom 55%", scrub: .45 },
      });
    });
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const copy = root.querySelector(".landing-bleed-copy");
      const caption = copy?.querySelector("p");
      if (!copy || !caption) return;

      const title = gsap.timeline({
        defaults: { ease: "power4.out" },
        scrollTrigger: { trigger: copy, start: "top 91%", once: true },
      });
      title.fromTo(copy.querySelectorAll(".landing-bleed-text"), { yPercent: 112 }, { yPercent: 0, duration: .72, stagger: .12 }, 0)
        .fromTo(caption, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: .5 }, .33);

      const compare = root.querySelector(".landing-compare-head");
      if (compare) gsap.fromTo(compare, { y: 24, opacity: .5 }, {
        y: 0, opacity: 1, duration: .55, ease: "power3.out",
        scrollTrigger: { trigger: compare.parentElement, start: "top 84%", once: true },
      });

      const section = copy.closest("section");
      const reveal = () => { title.progress(1); };
      section?.addEventListener("focusin", reveal);
      return () => section?.removeEventListener("focusin", reveal);
    });
    // Desktop scenes use native scroll geometry. Phones get the bounded title reveal.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis({ duration: .85, smoothWheel: true, syncTouch: false, autoRaf: false, prevent: (node) => !!node.closest(".landing-mobile-menu, select") });
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      lenis.on("scroll", ScrollTrigger.update); gsap.ticker.add(tick);
      const hero = root.querySelector(".landing-hero");
      const footage = hero?.querySelector(".landing-hero-photo");
      if (footage) gsap.to(footage, {
        yPercent: 12, scale: 1.14, ease: "none",
        scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: .45 },
      });
      const cue = hero?.querySelector<HTMLAnchorElement>(".landing-scroll-cue");
      const about = root.querySelector<HTMLElement>("#about");
      const discover = (event: MouseEvent) => {
        if (!about || !cue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        lenis.scrollTo(about, { duration: .95, onComplete: () => {
          if (location.hash !== cue.hash) history.pushState(null, "", cue.hash);
          about.focus({ preventScroll: true });
        } });
      };
      cue?.addEventListener("click", discover);
      root.querySelectorAll(".landing-care-card").forEach((card) => {
        const photo = card.querySelector(".landing-care-photo img");
        if (!photo) return;
        gsap.fromTo(photo, { scale: 1.12 }, {
          scale: 1,
          ease: "none",
          scrollTrigger: { trigger: card, start: "top 96%", end: "top 46%", scrub: .4 },
        });
      });
      const bleed = root.querySelector(".landing-bleed");
      const coatingPhoto = bleed?.querySelector("img");
      if (coatingPhoto) gsap.fromTo(coatingPhoto, { scale: 1.025 }, {
        scale: 1.16, yPercent: -3, ease: "none",
        scrollTrigger: { trigger: bleed, start: "top bottom", end: "bottom 30%", scrub: .45 },
      });
      root.querySelectorAll(".landing-gallery-grid figure").forEach((frame, i) => gsap.fromTo(frame, { y: i ? 100 : 0 }, { y: i ? -50 : 30, ease: "none", scrollTrigger: { trigger: frame.parentElement, start: "top bottom", end: "bottom top", scrub: .7 } }));
      const close = root.querySelector(".landing-band-media img");
      if (close) gsap.fromTo(close, { scale: 1.11 }, { scale: 1, ease: "none", scrollTrigger: { trigger: close.closest(".landing-band"), start: "top bottom", end: "bottom bottom", scrub: .45 } });
      const progress = root.querySelector(".landing-progress");
      if (progress) gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: true } });
      const settle = () => lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      root.addEventListener("focusin", settle); window.addEventListener("hashchange", settle);
      return () => { cue?.removeEventListener("click", discover); root.removeEventListener("focusin", settle); window.removeEventListener("hashchange", settle); gsap.ticker.remove(tick); lenis.destroy(); };
    });
    media.add("(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)", () => {
      const stage = root.querySelector<HTMLElement>(".landing-stage");
      return stage ? mountCareScene(stage) : undefined;
    });
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => mountTextChoreography(root, true));
    media.add("(max-width: 767px) and (prefers-reduced-motion: no-preference)", () => mountTextChoreography(root, false));
    let live = true, scheduled = 0;
    document.fonts.ready.then(() => { if (live) ScrollTrigger.refresh(); });
    const watch = new ResizeObserver(() => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => ScrollTrigger.refresh()); });
    const main = root.querySelector("main"); if (main) watch.observe(main);
    return () => { live = false; cancelAnimationFrame(scheduled); watch.disconnect(); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
