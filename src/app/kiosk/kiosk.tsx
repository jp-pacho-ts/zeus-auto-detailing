"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowDown, ArrowRight } from "lucide-react";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { HomeVideo } from "@/components/home/home-video";
import { LANDING_PHOTOS, landingPhoto } from "@/components/landing/landing-photos";
import { Logo } from "@/components/ui/logo";
import styles from "./kiosk.module.css";

const scenes = [
  { title: "Wash", slug: "signature-wash" },
  { title: "Detailing", slug: "exterior-detailing" },
  { title: "Graphene coating", slug: "arcane-graphene" },
] as const;

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

  return (
    <main className={styles.welcome}>
      <section className={styles.hero} aria-labelledby="kiosk-title">
        <div className={styles.media}><HomeVideo /></div>
        <div className={styles.heroInner}>
          <Logo priority />
          <div className={styles.heroCopy}>
            <span className={styles.wordmark} aria-hidden="true">ZEUS</span>
            <h1 id="kiosk-title">Book your detailing service</h1>
            <div className={styles.actions}>
              <button ref={startButton} type="button" onClick={() => setStarted(true)} className={styles.primary}>
                Start booking <ArrowRight aria-hidden="true" size={20} />
              </button>
              <a href="#kiosk-services" className={styles.secondary}>
                Explore services <ArrowDown aria-hidden="true" size={18} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="kiosk-services" className={styles.showcase} aria-labelledby="kiosk-services-title">
        <div className={styles.showcaseIntro}>
          <h2 id="kiosk-services-title">What we do in the shop</h2>
        </div>
        <div className={styles.scenes}>
          {scenes.map(({ title, slug }) => {
            const photo = landingPhoto(slug) ?? LANDING_PHOTOS["full-detailing"];
            return (
              <article key={slug} className={styles.scene}>
                <div className={styles.frame}>
                  <Image src={photo.src} alt={photo.alt} width={1600} height={1200}
                    sizes="(max-width: 700px) 100vw, 70vw" style={{ objectPosition: photo.position }} />
                </div>
                <h3>{title}</h3>
              </article>
            );
          })}
        </div>
        <button type="button" onClick={() => setStarted(true)} className={styles.primary}>
          Choose your services <ArrowRight aria-hidden="true" size={20} />
        </button>
      </section>
    </main>
  );
}
