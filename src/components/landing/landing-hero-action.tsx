"use client";
import { useState, useSyncExternalStore } from "react";
import { ArrowUpRight } from "lucide-react";
import Magnet from "./react-bits-magnet";

const query = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const subscribe = (notify: () => void) => { const media = matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
export function LandingHeroAction({ href, label }: { href: string; label: string }) {
  const enabled = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
  const [focused, setFocused] = useState(false);
  return <Magnet disabled={!enabled || focused} padding={32} magnetStrength={4} maxOffset={5} tilt={0} scale={1.01} wrapperClassName="landing-magnet" onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}><a className="landing-pill landing-gold" href={href}>{label}<span className="landing-pill-icon"><ArrowUpRight aria-hidden="true" /></span></a></Magnet>;
}
