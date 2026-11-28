import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { bookingAction } from "./landing-model";
import type { LandingPhoto } from "./landing-photos";
import "./landing.css";

// LE 2026-11-20: a service's own page is not built yet; this branded page keeps every click useful (book, message, back).
export function LandingComingSoon({ title, photo }: { title: string; photo?: LandingPhoto }) {
  const booking = bookingAction();
  return <div className="landing landing-soon" data-landing-preview="">
    {photo && <div className="landing-soon-photo" aria-hidden="true"><Image src={photo.src} alt="" width={1600} height={1200} sizes="100vw" priority style={photo.position ? { objectPosition: photo.position } : undefined} /></div>}
    <header className="landing-wrap landing-soon-head">
      <Link href="/preview/landing" aria-label="Zeus Auto Detailing, main page"><Image src={brandConfig.logoUrl} alt="Zeus Auto Detailing" width="132" height="52" /></Link>
    </header>
    <main className="landing-wrap landing-soon-main">
      <p className="landing-eyebrow">Coming soon</p>
      <h1>{title}<span className="landing-gold-dot">.</span></h1>
      <p className="landing-soon-text">A full page for {title === title.toUpperCase() ? title : title.toLowerCase()} is on its way. For now, book online or message us for details and prices.</p>
      <div className="landing-soon-actions">
        <a className="landing-pill landing-gold landing-kbtn" href={booking.href}><span className="landing-k-label"><span>{booking.label}</span></span><span className="landing-k-arrow"><ArrowRight aria-hidden="true" /></span></a>
        <a className="landing-kbtn landing-k-outline" href={brandConfig.facebookMessengerUrl}><span className="landing-k-label"><span>Message us</span></span><span className="landing-k-arrow"><ArrowUpRight aria-hidden="true" /></span></a>
      </div>
      <Link className="landing-text-link landing-soon-back" href="/preview/landing"><ArrowLeft aria-hidden="true" />Back to the main page</Link>
    </main>
  </div>;
}
