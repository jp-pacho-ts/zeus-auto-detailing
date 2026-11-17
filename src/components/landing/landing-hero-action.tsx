"use client";
import { useState, useSyncExternalStore } from "react";
import { ArrowUpRight } from "lucide-react";
import Magnet from "./react-bits-magnet";

const query = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const subscribe = (notify: () => void) => { const media = matchMedia(query); media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); };
export function LandingHeroAction({ href, label }: { href: string; label: string }) {
  const enabled = useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
  const [focused, setFocused] = useState(false);
  return <Magnet disabled={!enabled || focused} padding={24} magnetStrength={12} maxOffset={5} wrapperClassName="landing-magnet" onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}><a className="landing-pill landing-gold" href={href}>{label}<ArrowUpRight aria-hidden="true" /></a></Magnet>;
}
