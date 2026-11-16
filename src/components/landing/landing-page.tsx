import Image from "next/image";
import { MessageCircle, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { LandingStatus } from "@/server/landing/status";
import { LandingHeader } from "./landing-header";
import { LandingVideo } from "./landing-video";
import { LandingLifecycle } from "./landing-lifecycle";
import { LandingServices, type DisplayCatalog } from "./landing-services";
import { landingPhoto } from "./landing-photos";
import { bookingAction, serviceArrow, servicePrice } from "./landing-model";
import "./landing.css";

// Copy: only the approved strings in .team/handoffs/P1-88.md 17.12.3; {values} come from brandConfig or the catalog.
export function LandingPage({ catalog, status }: { catalog: BookingCatalog | null; status: LandingStatus }) {
  const phone = brandConfig.contactPhone.replace(/\s/g, "");
  const tel = `tel:${phone}`;
  const booking = bookingAction(status, phone);
  // Explicit public display projection; release identifiers never cross into the client component props.
  const display: DisplayCatalog | null = catalog ? { vehicleCategories: catalog.vehicleCategories, services: catalog.services.map((service) => ({ ...service, productName: null, hardness: null, warrantyMonths: null })), addOnCompatibility: catalog.addOnCompatibility } : null;
  const graphene = display?.services.filter((s) => s.category === "GRAPHENE" && s.type === "BASE") ?? [];
  const films = display?.services.filter((s) => (s.category === "TINT" || s.category === "PPF") && s.type === "BASE") ?? [];
  const workPhoto = (slug: string, className: string, sizes: string) => {
    const photo = landingPhoto(slug)!;
    return <div className={className}><Image src={photo.src} alt={photo.alt} width={1600} height={1200} sizes={sizes} /></div>;
  };
  const gold = (id?: string) => <a id={id} className="landing-pill landing-gold" href={booking.href}>{booking.label}</a>;
  const pausedLine = "Online booking is paused. Call or message us to book.";
  return <div className="landing" data-landing-preview>
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <div className="landing-preview-note">Website preview. Some sections are not finished yet.</div>
    <LandingHeader logo={brandConfig.logoUrl} label={booking.label} href={booking.href} phone={phone} />
    <main id="landing-main">
      <section id="top" className="landing-hero">
        <span className="landing-word" aria-hidden="true">ZEUS</span>
        <LandingVideo />
        <div className="landing-wrap landing-hero-copy">
          <h1>Car and motorcycle detailing in Tacloban City</h1>
          <p className="landing-lede">Washes, detailing, graphene coating, window tint, paint protection film and panel repaint.</p>
          <div id="landing-hero-actions" className="landing-actions">{gold()}<a className="landing-pill landing-outline" href="#services">See services and prices</a></div>
          {status === "PAUSED" && <p className="landing-status">{pausedLine}</p>}
          {status === "UNKNOWN" && <p className="landing-status">We could not check online booking just now. <a href={tel}>Call the shop</a></p>}
          <p className="landing-hero-address">{brandConfig.location} · <a href={tel}>Call {brandConfig.displayPhone} to confirm hours</a></p>
        </div>
      </section>
      <section className="landing-process landing-wrap" aria-label="Washes and detailing">
        {workPhoto("exterior-detailing", "landing-process-wide", "(max-width: 767px) 60vw, 700px")}
        {workPhoto("signature-wash", "landing-process-close", "(max-width: 767px) 40vw, 400px")}
        <div className="landing-process-copy">{["exterior-detailing", "signature-wash"].map((slug) => {
          const service = display?.services.find((s) => s.slug === slug);
          return service ? <div key={slug}><h2>{service.name}</h2>{service.description && <p className="landing-muted">{service.description}</p>}</div> : null;
        })}</div>
      </section>
      {display ? <LandingServices catalog={display} phone={phone} messenger={brandConfig.facebookMessengerUrl} status={status} /> : <section id="services" className="landing-section landing-wrap"><h2>Services and prices</h2><p className="landing-error">Prices are unavailable right now. <a href={tel}>Call {brandConfig.displayPhone}</a></p><div id="estimate"><h2>Estimate your price</h2><p className="landing-error">Prices are unavailable right now. <a href={tel}>Call {brandConfig.displayPhone}</a></p></div></section>}
      <section id="coatings" className="landing-section landing-wrap">
        <h2>Coatings and films</h2>
        <p className="landing-muted">Ask us which coating or film suits your vehicle.</p>
        <div className="landing-coatings-editorial">
          <div className="landing-coating-frame">{workPhoto("eclipse-graphene", "landing-coating-photo", "(max-width: 767px) 100vw, 700px")}<span className="landing-coating-edge" aria-hidden="true" /></div>
          <div className="landing-coating-summaries">{graphene.map((s) => {
            const arrow = serviceArrow(display!, undefined, s, status, phone);
            return <article className="landing-card" key={s.id}><h3>{s.name}</h3><div className="landing-card-actions"><p className="landing-price">{servicePrice(s)}</p><a className="landing-arrow" href={arrow.href} aria-label={arrow.label}>↗</a></div>{s.inclusions.length > 0 && <details><summary>What&apos;s included</summary><ul>{s.inclusions.map((item) => <li key={item}>{item}</li>)}</ul></details>}</article>;
          })}</div>
        </div>
        {films.length > 0 && <><h3>Window tint and paint protection film</h3><ul className="landing-chip-list">{films.map((s) => <li className="landing-chip" key={s.id}>{s.name}</li>)}</ul></>}
        <p><a href={brandConfig.facebookMessengerUrl}>Ask about coatings on Messenger</a></p>
      </section>
      <section id="gallery" className="landing-section landing-wrap landing-gallery" aria-labelledby="landing-gallery-title">
        <h2 id="landing-gallery-title">Gallery</h2>
        <div className="landing-gallery-slots"><p>Gallery photos will appear here.</p><div aria-hidden="true" /></div>
      </section>
      <section id="visit" className="landing-section landing-wrap">
        <h2>Visit the shop</h2>
        <div className="landing-visit">
          <div className="landing-card landing-visit-card">
            <address>{brandConfig.address}</address>
            <p className="landing-muted">Landmark: {brandConfig.landmark}</p>
            <a className="landing-pill landing-outline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.address)}`} target="_blank" rel="noreferrer" aria-label="Get directions, opens Google Maps">Get directions</a>
          </div>
          <div className="landing-card landing-visit-card">
            <h3>Hours</h3>
            <p><a href={tel}>Call {brandConfig.displayPhone} to confirm hours.</a></p>
            <ul className="landing-link-list"><li><a href={tel}>Call {brandConfig.displayPhone}</a></li><li><a href={brandConfig.facebookMessengerUrl}>Message us on Messenger</a></li><li><a href={brandConfig.instagram}>Instagram {brandConfig.instagramHandle}</a></li></ul>
            <p className="landing-muted">Already booked? <a href="/book/manage">Manage your booking</a></p>
          </div>
          <div className="landing-card landing-visit-card">
            <h3>About Zeus</h3>
            <p>{brandConfig.businessName} details cars and motorcycles at {brandConfig.location}.</p>
          </div>
        </div>
        <aside className="landing-feedback"><h3>Customer feedback</h3><p className="landing-muted">Customer feedback will appear here.</p></aside>
      </section>
      <section className="landing-band" aria-labelledby="landing-band-title">
        <div className="landing-band-stage">
          <div className="landing-wrap landing-band-copy">
            <span className="landing-hairline" aria-hidden="true" />
            <h2 id="landing-band-title" className="landing-band-line">Book your visit</h2>
            <p className="landing-band-line landing-muted">{status === "PAUSED" ? pausedLine : `Book online, or call ${brandConfig.displayPhone} to ask about hours and prices.`}</p>
            <div id="landing-closing-cta" className="landing-actions landing-band-line">{gold()}<a href={tel}>Call {brandConfig.displayPhone}</a></div>
          </div>
          <div className="landing-band-media">
            {/* Approved DSC00749 derivative: hands, polisher and hood remain visible through the decorative aperture. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/landing/full-detailing.webp" alt="Detailer machine-polishing the hood of a white pickup" width="1600" height="1200" loading="lazy" decoding="async" />
            <span className="landing-door landing-door-left" aria-hidden="true" /><span className="landing-door landing-door-right" aria-hidden="true" />
          </div>
        </div>
      </section>
    </main>
    <footer className="landing-footer"><div className="landing-wrap">
      <div className="landing-footer-grid">
        <div><Image src={brandConfig.logoUrl} alt="Zeus Auto Detailing" width="132" height="52" /><p className="landing-muted">{brandConfig.address}</p>
          <div className="landing-icons"><a href={tel} aria-label="Call Zeus"><Phone aria-hidden="true" /></a><a href={brandConfig.facebookMessengerUrl} aria-label="Zeus on Messenger"><MessageCircle aria-hidden="true" /></a><a href={brandConfig.instagram} aria-label="Zeus on Instagram"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></a></div>
        </div>
        <nav aria-label="Footer"><ul className="landing-footer-links"><li><a href="#services">Services</a></li><li><a href="#estimate">Prices</a></li><li><a href="#visit">Visit</a></li><li><a href="/book/manage">Manage booking</a></li><li><a href="/admin/login">Staff login</a></li><li><a href="#top">Back to top</a></li></ul></nav>
      </div>
      <p className="landing-copyright">© {new Date().getFullYear()} {brandConfig.businessName}</p>
    </div></footer>
    <LandingLifecycle />
  </div>;
}
