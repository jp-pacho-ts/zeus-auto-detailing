"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { LandingVideo } from "@/components/landing/landing-video";
import { HERO_POSTER_FILES } from "@/components/home/hero-video";
import { brandConfig } from "@/config/brand";
import "@/components/landing/landing.css";
import styles from "./kiosk.module.css";

// Lengths of the welcome's exit and the booking's end; kept in step with the keyframes in kiosk.module.css.
const EXIT_MS = 950;
const END_MS = 900;

export function Kiosk() {
  const [started, setStarted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const restoreFocus = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);

  const reset = useCallback(() => {
    restoreFocus.current = true;
    setLeaving(false);
    setEnding(false);
    setStarted(false);
  }, []);

  // Ending a booking (End session, Next customer or the idle timeout) plays the reverse: the letterbox closes,
  // the booking fades and the shop footage pushes into black, then the welcome fades up again.
  const end = useCallback(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return reset();
    setEnding(true);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(reset, END_MS);
  }, [reset]);

  // A tap plays the exit (letterbox closes, footage pushes in and goes dark) before the booking fades up from black.
  const start = () => {
    if (leaving) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setStarted(true);
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => setStarted(true), EXIT_MS);
  };

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [reset]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (!started && restoreFocus.current) startButton.current?.focus();
    if (started) document.getElementById("wizard-step-title")?.focus();
  }, [started]);

  // The shop still from the welcome carries on behind every booking step, darkened, with a slow camera push.
  if (started) return (
    <div className={styles.booking} data-ending={ending || undefined}>
      <div className={styles.backdrop} aria-hidden="true">
        <Image src={HERO_POSTER_FILES.desktop} alt="" fill sizes="100vw" priority />
      </div>
      <BookingWizard kioskOnExit={end} />
    </div>
  );

  // Attract screen: the live landing hero (landing.css). A tap anywhere starts the order; the bottom button is the keyboard and screen-reader path.
  return (
    // Kiosk start screen (McDonald's / Flipdish "touch to start order" pattern): footage full-screen, logo and copy centred,
    // and one quiet start button along the bottom.
    <main className={`landing ${styles.welcome}`} data-leaving={leaving || undefined} onClick={start}>
      <div className={`landing-hero-art ${styles.art}`}>
        <div className="landing-hero-photo"><LandingVideo /></div>
      </div>
      <header className={styles.top}>
        <Image src={brandConfig.logoUrl} alt="Zeus Auto Detailing" width="200" height="77" priority />
      </header>
      <section className={styles.center} aria-labelledby="kiosk-title">
        <h1 id="kiosk-title" className={styles.title}>
          Beyond clean<span className="landing-gold-dot">.</span>
          <span className={styles.sub}>Book your car or motorcycle detailing here</span>
        </h1>
      </section>
      {/* The one start control; the whole screen also starts the order on tap. */}
      <button ref={startButton} type="button" className={styles.bar}>Touch anywhere to begin</button>
    </main>
  );
}
