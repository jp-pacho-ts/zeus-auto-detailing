"use client";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import Magnet from "./react-bits-magnet";

const query = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const subscribe = (notify: () => void) => { const media = matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
export function LandingHeroAction({ href, label }: { href: string; label: string }) {
  const enabled = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
  const [focused, setFocused] = useState(false);
  return <Magnet disabled={!enabled || focused} padding={26} magnetStrength={3} maxOffset={8} scale={1.02} wrapperClassName="landing-magnet" onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}><a className="landing-pill landing-gold landing-kbtn" href={href}><span className="landing-k-label"><span>{label}</span></span><span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span></a></Magnet>;
}
