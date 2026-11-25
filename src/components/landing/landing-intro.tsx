"use client";
import type { ReactNode } from "react";
import { HomeIntro, type IntroMotion } from "@/components/home/home-intro";

const loadLandingMotion = async (): Promise<IntroMotion> => (await import("./landing-intro-motion")).playLandingIntro;

// Once per browser tab (sessionStorage, shared with the homepage intro); skipped for reduced motion.
export function LandingIntro({ children }: { children: ReactNode }) {
  return <HomeIntro loadMotion={loadLandingMotion}>{children}</HomeIntro>;
}
