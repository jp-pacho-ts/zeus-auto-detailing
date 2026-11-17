"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Phone } from "lucide-react";
export function LandingHeader({ logo, label, href, phone }: { logo: string; label: string; href: string; phone: string }) {
  const [open, setOpen] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [goldInView, setGoldInView] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const desktop = matchMedia("(min-width: 1101px)");
    const resize = () => { if (desktop.matches) setOpen(false); };
    document.addEventListener("keydown", close);
    desktop.addEventListener("change", resize);
    return () => { document.removeEventListener("keydown", close); desktop.removeEventListener("change", resize); };
  }, [open]);
  useEffect(() => {
    const hero = document.getElementById("landing-hero-actions");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(hero);
    // 17.7.1: one gold pill per view, so the bar steps aside while the category tabs (gold selected pill), the estimate result or the closing CTA is on screen.
    const seen = new Map<Element, boolean>();
    const gold = new IntersectionObserver((entries) => { for (const e of entries) seen.set(e.target, e.isIntersecting); setGoldInView([...seen.values()].some(Boolean)); });
    for (const el of document.querySelectorAll(".landing-tabs, #landing-estimate-result, #landing-closing-cta")) gold.observe(el);
    return () => { observer.disconnect(); gold.disconnect(); };
  }, []);
  const links = <><a href="#about">Our approach</a><a href="#services">Services</a><a href="#work">Our work</a><a href="#reviews">Reviews</a><a href="#faq">FAQ</a><a href="#visit">Visit</a></>;
  return <><header className="landing-header"><a href="#top" aria-label="Zeus Auto Detailing, back to top"><Image src={logo} alt="Zeus Auto Detailing" width="132" height="52" /></a><nav className="landing-desktop-nav" aria-label="Site">{links}</nav><a className="landing-pill landing-outline landing-header-cta" href={href}>{label}</a><button ref={button} className="landing-pill landing-outline landing-menu-toggle" type="button" aria-expanded={open} aria-controls="landing-mobile-menu" onClick={() => setOpen(!open)}>{open ? "Close menu" : "Menu"}</button><nav id="landing-mobile-menu" className="landing-mobile-menu" hidden={!open} aria-label="Site" onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } }}>{links}<a className="landing-pill landing-outline" href={href}>{label}</a></nav></header><div className="landing-phone-bar" hidden={!pastHero || open || goldInView}><a className="landing-pill landing-gold" href={href}>{label}</a><a className="landing-pill landing-outline landing-call" aria-label="Call the shop" href={`tel:${phone}`}><Phone aria-hidden="true" />Call</a></div></>;
}
