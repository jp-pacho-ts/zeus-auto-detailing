import Image from "next/image";
import { CircleAlert, Info, MessageCircle, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { LandingStatus } from "@/server/landing/status";
import { LandingHeader } from "./landing-header";
import { LandingVideo } from "./landing-video";
import { LandingLifecycle } from "./landing-lifecycle";
import { CoatingsBleed, LandingServices, type DisplayCatalog } from "./landing-services";
import { LandingFaq } from "./landing-faq";
import { landingPhoto } from "./landing-photos";
import { bookingAction } from "./landing-model";
import "./landing.css";

// P1-90 "What we do": one step per category, its own work photo (identity 5.3), no numbering (P1-89: not a fixed sequence).
const STAGES = [
  { category: "WASH", name: "Wash", photo: "signature-wash" },
  { category: "DETAILING", name: "Detailing", photo: "exterior-detailing" },
  { category: "GRAPHENE", name: "Graphene", photo: "arcane-graphene" },
] as const;

// Copy: the P1-88 17.12.3 deck, the P1-89 approved strings and the P1-90 strategy 9.1/9.2 strings; {values} come from brandConfig or the catalog.
export function LandingPage({ catalog, status }: { catalog: BookingCatalog | null; status: LandingStatus }) {
  const phone = brandConfig.contactPhone.replace(/\s/g, "");
  const tel = `tel:${phone}`;
  const booking = bookingAction(status, phone);
  // Explicit public display projection; release identifiers never cross into the client component props.
  const display: DisplayCatalog | null = catalog ? { vehicleCategories: catalog.vehicleCategories, services: catalog.services.map((service) => ({ ...service, productName: null, hardness: null, warrantyMonths: null })), addOnCompatibility: catalog.addOnCompatibility } : null;
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.address)}`;
  const gold = (id?: string) => <a id={id} className="landing-pill landing-gold" href={booking.href}>{booking.label}</a>;
  const pausedLine = "Online booking is paused. Call or message us to book.";
  const unknownLine = <>We could not check online booking just now. <a href={tel}>Call the shop</a></>;
  const photo = (slug: string, sizes: string) => { const p = landingPhoto(slug)!; return <Image src={p.src} alt={p.alt} width={1600} height={1200} sizes={sizes} style={p.position ? { objectPosition: p.position } : undefined} />; };
  const unavailable = <p className="landing-error"><CircleAlert aria-hidden="true" /><span>Prices are unavailable right now. <a href={tel}>Call {brandConfig.displayPhone}</a></span></p>;
  // FAQ 1 to 8 (strategy 9.2): an item ships only when its answer is a fact the page holds.
  const multiDayCoating = !!display?.services.some((s) => s.category === "GRAPHENE" && s.offers.some((o) => o.duration.kind === "MULTI_DAY"));
  const motorcycles = !!display?.vehicleCategories.some((s) => s.code === "MOTOR");
  const faq = [
    { question: "How much will it cost for my vehicle?", answer: <p>Prices depend on your vehicle size. Choose your size under <a href="#services">Services and prices</a>, or <a href="#estimate">get an estimate</a>.</p> },
    { question: "How long does a service take?", answer: <p>Each service shows its time on its card.{multiDayCoating && " Some coatings take more than one day."}</p> },
    { question: "Can I book online?", answer: <p>{status === "OPEN" ? <>Yes. Choose your services and a date at <a href={booking.href}>Book an appointment</a>.</> : status === "PAUSED" ? pausedLine : unknownLine}</p> },
    { question: "Can I change my booking?", answer: <p>Yes. Use <a href="/book/manage">Manage booking</a> with the details from your booking.</p> },
    ...(motorcycles ? [{ question: "Do you work on motorcycles?", answer: <p>Yes. Choose a motorcycle size to see motorcycle prices.</p> }] : []),
    { question: "What are your opening hours?", answer: <p><a href={tel}>Call {brandConfig.displayPhone} to confirm hours.</a></p> },
    { question: "Where is the shop?", answer: <p>{brandConfig.address}. Landmark: {brandConfig.landmark}. <a href={directions} target="_blank" rel="noreferrer" aria-label="Get directions, opens Google Maps">Get directions</a></p> },
    { question: "What does a graphene package include?", answer: <p>Open What&apos;s included on each package, or compare them under <a href="#coatings">Coatings and films</a>.</p> },
  ];
  return <div className="landing" data-landing-preview>
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <div className="landing-preview-note">Website preview. Some sections are not finished yet.</div>
    <LandingHeader logo={brandConfig.logoUrl} label={booking.label} href={booking.href} phone={phone} />
    <main id="landing-main">
      <section id="top" className="landing-hero">
        <LandingVideo />
        <div className="landing-wrap landing-hero-copy">
          <span className="landing-word" aria-hidden="true">ZEUS</span>
          <h1>Car and motorcycle detailing in Tacloban City</h1>
          <p className="landing-lede">Washes, detailing, graphene coating, window tint, paint protection film and panel repaint.</p>
          <div id="landing-hero-actions" className="landing-actions">{gold()}<a className="landing-pill landing-outline" href="#services">See services and prices</a></div>
          {status === "PAUSED" && <p className="landing-status"><Info aria-hidden="true" /><span>{pausedLine}</span></p>}
          {status === "UNKNOWN" && <p className="landing-status"><Info aria-hidden="true" /><span>{unknownLine}</span></p>}
          <p className="landing-hero-address">{brandConfig.location} · <a href={tel}>Call {brandConfig.displayPhone} to confirm hours</a></p>
        </div>
      </section>
      <section id="work" className="landing-section landing-wrap landing-stage" aria-labelledby="landing-work-title">
        <h2 id="landing-work-title">What we do in the shop</h2>
        <div className="landing-stage-grid">
          <div className="landing-stage-names">{STAGES.map((stage) => {
            const names = display?.services.filter((s) => s.category === stage.category && s.type === "BASE") ?? [];
            return <div key={stage.category} className="landing-step" data-step={stage.category}>
              <h3 className="landing-step-name">{stage.name}</h3>
              {/* Below 1024 px the photo sits with its step; from 1024 px the photos pass in their own column. Only one copy is displayed at any width. */}
              <div className="landing-step-photo">{photo(stage.photo, "(max-width: 767px) 100vw, 60vw")}</div>
              {names.length > 0 && <ul className="landing-step-links">{names.map((s) => <li key={s.id}><a href={`#service-${s.slug}`}>{s.name}</a></li>)}</ul>}
              <a className="landing-step-prices" href={`#services-${stage.category}`}>See {stage.name.toLowerCase()} prices</a>
            </div>;
          })}</div>
          <div className="landing-stage-photos">{STAGES.map((stage) => <div key={stage.category} className="landing-stage-photo" data-step={stage.category}>{photo(stage.photo, "(min-width: 1024px) 700px, 100vw")}</div>)}</div>
        </div>
      </section>
      {display ? <LandingServices catalog={display} phone={phone} messenger={brandConfig.facebookMessengerUrl} status={status} /> : <>
        <section id="services" className="landing-section landing-wrap landing-ground-muted"><h2>Services and prices</h2>{unavailable}<div id="estimate"><h2>Estimate your price</h2>{unavailable}</div></section>
        <section id="coatings" className="landing-coatings"><CoatingsBleed /><div className="landing-wrap landing-compare"><p><a href={brandConfig.facebookMessengerUrl}>Ask about coatings on Messenger</a></p></div></section>
      </>}
      <section id="gallery" className="landing-section landing-wrap landing-gallery" aria-labelledby="landing-gallery-title">
        <h2 id="landing-gallery-title">Gallery</h2>
        <div className="landing-gallery-slots"><p>Gallery photos will appear here.</p><div className="landing-gallery-small" aria-hidden="true" /></div>
      </section>
      <LandingFaq items={faq} />
      <section id="visit" className="landing-section landing-wrap landing-ground-muted">
        <h2>Visit the shop</h2>
        <p className="landing-visit-address">{brandConfig.location}</p>
        <div className="landing-visit">
          <div className="landing-card landing-visit-card">
            <address>{brandConfig.address}</address>
            <p className="landing-muted">Landmark: {brandConfig.landmark}</p>
            <a className="landing-pill landing-outline" href={directions} target="_blank" rel="noreferrer" aria-label="Get directions, opens Google Maps">Get directions</a>
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
