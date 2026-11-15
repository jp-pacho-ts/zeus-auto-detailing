"use client";
import { useEffect, useRef, useState } from "react";
import { chooseHeroVideo, HERO_POSTER_FILES } from "@/components/home/hero-video";

// Landing-only controller. The shared ComingSoon media and its lifecycle stay untouched.
export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const userPaused = useRef(false);
  const offscreen = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    let disposed = false;
    const update = () => {
      const file = chooseHeroVideo({ width: innerWidth, reducedMotion: motion.matches, saveData: !!connection?.saveData, effectiveType: connection?.effectiveType });
      setAllowed(!!file);
      if (!file || document.hidden || userPaused.current || offscreen.current) { element.pause(); return; }
      if (document.readyState !== "complete") return;
      if (!element.getAttribute("src")) element.src = file;
      element.play().catch(() => { if (!disposed) setPlaying(false); });
    };
    const onPlay = () => setPlaying(true), onPause = () => setPlaying(false);
    element.addEventListener("playing", onPlay); element.addEventListener("pause", onPause); element.addEventListener("error", onPause);
    window.addEventListener("load", update); document.addEventListener("visibilitychange", update); motion.addEventListener("change", update);
    // 17.11.4: pause while the hero is fully off-screen; resume on return only if the user did not pause.
    const hero = element.closest("section");
    const seen = new IntersectionObserver(([entry]) => { offscreen.current = !entry.isIntersecting; update(); });
    if (hero) seen.observe(hero);
    update();
    return () => { disposed = true; seen.disconnect(); window.removeEventListener("load", update); document.removeEventListener("visibilitychange", update); motion.removeEventListener("change", update); element.removeEventListener("playing", onPlay); element.removeEventListener("pause", onPause); element.removeEventListener("error", onPause); element.pause(); };
  }, []);
  return <div className="landing-media">
    {/* The frame clips a 115% layer so the M1 parallax never shows an edge; its top fades into the page (17.3). */}
    <div className="landing-media-frame"><div className="landing-media-layer">
      {/* Already-public, encoded shop footage; the poster always remains underneath. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={HERO_POSTER_FILES.desktop} alt="" width="1920" height="1080" fetchPriority="high" />
      <video ref={video} muted loop playsInline preload="none" aria-hidden="true" style={{ opacity: playing ? 1 : 0 }} />
    </div></div>
    <button className="landing-pill landing-outline landing-video-toggle" type="button" disabled={!allowed} onClick={() => {
      const element = video.current; if (!element) return;
      if (playing) { userPaused.current = true; element.pause(); }
      else { userPaused.current = false; element.play().catch(() => setPlaying(false)); }
    }}>{playing ? "Pause video" : "Play video"}</button>
  </div>;
}
