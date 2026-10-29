"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { brandConfig } from "@/config/brand";

gsap.registerPlugin(useGSAP);
const SESSION_KEY = "zeus.home.intro.v1";

export function HomeIntro({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP((context) => {
    const element = root.current!;
    const content = element.querySelector<HTMLElement>("[data-home-content]")!;
    const curtain = element.querySelector<HTMLElement>("[data-home-curtain]")!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let cleanupMotion: (() => void) | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      cleanupMotion?.(); cleanupMotion = undefined;
      clearTimeout(watchdog);
      content.inert = false;
      curtain.hidden = true;
      element.dataset.homeIntro = "idle";
      if (curtain.contains(document.activeElement)) content.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    };
    const interrupt = () => finish();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Enter" && curtain.contains(event.target as Node)) finish(); };
    const click = () => finish();
    // Defer past Strict Mode's rehearsal; only an actual play consumes the session.
    const start = setTimeout(async () => {
      try {
        if (media.matches || sessionStorage.getItem(SESSION_KEY)) return;
        const { playHomeIntro } = await import("./home-intro-motion");
        if (disposed || media.matches) return;
        sessionStorage.setItem(SESSION_KEY, "seen");
        watchdog = setTimeout(finish, 5500);
        context.add(() => {
          curtain.hidden = false;
          content.inert = true;
          element.dataset.homeIntro = "running";
          cleanupMotion = playHomeIntro(element, finish);
        });
      } catch { finish(); }
    }, 0);
    media.addEventListener("change", interrupt);
    document.addEventListener("keydown", keydown);
    window.addEventListener("pagehide", interrupt);
    curtain.addEventListener("click", click);
    return () => {
      disposed = true; clearTimeout(start); finish();
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
