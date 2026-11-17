"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
gsap.registerPlugin(useGSAP, ScrollTrigger);

export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const media = gsap.matchMedia();
    // Bounded opening on every screen; copy and controls never wait for it.
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const car = root.querySelector(".landing-hero-car"), image = car?.querySelector("img");
      const opening = gsap.timeline({ paused: true, defaults: { ease: "power4.out" } });
      opening.fromTo(root.querySelectorAll(".landing-letter"), { yPercent: 110, rotationX: -75, opacity: .2 }, { yPercent: 0, rotationX: 0, opacity: 1, duration: 1.15, stagger: .085 }, 0);
      if (car) opening.fromTo(car, { xPercent: 9, y: 65, rotation: -3, scale: 1.12, opacity: .2 }, { xPercent: 0, y: 0, rotation: 0, scale: 1, opacity: 1, duration: 1.65 }, .12);
      const beam = root.querySelector(".landing-hero-beam");
      if (beam) opening.fromTo(beam, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: .8, duration: .6 }, .25).to(beam, { opacity: 0, duration: .8 }, .85);
      const launch = () => { opening.play(); };
      if (!image || image.complete) launch();
      else { image.addEventListener("load", launch, { once: true }); image.addEventListener("error", launch, { once: true }); }
      const focus = () => { opening.progress(1); };
      root.querySelector(".landing-hero")?.addEventListener("focusin", focus);
      return () => { image?.removeEventListener("load", launch); image?.removeEventListener("error", launch); root.querySelector(".landing-hero")?.removeEventListener("focusin", focus); };
    });
    // Desktop scenes use native scroll geometry; touch has no scroll-linked effects.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis({ duration: 1.05, smoothWheel: true, syncTouch: false, autoRaf: false, prevent: (node) => !!node.closest(".landing-review-track, .landing-mobile-menu, select") });
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      lenis.on("scroll", ScrollTrigger.update); gsap.ticker.add(tick);
      const sequence = gsap.timeline({ scrollTrigger: { trigger: root.querySelector(".landing-hero"), start: "top top", end: "bottom top", scrub: .65 } });
      sequence.to(root.querySelector(".landing-word"), { yPercent: -48, scale: 1.18, opacity: .08, ease: "none" }, 0)
        .to(root.querySelector(".landing-hero-photo"), { xPercent: 16, yPercent: -16, rotation: -7, scale: 1.14, ease: "none" }, 0);
      const about = root.querySelector(".landing-editorial-photo");
      if (about) gsap.fromTo(about, { clipPath: "inset(10% 12% 10% 12%)", rotation: -4, x: -65 }, { clipPath: "inset(0% 0% 0% 0%)", rotation: 0, x: 0, ease: "power3.out", scrollTrigger: { trigger: about, start: "top 95%", end: "top 35%", scrub: .6 } });
      gsap.from(root.querySelectorAll(".landing-care-card"), { y: 64, rotationY: 18, transformPerspective: 1000, stagger: .13, duration: .95, ease: "power3.out", scrollTrigger: { trigger: root.querySelector(".landing-care-grid"), start: "top 90%", once: true } });
      gsap.from(root.querySelectorAll(".landing-step-photo"), { y: 100, rotation: (i) => i % 2 ? 4 : -4, scale: .9, stagger: .16, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: root.querySelector(".landing-stage-grid"), start: "top 88%", once: true } });
      const bleed = root.querySelector(".landing-bleed");
      if (bleed) gsap.fromTo(bleed.querySelector(".landing-bleed-media"), { clipPath: "inset(10% 8% 10% 8% round 20px)", scale: .92 }, { clipPath: "inset(0% 0% 0% 0% round 0px)", scale: 1, ease: "none", scrollTrigger: { trigger: bleed, start: "top 95%", end: "top 20%", scrub: .7 } });
      root.querySelectorAll(".landing-gallery-grid figure").forEach((frame, i) => gsap.fromTo(frame, { y: i ? 100 : 0 }, { y: i ? -50 : 30, ease: "none", scrollTrigger: { trigger: frame.parentElement, start: "top bottom", end: "bottom top", scrub: .7 } }));
      gsap.from(root.querySelectorAll(".landing-review-card"), { y: 90, rotation: (i) => i % 2 ? 7 : -7, stagger: .13, duration: .9, ease: "power3.out", scrollTrigger: { trigger: root.querySelector(".landing-review-track"), start: "top 92%", once: true } });
      const close = root.querySelector(".landing-band-media img");
      if (close) gsap.fromTo(close, { scale: 1.2 }, { scale: 1, ease: "none", scrollTrigger: { trigger: close.parentElement, start: "top bottom", end: "bottom bottom", scrub: .6 } });
      const progress = root.querySelector(".landing-progress");
      if (progress) gsap.fromTo(progress, { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: true } });
      const settle = () => lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      root.addEventListener("focusin", settle); window.addEventListener("hashchange", settle);
      return () => { root.removeEventListener("focusin", settle); window.removeEventListener("hashchange", settle); gsap.ticker.remove(tick); lenis.destroy(); };
    });
    let live = true, scheduled = 0;
    document.fonts.ready.then(() => { if (live) ScrollTrigger.refresh(); });
    const watch = new ResizeObserver(() => { cancelAnimationFrame(scheduled); scheduled = requestAnimationFrame(() => ScrollTrigger.refresh()); });
    const main = root.querySelector("main"); if (main) watch.observe(main);
    return () => { live = false; cancelAnimationFrame(scheduled); watch.disconnect(); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
