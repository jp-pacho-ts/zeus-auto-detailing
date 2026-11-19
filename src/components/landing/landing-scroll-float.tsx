"use client";
// Adapted from React Bits ScrollFloat by David Haz; see react-bits-magnet.LICENSE.
// Word-only float, scoped desktop motion and visible SSR fallback for the Zeus surface.
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);
export function LandingScrollFloat({ id, text }: { id: string; text: string }) {
  const root = useRef<HTMLHeadingElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root.current!.querySelectorAll(".landing-float-word"),
        { yPercent: 110, rotationX: -65, scaleY: 1.5, opacity: .2, transformOrigin: "50% 100%" },
        { yPercent: 0, rotationX: 0, scaleY: 1, opacity: 1, stagger: .09, ease: "power3.out", scrollTrigger: { trigger: root.current, start: "top 95%", end: "top 56%", scrub: .7 } });
    });
    return () => media.revert();
  }, { scope: root });
  return <h2 id={id} ref={root} className="landing-scroll-float"><span className="landing-sr">{text}</span><span aria-hidden="true">{text.split(" ").map((word, i) => <span className="landing-float-mask" key={i}><span className="landing-float-word">{word}&nbsp;</span></span>)}</span></h2>;
}
