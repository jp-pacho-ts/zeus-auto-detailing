"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { HomeVideo } from "@/components/home/home-video";
import { Logo } from "@/components/ui/logo";
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

  if (started) return <BookingWizard kioskOnExit={reset} />;

  return (
    <main className={styles.welcome}>
      <HomeVideo />
      <div className="relative flex min-h-[100dvh] max-w-4xl flex-col items-start justify-between gap-12 px-6 py-8 sm:px-12 sm:py-12">
        <Logo priority />
        <div>
          <h1 className="max-w-[12ch] text-balance text-5xl font-extrabold leading-none tracking-tight sm:text-7xl">
            Book your detailing service
          </h1>
          <button
            ref={startButton}
            type="button"
            onClick={() => setStarted(true)}
            className="mt-8 inline-flex min-h-16 items-center gap-6 rounded-xl bg-primary px-8 text-xl font-bold text-primary-foreground hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            Start booking <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </main>
  );
}
