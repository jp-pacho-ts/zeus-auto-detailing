"use client";
import { useEffect, useRef } from "react";
import { attachLandingPass } from "./landing-video-pass";

// Landing-only controller. The shared ComingSoon media and its lifecycle stay untouched.
export function LandingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const pass = useRef({ consumed: false });
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    return attachLandingPass(element, pass.current);
  }, []);
  return <div className="landing-media">
    {/* Reserved overscan contains M1; every fallback shows the matching terminal frame. */}
    <div className="landing-media-frame"><div className="landing-media-layer">
      {/* Already-public, encoded shop footage; the poster always remains underneath. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/preview/hero-terminal.webp" alt="" width="1920" height="1080" fetchPriority="high" />
      <video ref={video} muted playsInline preload="none" aria-hidden="true" style={{ opacity: 0 }} />
    </div></div>
  </div>;
}
