import Image from "next/image";
import Link from "next/link";
import { CalendarCheck, Ticket } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { comingSoonStyles } from "./coming-soon.styles";
import { HomeIntro } from "./home-intro";
import { HOME_INTRO_PREPAINT, HOME_INTRO_PREPAINT_ID } from "./home-intro-prepaint";
import { HomeVideo } from "./home-video";

// Simple Icons-style glyphs, drawn inline so the page needs no icon font and makes no extra request.
function FacebookIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.9.4-1.7 1.8-1.7h1.6V3.9c-.3 0-1.3-.2-2.5-.2-2.6 0-4.3 1.6-4.3 4.4v2.4H7.4v3.3h2.7V22h3.4z" /></svg>;
}
function InstagramIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r=".6" fill="currentColor" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>;
}
function LocationIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>;
}

export function ComingSoon() {
  const phone = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.locationFull)}`;
  // The pre-paint script must stay before the curtain and content so it runs before they first paint.
  return <><style>{comingSoonStyles}</style><script id={HOME_INTRO_PREPAINT_ID} dangerouslySetInnerHTML={{ __html: HOME_INTRO_PREPAINT }} /><HomeIntro>
    <div className="zeus-coming-soon">
      <main className="zeus-hero" id="home" aria-labelledby="coming-soon-title">
        <HomeVideo />
        <div className="zeus-hero-shade" aria-hidden="true" />
        {/* The logo comes first in reading order and sits bottom right on the page (see the styles). */}
        <div className="zeus-hero-logo"><Image src={brandConfig.logoUrl} alt={brandConfig.businessName} width={715} height={275} priority sizes="(max-width: 800px) 135px, 160px" className="zeus-coming-soon__logo" /></div>
        <div className="zeus-hero-body">
          <h1 id="coming-soon-title" aria-label="Coming soon">Coming<br />soon<span>.</span></h1>
          <p className="zeus-lede">Our new website is on the way. The shop is open as usual.</p>
          <div className="zeus-actions">
            <Link className="zeus-seg zeus-seg--primary" href="/book" prefetch={false}><CalendarCheck aria-hidden="true" />Book now</Link>
            <Link className="zeus-seg" href="/book/manage" prefetch={false}><Ticket aria-hidden="true" />Manage booking</Link>
          </div>
        </div>
        <div className="zeus-hero-foot">
          <div className="zeus-social">
            <a href={phone} aria-label={`Call the shop ${brandConfig.displayPhone}`}><PhoneIcon /></a>
            <a href={brandConfig.facebookPageUrl} target="_blank" rel="noopener noreferrer" aria-label={`${brandConfig.businessName} on Facebook`}><FacebookIcon /></a>
            <a href={brandConfig.instagram} target="_blank" rel="noopener noreferrer" aria-label={`${brandConfig.businessName} on Instagram`}><InstagramIcon /></a>
            {/* The address is a map-pin icon (P1-47). Its name and tooltip carry the address, so screen readers and a hover still get it. */}
            <a href={map} target="_blank" rel="noopener noreferrer" aria-label={`${brandConfig.businessName} location: ${brandConfig.location}`} title={brandConfig.location}><LocationIcon /></a>
          </div>
        </div>
      </main>
    </div>
  </HomeIntro></>;
}
