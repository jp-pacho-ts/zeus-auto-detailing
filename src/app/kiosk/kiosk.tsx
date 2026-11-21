"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, Hand } from "lucide-react";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { LandingVideo } from "@/components/landing/landing-video";
import { brandConfig } from "@/config/brand";
import "@/components/landing/landing.css";
import styles from "./kiosk.module.css";

export function Kiosk() {
  const [started, setStarted] = useState(false);
  const restoreFocus = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);

  const reset = useCallback(() => {
    restoreFocus.current = true;
    setStarted(false);
  }, []);

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

  if (started) return <div className={styles.booking}><BookingWizard kioskOnExit={reset} /></div>;

  // Attract screen: the live landing hero (landing.css). A tap anywhere starts the order; the gold button is the keyboard and screen-reader path.
  return (
    // Kiosk start screen (McDonald's / Flipdish "touch to start order" pattern): footage full-screen, logo and copy centred,
    // one large centred start target and a full-width gold touch bar along the bottom.
    <main className={`landing ${styles.welcome}`} onClick={() => setStarted(true)}>
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
        <button ref={startButton} type="button" className={`landing-pill landing-gold landing-kbtn ${styles.start}`}>
          <span className="landing-k-label"><span>Tap to start</span></span>
          <span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span>
        </button>
      </section>
      <div className={styles.bar} aria-hidden="true"><Hand />Touch anywhere to begin</div>
    </main>
  );
}
