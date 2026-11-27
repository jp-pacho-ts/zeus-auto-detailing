import type { ReactNode } from "react";
import Image from "next/image";
import { HERO_POSTER_FILES } from "@/components/home/hero-video";
// The landing's faces (LandingDisplay, LandingText) that the stage's type uses.
import "@/components/landing/landing.css";
import { BookingMotion } from "./booking-motion";
import styles from "./booking-stage.module.css";

// The booking stage for /book and /kiosk: the darkened shop still from the landing hero behind every step.
export function BookingStage({ ending, children }: { ending?: boolean; children: ReactNode }) {
  return (
    <div className={styles.booking} data-booking-stage="" data-ending={ending || undefined}>
      <BookingMotion />
      <div className={styles.backdrop} aria-hidden="true">
        <Image src={HERO_POSTER_FILES.desktop} alt="" fill sizes="100vw" priority />
      </div>
      {children}
    </div>
  );
}
