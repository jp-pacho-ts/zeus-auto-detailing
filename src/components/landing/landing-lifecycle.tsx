"use client";
import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(useGSAP, ScrollTrigger);

export function LandingLifecycle() {
  const marker = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const root = marker.current?.closest<HTMLElement>("[data-landing-preview]");
    if (!root) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      // Only transforms. SSR text and actions remain visible even if GSAP or a trigger fails.
      gsap.from(root.querySelectorAll(".landing-hero-copy > :not(.landing-actions)"), { y: 12, duration: .45, stagger: .06, ease: "power2.out" });
      root.querySelectorAll(".landing-section h2").forEach((heading) => gsap.from(heading, { y: 12, duration: .45, ease: "power2.out", scrollTrigger: { trigger: heading, start: "top 90%", once: true } }));
    });
    // This event only kills existing tweens; it creates no animation outside the context.
    const reset = () => gsap.killTweensOf(root.querySelectorAll(".landing-hero-copy > :not(.landing-actions), .landing-section h2"));
    window.addEventListener("resize", reset);
    return () => { window.removeEventListener("resize", reset); media.revert(); };
  }, { scope: marker });
  return <span ref={marker} hidden />;
}
