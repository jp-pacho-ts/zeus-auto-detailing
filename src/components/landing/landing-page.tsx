import Image from "next/image";
import { ArrowDown, ArrowUpRight, Check, CircleAlert, Info, MapPin, MessageCircle, Phone, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { brandConfig } from "@/config/brand";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { LandingStatus } from "@/server/landing/status";
import { LandingHeader } from "./landing-header";
import { LandingHeroAction } from "./landing-hero-action";
import { LandingReviews } from "./landing-reviews";
import { LandingVideo } from "./landing-video";
import { LandingScrollFloat } from "./landing-scroll-float";
import { LandingLifecycle } from "./landing-lifecycle";
import { CoatingsBleed, LandingServices, type DisplayCatalog } from "./landing-services";
import { LandingFaq } from "./landing-faq";
import { landingPhoto } from "./landing-photos";
import { bookingAction } from "./landing-model";
import "./landing.css";

// Each care category uses its own approved work photo; these are alternatives, not a fixed process.
const STAGES = [
  { category: "WASH", name: "Wash", photo: "signature-wash" },
  { category: "DETAILING", name: "Detailing", photo: "exterior-detailing" },
  { category: "GRAPHENE", name: "Graphene", photo: "arcane-graphene" },
] as const;

// Contact and pricing facts come from brandConfig and the current catalog.
export function LandingPage({ catalog, status }: { catalog: BookingCatalog | null; status: LandingStatus }) {
  const phone = brandConfig.contactPhone.replace(/\s/g, "");
  const tel = `tel:${phone}`;
  const booking = bookingAction();
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
    <div className="landing-preview-note">Website preview</div>
    <div className="landing-progress" aria-hidden="true" />
    <LandingHeader logo={brandConfig.logoUrl} label={booking.label} href={booking.href} />
    <main id="landing-main">
      <section id="top" className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero-art">
          <span className="landing-word" aria-hidden="true">{"ZEUS".split("").map((letter, index) => <span className="landing-letter-mask" key={index}><span className="landing-letter">{letter}</span></span>)}</span>
          <div className="landing-hero-beam" aria-hidden="true" />
          <div className="landing-hero-photo"><LandingVideo /></div>
        </div>
        <div className="landing-wrap landing-hero-copy">
          <h1 id="landing-hero-title"><span className="landing-hero-title">Care beyond the surface<span className="landing-gold-dot">.</span></span><span className="landing-sr"> Car and motorcycle detailing in Tacloban City</span></h1>
          <p className="landing-lede">Car &amp; motorcycle detailing.</p>
          <div id="landing-hero-actions" className="landing-actions"><LandingHeroAction href={booking.href} label={booking.label} /><a className="landing-pill landing-outline" href="/book/manage">Manage booking<ArrowUpRight aria-hidden="true" /></a></div>
          {status === "PAUSED" && <p className="landing-status"><Info aria-hidden="true" /><span>{pausedLine}</span></p>}
          {status === "UNKNOWN" && <p className="landing-status"><Info aria-hidden="true" /><span>{unknownLine}</span></p>}
          <a className="landing-scroll-cue" href="#about" aria-label="Discover the Zeus approach"><span>Discover Zeus</span><ArrowDown aria-hidden="true" /></a>
        </div>
      </section>
      <div className="landing-facts landing-wrap" aria-label="Zeus at a glance"><div><span>Built around your vehicle</span><strong>Cars &amp; motorcycles</strong></div><div><span>Your local detailing shop</span><strong>Tacloban City</strong></div><div><span>A clearer starting point</span><strong>Size-specific pricing</strong></div></div>
      <section id="about" className="landing-section landing-wrap landing-about" aria-labelledby="landing-about-title"><div className="landing-editorial-photo">{photo("full-detailing", "(max-width: 767px) 100vw, 50vw")}<span className="landing-photo-caption">In the shop. In the details.</span></div><div className="landing-about-copy"><p className="landing-eyebrow">01 / The Zeus approach</p><h2 id="landing-about-title">For the pride<br />in every drive<span className="landing-gold-dot">.</span></h2><p>Your vehicle is part of your everyday life. Looking after it should feel just as considered.</p><p className="landing-muted">At Zeus, car and motorcycle care brings together washing, detailing and surface protection in one Tacloban shop. Start with what your vehicle needs today. We&apos;ll help you understand the next step.</p><a className="landing-text-link" href={brandConfig.facebookMessengerUrl}>Talk to us about your vehicle<ArrowUpRight aria-hidden="true" /></a></div></section>
      <section id="care" className="landing-section landing-wrap landing-care" aria-labelledby="landing-care-title"><div className="landing-section-heading"><div><p className="landing-eyebrow">02 / Find your care</p><LandingScrollFloat id="landing-care-title" text="Different needs. The same attention." /></div><p className="landing-muted">A regular clean, a deeper reset or the next layer of protection. Choose your starting point.</p></div><div className="landing-care-grid">{[
        { icon: Waves, title: "Refresh", text: "For the everyday drive. Explore washes for your car or motorcycle.", link: "WASH", cta: "Explore washes" },
        { icon: Sparkles, title: "Restore", text: "Go beyond the wash. Find detailing options for a more considered reset.", link: "DETAILING", cta: "Explore detailing" },
        { icon: ShieldCheck, title: "Protect", text: "Plan the next step for your finish. Compare graphene packages and their inclusions.", link: "GRAPHENE", cta: "Explore protection" },
      ].map(({ icon: Icon, title, text, link, cta }) => <a className="landing-care-card" href={display ? `#services-${link}` : "#services"} key={title}><Icon aria-hidden="true" /><h3>{title}</h3><p>{text}</p><span>{cta}<ArrowUpRight aria-hidden="true" /></span></a>)}</div></section>
      <section id="work" className="landing-section landing-wrap landing-stage" aria-labelledby="landing-work-title">
        <div className="landing-stage-viewport">
        <span className="landing-stage-wipe" aria-hidden="true" />
        <span className="landing-stage-backdrop" aria-hidden="true">IN THE DETAILS</span>
        <div className="landing-section-heading"><div><p className="landing-eyebrow">03 / Inside the workshop</p><h2 id="landing-work-title">What we do in the shop</h2></div><p className="landing-muted">Real work, photographed at Zeus. A closer look at the care behind the finish.</p></div>
        <div className="landing-stage-grid">
          <div className="landing-stage-names">{STAGES.map((stage) => {
            const names = display?.services.filter((s) => s.category === stage.category && s.type === "BASE") ?? [];
            return <div key={stage.category} className="landing-step" data-step={stage.category}>
              <h3 className="landing-step-name">{stage.name}</h3>
              {/* One responsive photograph per category, shared by desktop and phone. */}
              <div className="landing-step-photo">{photo(stage.photo, "(max-width: 767px) 100vw, 60vw")}</div>
              {names.length > 0 && <ul className="landing-step-links">{names.map((s) => <li key={s.id}><a href={`#service-${s.slug}`}>{s.name}</a></li>)}</ul>}
              <a className="landing-step-prices" href={display ? `#services-${stage.category}` : "#services"}>See {stage.name.toLowerCase()} prices<ArrowUpRight aria-hidden="true" /></a>
            </div>;
          })}</div>
        </div>
        <div className="landing-stage-progress" aria-hidden="true"><span><i /></span><p>Wash <b /> Detailing <b /> Graphene</p></div>
        </div>
      </section>
      {display ? <LandingServices catalog={display} phone={phone} messenger={brandConfig.facebookMessengerUrl} status={status} /> : <>
        <section id="services" className="landing-section landing-wrap landing-ground-muted"><p className="landing-eyebrow">04 / Care, made clear</p><h2>Services and prices</h2><p className="landing-muted">Choose care that fits your vehicle. Prices and package options will appear when the catalog is available.</p>{unavailable}<div id="estimate" className="landing-unavailable-estimate"><h3>Estimate your price</h3><p>Tell us your vehicle and the care you have in mind.</p><a className="landing-text-link" href={brandConfig.facebookMessengerUrl}>Ask for an estimate<ArrowUpRight aria-hidden="true" /></a></div></section>
        <section id="coatings" className="landing-coatings"><CoatingsBleed /><div className="landing-wrap landing-compare"><p><a href={brandConfig.facebookMessengerUrl}>Ask about coatings on Messenger</a></p></div></section>
      </>}
      <section id="gallery" className="landing-section landing-wrap landing-gallery" aria-labelledby="landing-gallery-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">A closer look</p><h2 id="landing-gallery-title">The details tell the story<span className="landing-gold-dot">.</span></h2></div><p className="landing-muted">A glimpse of our process, from the final wipe to the care beneath a coating.</p></div>
        <div className="landing-gallery-grid"><figure>{photo("signature-wash", "(max-width: 767px) 100vw, 60vw")}<figcaption>The finishing touch <span>Signature wash</span></figcaption></figure><figure>{photo("eclipse-graphene", "(max-width: 767px) 100vw, 40vw")}<figcaption>Beyond the shine <span>Coating application</span></figcaption></figure></div><div className="landing-gallery-slots"><p>Finished-results gallery <span>Gallery photos will appear here.</span></p></div>
      </section>
      <LandingReviews />
      <LandingFaq items={faq} />
      <section id="visit" className="landing-section landing-wrap landing-ground-muted">
        <p className="landing-eyebrow">06 / Come find us</p>
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
        <p className="landing-visit-note"><Check aria-hidden="true" /> Not sure which service fits? Call or message us before your visit.</p>
      </section>
      <section className="landing-band" aria-labelledby="landing-band-title">
        <div className="landing-band-stage">
          <div className="landing-wrap landing-band-copy">
            <span className="landing-hairline" aria-hidden="true" />
            <p className="landing-eyebrow">Your next drive starts here</p><h2 id="landing-band-title" className="landing-band-line">Give your vehicle<br />the attention it deserves<span className="landing-gold-dot">.</span></h2>
            <p className="landing-band-line landing-muted">{status === "PAUSED" ? pausedLine : status === "UNKNOWN" ? unknownLine : `Planning a visit? Book online, or call ${brandConfig.displayPhone} to ask about hours and prices.`}</p>
            <div id="landing-closing-cta" className="landing-actions landing-band-line">{gold()}<a href={tel}>Call {brandConfig.displayPhone}</a></div>
          </div>
          <div className="landing-band-media">
            {/* Approved workshop derivative; the closing CTA stays readable over a static scrim. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/media/landing/full-detailing.webp" alt="Detailer machine-polishing the hood of a white pickup" width="1600" height="1200" loading="lazy" decoding="async" />
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
