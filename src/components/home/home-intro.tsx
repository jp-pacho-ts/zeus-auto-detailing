"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { brandConfig } from "@/config/brand";
import {
  HOME_INTRO_LATEST_START_MS,
  HOME_INTRO_PENDING_STYLE_ID,
  HOME_INTRO_SESSION_KEY,
} from "./home-intro-prepaint";

gsap.registerPlugin(useGSAP);
type PrepaintWindow = Window & { __zeusHomeIntroRelease?: () => void };

export function HomeIntro({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP((context) => {
    const element = root.current!;
    const content = element.querySelector<HTMLElement>("[data-home-content]")!;
    const curtain = element.querySelector<HTMLElement>("[data-home-curtain]")!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const pendingStyle = () => document.getElementById(HOME_INTRO_PENDING_STYLE_ID);
    const pending = () => pendingStyle() !== null;
    let disposed = false;
    let started = false;
    let cancelled = false;
    let returnFocus: HTMLElement | null = null;
    let cleanupMotion: (() => void) | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      // Any skip, interruption or failure also cancels an intro whose motion module is still loading (F5).
      cancelled = true;
      cleanupMotion?.(); cleanupMotion = undefined;
      clearTimeout(watchdog);
      (window as PrepaintWindow).__zeusHomeIntroRelease?.();
      pendingStyle()?.remove();
      content.inert = false;
      curtain.hidden = true;
      element.dataset.homeIntro = "idle";
      if (curtain.contains(document.activeElement)) (returnFocus ?? content.querySelector<HTMLElement>("a"))?.focus({ preventScroll: true });
    };
    const interrupt = () => finish();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Enter" && curtain.contains(event.target as Node)) finish(); };
    const click = () => finish();
    // Defer past Strict Mode's rehearsal; only an actual play consumes the session. The rehearsal's cleanup leaves
    // the pre-paint curtain in place for the real mount.
    const start = setTimeout(async () => {
      try {
        // Play only when the pre-paint script showed the curtain for this tab and nothing has released it since:
        // Escape or a click before this script loaded, or the CSS fallback about to time out.
        if (!pending() || media.matches || sessionStorage.getItem(HOME_INTRO_SESSION_KEY) || performance.now() > HOME_INTRO_LATEST_START_MS) return finish();
        const { playHomeIntro } = await import("./home-intro-motion");
        if (disposed) return;
        if (cancelled || media.matches || !pending() || performance.now() > HOME_INTRO_LATEST_START_MS) return finish();
        sessionStorage.setItem(HOME_INTRO_SESSION_KEY, "seen");
        watchdog = setTimeout(finish, 5500);
        context.add(() => {
          // Same task, so no paint in between: the curtain takes over from the pre-paint state.
          started = true;
          const active = document.activeElement;
          if (active instanceof HTMLElement && content.contains(active)) returnFocus = active;
          curtain.hidden = false;
          content.inert = true;
          pendingStyle()?.remove();
          element.dataset.homeIntro = "running";
          // Keep keyboard focus in context while the content is inert; finish() hands it back.
          if (returnFocus) curtain.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
          cleanupMotion = playHomeIntro(element, finish);
        });
      } catch { finish(); }
    }, 0);
    media.addEventListener("change", interrupt);
    document.addEventListener("keydown", keydown);
    window.addEventListener("pagehide", interrupt);
    curtain.addEventListener("click", click);
    return () => {
      disposed = true; clearTimeout(start);
      if (started) finish();
      media.removeEventListener("change", interrupt);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("pagehide", interrupt);
      curtain.removeEventListener("click", click);
    };
  }, { scope: root });
  return <div ref={root} data-home-intro="idle">
    <div data-home-curtain hidden className="zeus-intro">
      <div className="zeus-intro__mark" aria-hidden="true">
        {/* Plain local image: animation never waits for image load. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brandConfig.logoUrl} width="715" height="275" alt="" />
        <p data-intro-text>Built around the details.</p>
        <span data-intro-line />
      </div>
      <button type="button" className="zeus-intro__skip">Skip intro</button>
    </div>
    <div data-home-content>{children}</div>
  </div>;
}
