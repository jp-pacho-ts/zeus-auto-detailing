"use client";
import { useEffect, useRef } from "react";
import { attachHeroVideo } from "@/components/home/hero-video-controller";
import { HERO_POSTER_FILES, HERO_PHONE_MAX_WIDTH } from "@/components/home/hero-video";

const LANDING_VIDEO_FILES = {
  desktop: "/media/landing-hero/zeus-cut-1080.mp4",
  phone: "/media/landing-hero/zeus-cut-720.mp4",
};

// LE correction: original shop footage loops. Shared home playback policy stays unchanged.
export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let visible = false;
    const events = new EventTarget();
    const notify = () => { events.dispatchEvent(new Event("visibilitychange")); };
    // The tested shared controller treats offscreen playback like a hidden page.
    const page = {
      get hidden() { return document.hidden || !visible; },
      get readyState() { return document.readyState; },
      addEventListener: (type: string, fn: () => void) => events.addEventListener(type, fn),
      removeEventListener: (type: string, fn: () => void) => events.removeEventListener(type, fn),
    };
    const detach = attachHeroVideo(element, {
      width: () => innerWidth, document: page, window,
      files: LANDING_VIDEO_FILES,
      motion: matchMedia("(prefers-reduced-motion: reduce)"),
      connection: (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection,
      schedule: (callback) => { const timer = setTimeout(callback, 0); return () => clearTimeout(timer); },
    });
    document.addEventListener("visibilitychange", notify);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; notify(); });
    seen.observe(element.closest(".landing-hero-art") ?? element);
    return () => { seen.disconnect(); detach(); document.removeEventListener("visibilitychange", notify); };
  }, []);
  return <div className="landing-video-frame">
    <picture><source media={`(max-width: ${HERO_PHONE_MAX_WIDTH}px)`} srcSet={HERO_POSTER_FILES.phone} /><img src={HERO_POSTER_FILES.desktop} alt="White car in the Zeus workshop beneath geometric detailing lights" width="1920" height="1080" fetchPriority="high" /></picture>
    <video ref={video} className="landing-loop-video" muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
  </div>;
}
