"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { attachHeroVideo } from "@/components/home/hero-video-controller";
import { HERO_POSTER_FILES, HERO_PHONE_MAX_WIDTH } from "@/components/home/hero-video";

const query = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => { const media = matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };

// LE correction: original shop footage loops. Shared home playback policy stays unchanged.
export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const manualPause = useRef(false);
  const notifyVisibility = useRef<(() => void) | null>(null);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const motionAllowed = useSyncExternalStore(subscribe, () => !matchMedia(query).matches, () => false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let visible = false;
    const events = new EventTarget();
    const notify = () => { events.dispatchEvent(new Event("visibilitychange")); };
    notifyVisibility.current = notify;
    // The tested shared controller treats offscreen/manual pause like a hidden page.
    const page = {
      get hidden() { return document.hidden || !visible || manualPause.current; },
      get readyState() { return document.readyState; },
      addEventListener: (type: string, fn: () => void) => events.addEventListener(type, fn),
      removeEventListener: (type: string, fn: () => void) => events.removeEventListener(type, fn),
    };
    const detach = attachHeroVideo(element, {
      width: () => innerWidth, document: page, window,
      motion: matchMedia(query),
      connection: (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection,
      schedule: (callback) => { const timer = setTimeout(callback, 0); return () => clearTimeout(timer); },
    });
    const playing = () => setStarted(true);
    const failed = () => setStarted(false);
    element.addEventListener("playing", playing);
    element.addEventListener("error", failed);
    document.addEventListener("visibilitychange", notify);
    const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; notify(); });
    seen.observe(element.closest(".landing-hero-art") ?? element);
    return () => { seen.disconnect(); detach(); notifyVisibility.current = null; document.removeEventListener("visibilitychange", notify); element.removeEventListener("playing", playing); element.removeEventListener("error", failed); };
  }, []);
  return <>
    <div className="landing-hero-car"><div className="landing-video-frame">
      <picture><source media={`(max-width: ${HERO_PHONE_MAX_WIDTH}px)`} srcSet={HERO_POSTER_FILES.phone} /><img src={HERO_POSTER_FILES.desktop} alt="White car in the Zeus workshop beneath geometric detailing lights" width="1920" height="1080" fetchPriority="high" /></picture>
      <video ref={video} className="landing-loop-video" muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
    </div></div>
    {started && motionAllowed && <button type="button" className="landing-video-control" aria-pressed={paused} onClick={() => { manualPause.current = !manualPause.current; setPaused(manualPause.current); notifyVisibility.current?.(); }}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}<span>{paused ? "Play video" : "Pause video"}</span></button>}
  </>;
}
