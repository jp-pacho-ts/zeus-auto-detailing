"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { LANDING_PHOTOS } from "./landing-photos";
// LE 2026-11-21: each menu link carries a shop photo; hovering or focusing it crossfades the backdrop to that photo.
// LE 2026-11-28: the links open their coming-soon pages (MENU_PAGES) instead of jumping to a section.
const MENU_LINKS = [["/preview/about", "About", "full-detailing"], ["/preview/services", "Services", "signature-wash"], ["/preview/work", "Our work", "exterior-detailing"], ["/preview/products", "Products we use", "kenzo-graphene"]] as const;
export function LandingHeader({ logo, label, href }: { logo: string; label: string; href: string }) {
  const [open, setOpen] = useState(false);
  // Closing keeps the menu painted for its exit animation; reduced motion closes at once.
  const [closing, setClosing] = useState(false);
  const closeMenu = () => { setOpen(false); setClosing(!matchMedia("(prefers-reduced-motion: reduce)").matches); };
  const [shot, setShot] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  const [goldInView, setGoldInView] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 8px absorbs trackpad jitter at the very top.
    const update = () => setAtTop(window.scrollY <= 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    // Full-screen menu: the page behind can neither scroll nor take focus while it is open.
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { closeMenu(); button.current?.focus(); } };
    const behind = [...document.querySelectorAll<HTMLElement>("#landing-main, #site-footer")];
    const root = document.documentElement, overflow = root.style.overflow;
    document.addEventListener("keydown", close);
    behind.forEach((el) => { el.inert = true; });
    root.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", close); behind.forEach((el) => { el.inert = false; }); root.style.overflow = overflow; };
  }, [open]);
  useEffect(() => {
    if (!closing) return;
    // Fallback in case animationend never fires (tab hidden, animation overridden).
    const done = setTimeout(() => setClosing(false), 700);
    return () => clearTimeout(done);
  }, [closing]);
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
  return <>{/* LE 2026-11-19: one transparent header at the very top of the page; it slides away as soon as you scroll down and returns only back at the top. */}
  <header className="landing-header" data-menu-open={open} data-hidden={!atTop && !open} data-past-hero={pastHero}>
    <a href="#top" aria-label="Zeus Auto Detailing, back to top"><Image src={logo} alt="Zeus Auto Detailing" width="132" height="52" /></a>
    <a className="landing-pill landing-outline landing-header-cta" href={href}>{label}<span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span></a>
    <button ref={button} className="landing-menu-toggle" type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="landing-menu" onClick={() => { if (open) closeMenu(); else { setClosing(false); setOpen(true); } }}>
      <svg viewBox="0 0 28 28" aria-hidden="true"><line className="landing-menu-line-top" x1="2" y1="11" x2="26" y2="11" /><line className="landing-menu-line-bottom" x1="2" y1="17" x2="26" y2="17" /></svg>
    </button>
    <div id="landing-menu" className="landing-menu" hidden={!open && !closing} data-closing={closing && !open ? "" : undefined} onAnimationEnd={(e) => { if (e.target === e.currentTarget && !open) setClosing(false); }} onClick={(e) => { if ((e.target as Element).closest("a")) closeMenu(); }}>
      <div className="landing-menu-media" aria-hidden="true">{MENU_LINKS.map(([target, , photo], i) => <Image key={target} src={LANDING_PHOTOS[photo].src} alt="" fill sizes="100vw" data-active={i === shot} style={{ objectPosition: LANDING_PHOTOS[photo].position }} />)}</div>
      <nav className="landing-menu-links" aria-label="Site">{MENU_LINKS.map(([target, text], i) => <a key={target} href={target} onMouseEnter={() => setShot(i)} onFocus={() => setShot(i)}>{text}</a>)}</nav>
      <div className="landing-menu-side">
        <ul className="landing-menu-more" aria-label="Booking and contact">
          <li><a href="/book/manage">Manage booking</a></li>
          <li><a href={`tel:${brandConfig.contactPhone.replace(/\s/g, "")}`}>Call {brandConfig.displayPhone}</a></li>
          <li><a href={brandConfig.facebookMessengerUrl}>Messenger</a></li>
          <li><a href={brandConfig.instagram}>Instagram</a></li>
          <li><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(brandConfig.mapCoordinates)}`} target="_blank" rel="noreferrer" aria-label="Get directions, opens Google Maps">Get directions<ArrowUpRight aria-hidden="true" /></a></li>
        </ul>
        <a className="landing-kbtn landing-k-outline" href={href}><span className="landing-k-label"><span>{label}</span></span><span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span></a>
      </div>
    </div>
  </header><div className="landing-phone-bar" hidden={!pastHero || open || goldInView}><a className="landing-pill landing-gold" href={href}>{label}</a><a className="landing-pill landing-outline landing-manage" href="/book/manage">Manage booking</a></div></>;
}
