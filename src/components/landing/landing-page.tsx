import Image from "next/image";
import { ArrowDown, ArrowUpRight, MapPin, MessageCircle, Phone } from "lucide-react";
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
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(brandConfig.mapCoordinates)}`;
  const pausedLine = "Online booking is paused. Call or message us to book.";
  const unknownLine = <>We could not check online booking just now. <a href={tel}>Call the shop</a></>;
  const photo = (slug: string, sizes: string) => { const p = landingPhoto(slug)!; return <Image src={p.src} alt={p.alt} width={1600} height={1200} sizes={sizes} style={p.position ? { objectPosition: p.position } : undefined} />; };
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
          <h1 id="landing-hero-title"><span className="landing-hero-title">Car &amp; motorcycle detailing<span className="landing-gold-dot">.</span></span><span className="landing-sr"> Car and motorcycle detailing in Tacloban City</span></h1>

          <div id="landing-hero-actions" className="landing-actions"><LandingHeroAction href={booking.href} label={booking.label} /><a className="landing-hero-manage" href="/book/manage">Manage booking<ArrowUpRight aria-hidden="true" /></a></div>
          <a className="landing-scroll-cue" href="#about" aria-label="Discover the Zeus approach"><span>Discover Zeus</span><ArrowDown aria-hidden="true" /></a>
        </div>
      </section>
      <section id="about" className="landing-about" aria-labelledby="landing-about-title">
        <div className="landing-about-frame">
          <div className="landing-about-photo">{photo("full-detailing", "100vw")}</div>
          <div className="landing-wrap landing-about-heading">
            <p className="landing-eyebrow">About Zeus</p>
            <h2 id="landing-about-title">Professional care for your vehicle<span className="landing-gold-dot">.</span></h2>
          </div>
        </div>
        <div className="landing-wrap landing-about-copy">
          <p className="landing-about-lead">Car and motorcycle detailing in Tacloban City.</p>
          <p>We handle everything from routine washes to interior and exterior detailing. For owners looking to protect their paint, we also offer graphene coating packages.</p>
          <p>Tell us what you drive and what you want to improve. We can recommend a service based on the condition of your vehicle and how you use it.</p>
          <a className="landing-text-link" href={brandConfig.facebookMessengerUrl}>Ask us about detailing<ArrowUpRight aria-hidden="true" /></a>
        </div>
      </section>
      <section id="concerns" className="landing-concerns" aria-labelledby="landing-concerns-title">
        <div className="landing-concerns-frame">
          <div className="landing-concerns-photo">{photo("signature-wash", "100vw")}</div>
          <div className="landing-wrap landing-concerns-heading">
            <h2 id="landing-concerns-title">Everyday use leaves its mark<span className="landing-gold-dot">.</span></h2>
          </div>
        </div>
        <div className="landing-wrap landing-concern-list">{[
          { title: "Road grime and buildup", text: "Clear away dust, mud and the buildup of everyday driving.", href: "WASH", link: "Wash" },
          { title: "A cabin due for a deep clean", text: "Explore interior detailing for seats, carpets and other surfaces that see daily use.", href: "DETAILING", link: "Detailing" },
          { title: "Paint worth protecting", text: "Compare graphene coating packages for added paint protection.", href: "GRAPHENE", link: "Graphene coating" },
        ].map((item) => (
          <article className="landing-concern" key={item.href}>
            <h3><a href={display ? `#services-${item.href}` : "#services"}>
              <span>{item.link}</span>{item.title}<ArrowUpRight aria-hidden="true" />
            </a></h3>
            <p>{item.text}</p>
          </article>
        ))}</div>
      </section>
      <section id="care" className="landing-section landing-wrap landing-care" aria-labelledby="landing-care-title">
        <div className="landing-section-heading">
          <LandingScrollFloat id="landing-care-title" text="Choose your service." />
        </div>
        <div className="landing-care-grid">{[
          { title: "Wash", text: "Routine cleaning for cars and motorcycles.", category: "WASH", image: "basic-wash", cta: "View wash options" },
          { title: "Detailing", text: "A deeper clean for the interior and exterior.", category: "DETAILING", image: "exterior-detailing", cta: "View detailing options" },
          { title: "Graphene coating", text: "Added protection for your vehicle's paint.", category: "GRAPHENE", image: "eclipse-graphene", cta: "Compare coatings" },
        ].map((service) => (
          <a className="landing-care-card" href={display ? `#services-${service.category}` : "#services"} key={service.category}>
            <div className="landing-care-photo">{photo(service.image, "(max-width: 767px) 100vw, 33vw")}</div>
            <div className="landing-care-content">
              <h3>{service.title}</h3>
              <p>{service.text}</p>
              <span>{service.cta}<ArrowUpRight aria-hidden="true" /></span>
            </div>
          </a>
        ))}</div>
      </section>
      <section id="work" className="landing-section landing-wrap landing-stage" aria-labelledby="landing-work-title">
        <div className="landing-stage-viewport">
          <div className="landing-section-heading">
            <div><h2 id="landing-work-title">What we do in the shop</h2></div>
            <p className="landing-muted">From the first wash to the final coat. Photographed at Zeus.</p>
          </div>
          <div className="landing-stage-track">
            <div className="landing-stage-names">{STAGES.map((stage) => {
              const names = display?.services.filter((service) => service.category === stage.category && service.type === "BASE") ?? [];
              return <article key={stage.category} className="landing-step" data-step={stage.category}>
                <div className="landing-step-photo">{photo(stage.photo, "(min-width: 1024px) 100vw, (max-width: 767px) 100vw, 63vw")}</div>
                <div className="landing-step-copy">
                  <h3 className="landing-step-name">{stage.name}</h3>
                  {names.length > 0 && <ul className="landing-step-links">{names.map((service) => <li key={service.id}><a href={`#service-${service.slug}`}>{service.name}</a></li>)}</ul>}
                  <a className="landing-step-prices" href={display ? `#services-${stage.category}` : "#services"}>See {stage.name.toLowerCase()} prices<ArrowUpRight aria-hidden="true" /></a>
                </div>
              </article>;
            })}</div>
          </div>
          <div className="landing-stage-progress" aria-hidden="true">
            <span className="landing-stage-progress-line"><i /></span>
            <span className="landing-stage-counter"><b data-workshop-shot>01</b><span>/</span>{String(STAGES.length).padStart(2, "0")}</span>
          </div>
        </div>
      </section>
      <LandingReviews />
      {display ? <LandingServices catalog={display} phone={phone} messenger={brandConfig.facebookMessengerUrl} status={status} /> : <>
        <section id="services" className="landing-price-preview" aria-labelledby="landing-price-preview-title">
          <div className="landing-price-preview-photo">{photo("arcane-graphene", "(max-width: 767px) 100vw, 66vw")}</div>
          <div className="landing-wrap landing-price-preview-copy">
            <h2 id="landing-price-preview-title">Services and prices<span className="landing-gold-dot">.</span></h2>
            <div id="estimate" className="landing-price-preview-estimate">
              <p className="landing-price-preview-status">Prices are unavailable right now.</p>
              <p>Tell us what you drive and which service you have in mind for an estimate.</p>
              <div className="landing-price-preview-actions">
                <a className="landing-pill landing-gold" href={brandConfig.facebookMessengerUrl}>Message for an estimate<ArrowUpRight aria-hidden="true" /></a>
                <a className="landing-text-link" href={tel}><Phone aria-hidden="true" />Call {brandConfig.displayPhone}</a>
              </div>
            </div>
          </div>
        </section>
        <section id="coatings" className="landing-coatings"><CoatingsBleed /><div className="landing-wrap landing-compare"><p><a href={brandConfig.facebookMessengerUrl}>Ask about coatings on Messenger</a></p></div></section>
      </>}
      <section id="gallery" className="landing-section landing-wrap landing-gallery" aria-labelledby="landing-gallery-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">A closer look</p><h2 id="landing-gallery-title">The details tell the story<span className="landing-gold-dot">.</span></h2></div><p className="landing-muted">A glimpse of our process, from the final wipe to the care beneath a coating.</p></div>
        <div className="landing-gallery-grid"><figure>{photo("signature-wash", "(max-width: 767px) 100vw, 60vw")}<figcaption>The finishing touch <span>Signature wash</span></figcaption></figure><figure>{photo("eclipse-graphene", "(max-width: 767px) 100vw, 40vw")}<figcaption>Beyond the shine <span>Coating application</span></figcaption></figure></div><div className="landing-gallery-slots"><p>Finished-results gallery <span>Gallery photos will appear here.</span></p></div>
      </section>
      <LandingFaq items={faq} />
      <section id="visit" className="landing-section landing-wrap landing-ground-muted landing-visit" aria-labelledby="landing-visit-title">
        <div className="landing-visit-info">
          <h2 id="landing-visit-title">Visit the shop<span className="landing-gold-dot" aria-hidden="true">.</span></h2>
          <address className="landing-visit-address">
            <strong>{brandConfig.location}</strong>
            <span>{brandConfig.landmark}</span>
          </address>
          <a className="landing-pill landing-solid landing-visit-directions" href={directions} target="_blank" rel="noreferrer" aria-label="Get directions, opens Google Maps">
            <MapPin aria-hidden="true" />Get directions<ArrowUpRight aria-hidden="true" />
          </a>
          <div className="landing-visit-contact">
            <p className="landing-muted">Call or message to confirm shop hours.</p>
            <a className="landing-text-link" href={tel}><Phone aria-hidden="true" />{brandConfig.displayPhone}</a>
            <a className="landing-text-link" href={brandConfig.facebookMessengerUrl}><MessageCircle aria-hidden="true" />Messenger</a>
          </div>
        </div>
        <div className="landing-visit-map">
          <iframe src={brandConfig.mapEmbedUrl} title={`Google Maps location for ${brandConfig.businessName}`} loading="lazy" referrerPolicy="no-referrer" allowFullScreen />
        </div>
      </section>
      <section id="book-your-visit" className="landing-band" aria-labelledby="landing-band-title">
        <div className="landing-band-stage">
          <div className="landing-wrap landing-band-copy">
            <h2 id="landing-band-title" aria-label="Ready for a detail?">
              <span className="landing-band-line" aria-hidden="true"><span>Ready for</span></span>{" "}
              <span className="landing-band-line" aria-hidden="true"><span>a detail<span className="landing-gold-dot">?</span></span></span>
            </h2>
            <div id="landing-closing-cta" className="landing-band-actions">
              <a className="landing-pill landing-gold" href={booking.href}>{booking.label}<ArrowUpRight aria-hidden="true" /></a>
              <a className="landing-text-link" href="/book/manage">Manage booking<ArrowUpRight aria-hidden="true" /></a>
            </div>
            <p className="landing-band-help landing-muted">Questions before you book? <a href={tel}>Call {brandConfig.displayPhone}</a></p>
          </div>
          <div className="landing-band-media">
            {/* Keep the approved workshop image available in the static page. */}
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
        <nav aria-label="Footer"><ul className="landing-footer-links"><li><a href="#about">About</a></li><li><a href="#services">Services</a></li><li><a href="#estimate">Prices</a></li><li><a href="#reviews">Reviews</a></li><li><a href="#visit">Visit</a></li><li><a href="/book/manage">Manage booking</a></li><li><a href="/admin/login">Staff login</a></li><li><a href="#top">Back to top</a></li></ul></nav>
      </div>
      <p className="landing-copyright">© {new Date().getFullYear()} {brandConfig.businessName}</p>
    </div></footer>
    <LandingLifecycle />
  </div>;
}
