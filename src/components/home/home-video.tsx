"use client";

import { useEffect, useRef } from "react";
import { HERO_PHONE_MAX_WIDTH, HERO_POSTER_FILES, chooseHeroVideo } from "./hero-video";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/**
 * Full-screen background. The server HTML holds the poster and an empty <video> (no src, preload none), so nothing
 * but the poster is fetched before first paint. After the window load event the file for this screen is chosen and
 * played; reduced motion, data-saver and 2G keep the poster only. The poster and the video share one box, so there is
 * no layout jump when the video fades in.
 */
export function HomeVideo() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let loaded = false;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    const showPoster = () => { delete element.dataset.ready; };
    const playing = () => { element.dataset.ready = "true"; };
    const stop = () => {
      element.pause();
      showPoster();
    };
    const start = () => {
      if (disposed || document.hidden) return;
      const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
      const file = chooseHeroVideo({
        width: window.innerWidth,
        reducedMotion: motion.matches,
        saveData: connection?.saveData === true,
        effectiveType: connection?.effectiveType,
      });
      if (!file) return;
      if (!element.getAttribute("src")) element.src = file;
      // A refused or failed play leaves the poster in place; there is nothing to retry.
      element.play().catch(showPoster);
    };
    const schedule = () => {
      loaded = true;
      if (typeof requestIdleCallback === "function") idle = requestIdleCallback(start, { timeout: 1500 });
      else timer = setTimeout(start, 250);
    };
    const onMotion = () => (motion.matches ? stop() : loaded && start());
    const onVisibility = () => (document.hidden ? element.pause() : loaded && !motion.matches && element.getAttribute("src") && start());
    element.addEventListener("playing", playing);
    element.addEventListener("error", showPoster);
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (idle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      window.removeEventListener("load", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      element.removeEventListener("playing", playing);
      element.removeEventListener("error", showPoster);
      element.pause();
    };
  }, []);
  return <div className="zeus-hero-media" aria-hidden="true">
    {/* A plain picture, not next/image: the files are already encoded, and the optimizer would re-encode and re-route them. */}
    <picture>
      <source media={`(max-width: ${HERO_PHONE_MAX_WIDTH}px)`} srcSet={HERO_POSTER_FILES.phone} />
      <img className="zeus-hero-poster" src={HERO_POSTER_FILES.desktop} alt="" width={1920} height={1080} decoding="async" fetchPriority="high" />
    </picture>
    <video ref={video} className="zeus-hero-video" muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
  </div>;
}
