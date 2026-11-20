"use client";
// Adapted from React Bits ScrollFloat by David Haz; see react-bits-magnet.LICENSE.
// Word-only float, scoped desktop motion and visible SSR fallback for the Zeus surface.
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

gsap.registerPlugin(useGSAP);
export function LandingScrollFloat({ id, text }: { id: string; text: string }) {
  const root = useRef<HTMLHeadingElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      const heading = root.current!;
      const words = heading.querySelectorAll(".landing-float-word");
      // LE 2026-11-20: plays once when the heading is really on screen. The old scroll-scrubbed version measured
      // positions up front; when the layout shifted after load those went stale and the words stayed hidden in view.
      const float = gsap.fromTo(words,
        { yPercent: 110, rotationX: -65, scaleY: 1.5, opacity: .2, transformOrigin: "50% 100%" },
        { yPercent: 0, rotationX: 0, scaleY: 1, opacity: 1, stagger: .09, duration: 1.1, ease: "power3.out", paused: true });
      const seen = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        seen.disconnect();
        float.play();
      }, { threshold: .35 });
      seen.observe(heading);
      return () => { seen.disconnect(); float.revert(); };
    });
    return () => media.revert();
  }, { scope: root });
  return <h2 id={id} ref={root} className="landing-scroll-float"><span className="landing-sr">{text}</span><span aria-hidden="true">{text.split(" ").map((word, i) =>
    // A closing period is the brand's gold dot, as on the other section titles.
    <span className="landing-float-mask" key={i}><span className="landing-float-word">{word.endsWith(".") ? <>{word.slice(0, -1)}<span className="landing-gold-dot">.</span></> : word}&nbsp;</span></span>)}</span></h2>;
}
