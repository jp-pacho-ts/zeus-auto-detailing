"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { mountTextChoreography } from "./landing-text-choreography";
import { mountCareScene } from "./landing-work-scene";
import { HOME_INTRO_PENDING_STYLE_ID } from "@/components/home/home-intro-prepaint";
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
      // A fresh tab's intro (landing-intro-motion) opens the hero itself as its curtain leaves.
      if (!hero || !frame || hero.getBoundingClientRect().bottom < innerHeight / 2 || document.getElementById(HOME_INTRO_PENDING_STYLE_ID)) return;
      const opening = gsap.timeline({ defaults: { ease: "power4.out" } });
      opening.fromTo(frame, { scale: 1.07 }, { scale: 1, duration: .98 }, 0)
        .fromTo(hero.querySelectorAll(".landing-hero-line > span"), { yPercent: 84 }, { yPercent: 0, duration: .61, stagger: .08 }, .16);
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
    // LE 2026-11-20: the service panels open like the intro: each shot wipes up out of black in black and white,
    // then data-film="on" hands over to landing.css, which brings the colour back and lets the open panel's copy and
    // gold rule arrive. GSAP moves only the photo frame, so it never fights the CSS panel states.
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const cards = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".landing-care-card"));
      if (!cards.length) return;
      const frame = (card: HTMLElement) => card.querySelector(".landing-care-photo");
      const play = (batch: HTMLElement[], instant = false) => batch.forEach((card, i) => {
        if (card.dataset.film !== "wait") return;
        if (instant) { gsap.killTweensOf(frame(card)); gsap.set(frame(card), { clearProps: "all" }); card.dataset.film = "on"; return; }
        gsap.timeline({ delay: i * .16, onComplete: () => { gsap.set(frame(card), { clearProps: "all" }); } })
          .to(frame(card), { clipPath: "inset(0% 0 0 0)", duration: 1.2, ease: "power4.inOut" }, 0)
          .to(frame(card), { scale: 1, duration: 1.9, ease: "power3.out" }, 0)
          .call(() => { card.dataset.film = "on"; }, [], .6);
      });
      cards.forEach((card) => { card.dataset.film = "wait"; gsap.set(frame(card), { clipPath: "inset(100% 0 0 0)", scale: 1.22 }); });
      const triggers = ScrollTrigger.batch(cards, { start: "top 85%", once: true, onEnter: (batch) => play(batch as HTMLElement[]) });
      // Keyboard users never wait for an entrance.
      const reveal = (event: FocusEvent) => { const card = (event.target as Element).closest<HTMLElement>(".landing-care-card"); if (card) play([card], true); };
      root.addEventListener("focusin", reveal);
      return () => { root.removeEventListener("focusin", reveal); triggers.forEach((t) => t.kill()); cards.forEach((card) => { delete card.dataset.film; }); };
    });
    // Desktop scenes use native scroll geometry. Phones get the bounded title reveal.
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis({ duration: .85, smoothWheel: true, syncTouch: false, autoRaf: false, prevent: (node) => !!node.closest(".landing-menu, select") });
      const tick = (seconds: number) => lenis.raf(seconds * 1000);
      lenis.on("scroll", ScrollTrigger.update); gsap.ticker.add(tick);
      const hero = root.querySelector(".landing-hero");
      const footage = hero?.querySelector(".landing-hero-photo");
      if (footage) gsap.to(footage, {
        yPercent: 7, scale: 1.07, ease: "none",
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
