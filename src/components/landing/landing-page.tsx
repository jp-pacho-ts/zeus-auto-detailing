import { brandConfig } from "@/config/brand";
import type { BookingCatalog } from "@/types/catalog-contracts";
import type { LandingStatus } from "@/server/landing/status";
import { LandingHeader } from "./landing-header";
import { LandingVideo } from "./landing-video";
import { LandingLifecycle } from "./landing-lifecycle";
import { LandingServices, type DisplayCatalog } from "./landing-services";
import { servicePrice } from "./landing-model";
import "./landing.css";

export function LandingPage({ catalog, status }: { catalog: BookingCatalog | null; status: LandingStatus }) {
  const phone = brandConfig.contactPhone.replace(/\s/g, "");
  const label = status === "OPEN" ? "Book an appointment" : status === "PAUSED" ? "Call to book" : "Check online booking";
  const href = status === "PAUSED" ? `tel:${phone}` : "/book";
  // Explicit public display projection; release identifiers never cross into the client component props.
  const display: DisplayCatalog | null = catalog ? { vehicleCategories: catalog.vehicleCategories, services: catalog.services.map((service) => ({ ...service, productName: null, hardness: null, warrantyMonths: null })), addOnCompatibility: catalog.addOnCompatibility } : null;
  const coatings = catalog?.services.filter((s) => ["GRAPHENE", "TINT", "PPF"].includes(s.category)) ?? [];
  const inclusions = [...new Set(coatings.flatMap((s) => s.category === "GRAPHENE" ? s.inclusions : []))];
  const cta = <a className="landing-button" href={href}>{label}</a>;
  return <div className="landing" data-landing-preview>
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <div className="landing-preview-note">Website preview - some sections are still coming soon</div>
    <LandingHeader logo={brandConfig.logoUrl} label={label} href={href} phone={phone} />
    <main id="landing-main"><section id="top" className="landing-hero"><LandingVideo /><div className="landing-hero-copy"><p className="landing-eyebrow">{brandConfig.businessName} · Tacloban City</p><h1>{brandConfig.tagline}</h1><p className="landing-lede">Washes, detailing, coating, tint, PPF and repaint. For cars and motorcycles in Tacloban City.</p><div id="landing-hero-actions" className="landing-actions">{cta}<a className="landing-button landing-secondary" href="#services">See services and prices</a></div>{status !== "OPEN" && <p className="landing-status">{status === "PAUSED" ? "Online booking is paused. Call or message us to book." : "Online booking status could not be checked."} {status === "UNKNOWN" && <a href={`tel:${phone}`}>Call the shop</a>}</p>}<p className="landing-hero-address">{brandConfig.location}<br />Call to confirm hours</p></div></section>
      {display ? <LandingServices catalog={display} phone={phone} messenger={brandConfig.facebookMessengerUrl} bookingLabel={label} bookingLink={href} /> : <section id="services" className="landing-section landing-wrap"><h2>Services and prices</h2><p>Prices are unavailable right now. <a href={`tel:${phone}`}>Call {brandConfig.displayPhone}</a>.</p><div id="estimate"><h3>Estimate your price</h3><p>The current price list is needed for an estimate. Try again later.</p></div></section>}
      <section id="coatings" className="landing-section landing-coatings"><div className="landing-wrap"><p className="landing-eyebrow">Explore the options</p><h2>Coatings and films</h2><p className="landing-dependency-label">Ask us which products suit your vehicle.</p><div className="landing-coating-grid">{coatings.filter((s) => s.type === "BASE" && s.category === "GRAPHENE").map((s) => <article className="landing-coating-card" key={s.id}><span className="landing-hex" aria-hidden="true">⬡</span><h3>{s.name}</h3><p className="landing-price">{servicePrice(s)}</p><p>Ask about product options for your vehicle.</p></article>)}</div><h3>Tint and paint protection film</h3><ul>{coatings.filter((s) => s.category !== "GRAPHENE" && s.type === "BASE").map((s) => <li key={s.id}>{s.name}</li>)}</ul>{inclusions.length > 0 && <details><summary>Inclusions listed in the catalog</summary><ul className="landing-inclusions">{inclusions.map((item) => <li key={item}>{item}</li>)}</ul></details>}<p>Speak with the shop about products, care and options for your vehicle.</p><a href={brandConfig.facebookMessengerUrl}>Ask about coatings and films ↗</a></div></section>
      <section id="gallery" className="landing-section landing-wrap landing-dependency"><p className="landing-eyebrow">Coming soon</p><h2>Gallery</h2><div className="landing-photo-frames" aria-label="Gallery layout awaiting approved shop photographs"><div>Shop photos coming soon</div><div>Service photos coming soon</div><div>Before / after photos coming soon</div></div><p>Photos of our work are coming soon.</p></section>
      <section id="reviews" className="landing-section landing-wrap landing-dependency"><p className="landing-eyebrow">Coming soon</p><h2>Reviews</h2><p className="landing-review-frame">Customer feedback</p><p>Customer reviews are coming soon.</p></section>
      <section id="about" className="landing-section landing-wrap landing-about"><div><p className="landing-eyebrow">Meet Zeus</p><h2>Here in<br />Tacloban City.</h2></div><div><p>{brandConfig.businessName}</p><p>{brandConfig.address}</p><p>Find us at {brandConfig.landmark}.</p><p className="landing-dependency-label">Our story is coming soon.</p></div></section>
      <section id="visit" className="landing-section landing-visit"><div className="landing-wrap landing-visit-grid"><div><p className="landing-eyebrow">Come by the shop</p><h2>Visit Zeus</h2><address>{brandConfig.address}</address><p>{brandConfig.landmark}</p><a className="landing-button landing-secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.address)}`} target="_blank" rel="noreferrer">Get directions ↗</a></div><div><h3>Opening hours</h3><p>Call to confirm hours</p><div className="landing-actions">{cta}<a href={`tel:${phone}`}>Call {brandConfig.displayPhone}</a></div><p><a href={brandConfig.facebookMessengerUrl}>Message Zeus</a> · <a href={brandConfig.instagram}>Instagram</a> · <a href="/book/manage">Manage booking</a></p></div></div></section>
    </main><footer className="landing-wrap landing-footer"><p>{brandConfig.businessName} · {new Date().getFullYear()}</p><a href="/book/manage">Manage booking</a><a href="/admin/login">Staff login</a><a href="#top">Back to top ↑</a></footer><LandingLifecycle />
  </div>;
}
