"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
export function LandingHeader({ logo, label, href, phone }: { logo: string; label: string; href: string; phone: string }) {
  const [open, setOpen] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const hero = document.getElementById("landing-hero-actions");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(hero); return () => observer.disconnect();
  }, []);
  const links = <><a href="#services">Services</a><a href="#estimate">Prices</a><a href="#gallery">Gallery</a><a href="#reviews">Reviews</a><a href="#about">About</a><a href="#visit">Visit</a><a href="/book/manage">Manage booking</a></>;
  return <><header className="landing-header"><a href="#top" aria-label="Zeus Auto Detailing, top of preview"><Image src={logo} alt="Zeus Auto Detailing" width="132" height="52" /></a><nav className="landing-desktop-nav" aria-label="Main">{links}</nav><a className="landing-button landing-header-cta" href={href}>{label}</a><button ref={button} className="landing-menu-toggle" type="button" aria-expanded={open} aria-controls="landing-mobile-menu" onClick={() => setOpen(!open)}>{open ? "Close menu" : "Menu"}</button><nav id="landing-mobile-menu" className="landing-mobile-menu" hidden={!open} aria-label="Mobile" onClick={(e) => { if ((e.target as Element).closest("a")) setOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } }}>{links}<a className="landing-button" href={href}>{label}</a></nav></header><div className="landing-phone-bar" hidden={!pastHero || open}><a className="landing-button" href={href}>{label}</a><a className="landing-call" aria-label="Call the shop" href={`tel:${phone}`}>Call</a></div></>;
}
