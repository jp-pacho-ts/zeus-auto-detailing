"use client";

import { useEffect, useRef } from "react";
import { HERO_PHONE_MAX_WIDTH, HERO_POSTER_FILES } from "./hero-video";
import { attachHeroVideo } from "./hero-video-controller";

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/**
 * Full-screen background. The server HTML holds the poster and an empty <video> (no src, preload none), so nothing
 * but the poster is fetched before first paint. After the window load event the file for this screen is chosen and
 * played; reduced motion, data-saver and 2G keep the poster only, and a tab opened in the background starts the video
 * when it is first shown (see hero-video-controller). The poster and the video share one box, so there is no layout
 * jump when the video fades in.
 */
export function HomeVideo() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    return attachHeroVideo(element, {
      width: () => window.innerWidth,
      document,
      window,
      motion: matchMedia("(prefers-reduced-motion: reduce)"),
      connection: (navigator as Navigator & { connection?: NetworkInformation }).connection,
      schedule: (callback) => {
        if (typeof requestIdleCallback === "function") {
          const handle = requestIdleCallback(callback, { timeout: 1500 });
          return () => cancelIdleCallback(handle);
        }
        const timer = setTimeout(callback, 250);
        return () => clearTimeout(timer);
      },
    });
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
