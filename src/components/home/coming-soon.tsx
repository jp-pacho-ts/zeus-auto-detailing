import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { comingSoonStyles } from "./coming-soon.styles";
import { CurrentYear } from "./current-year";
import { HomeIntro } from "./home-intro";
import { HOME_INTRO_PREPAINT, HOME_INTRO_PREPAINT_ID } from "./home-intro-prepaint";

export function ComingSoon() {
  const phone = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;
  // The pre-paint script must stay before the curtain and content so it runs before they first paint.
  return <><style>{comingSoonStyles}</style><script id={HOME_INTRO_PREPAINT_ID} dangerouslySetInnerHTML={{ __html: HOME_INTRO_PREPAINT }} /><HomeIntro>
    <div className="zeus-coming-soon">
      <header className="zeus-home-header">
        <a href="#home" aria-label="Zeus Auto Detailing home"><Image src={brandConfig.logoUrl} alt={brandConfig.businessName} width={715} height={275} priority sizes="180px" className="zeus-coming-soon__logo" /></a>
        <div><span className="zeus-home-city">Tacloban City, Philippines</span><a href={phone}>Contact the shop <ArrowUpRight aria-hidden="true" size={18} /></a></div>
      </header>
      <main className="zeus-hero" id="home" aria-labelledby="coming-soon-title">
        <div className="zeus-hero-photo" aria-hidden="true"><Image src="/images/home/automotive.jpg" alt="" fill priority sizes="(max-width: 800px) 100vw, 75vw" /></div>
        <div className="zeus-hero-copy">
          <p className="zeus-kicker">ZEUS AUTO DETAILING</p>
          <p className="zeus-pretitle">Our new website. In progress.</p>
          <h1 id="coming-soon-title" aria-label="Coming soon">Coming<br />soon<span>.</span></h1>
          <div className="zeus-description"><p><strong>Our website is getting a new look.<br />The shop is open as usual.</strong></p><p>For paint correction, ceramic protection, and other detailing inquiries, get in touch with our team.</p></div>
          <div className="zeus-actions"><a className="zeus-coming-soon__call" href={phone}><span>Call the shop</span><strong>{brandConfig.displayPhone}</strong></a><a className="zeus-facebook" href={brandConfig.facebookPageUrl} target="_blank" rel="noopener noreferrer">Find us on Facebook <ArrowUpRight aria-hidden="true" size={18} /></a></div>
        </div>
        <p className="zeus-photo-caption">Auto detailing / Paint correction / Ceramic protection</p>
        <figure className="zeus-craft"><Image src="/images/home/polishing.jpg" alt="Machine polishing a vehicle panel" width={700} height={394} sizes="(max-width: 800px) 180px, 280px" /><figcaption>The detailing work continues <span>Paint correction</span></figcaption></figure>
      </main>
      <section className="zeus-contact-band" aria-label="Shop contact information"><div><strong>The studio is open</strong><p>Appointments & inquiries by phone</p></div><div><span>Visit us</span><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.locationFull)}`} target="_blank" rel="noopener noreferrer">{brandConfig.location}</a></div><div><span>Contact</span><a href={phone}>{brandConfig.displayPhone}</a></div></section>
      <footer className="zeus-coming-soon__footer"><span>© <CurrentYear buildYear={new Date().getFullYear()} /> {brandConfig.businessName}</span><span>Built around the details.</span><a href="https://unsplash.com" target="_blank" rel="noopener noreferrer">Photography: Unsplash</a></footer>
    </div>
  </HomeIntro></>;
}
