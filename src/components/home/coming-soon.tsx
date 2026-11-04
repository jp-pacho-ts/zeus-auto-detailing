import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { comingSoonStyles } from "./coming-soon.styles";
import { HomeIntro } from "./home-intro";
import { HOME_INTRO_PREPAINT, HOME_INTRO_PREPAINT_ID } from "./home-intro-prepaint";
import { HomeVideo } from "./home-video";

export function ComingSoon() {
  const phone = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brandConfig.locationFull)}`;
  // The pre-paint script must stay before the curtain and content so it runs before they first paint.
  return <><style>{comingSoonStyles}</style><script id={HOME_INTRO_PREPAINT_ID} dangerouslySetInnerHTML={{ __html: HOME_INTRO_PREPAINT }} /><HomeIntro>
    <div className="zeus-coming-soon">
      <main className="zeus-hero" id="home" aria-labelledby="coming-soon-title">
        <HomeVideo />
        <div className="zeus-hero-shade" aria-hidden="true" />
        <div className="zeus-hero-copy">
          <div className="zeus-hero-logo"><Image src={brandConfig.logoUrl} alt={brandConfig.businessName} width={715} height={275} priority sizes="(max-width: 800px) 200px, 280px" className="zeus-coming-soon__logo" /></div>
          <p className="zeus-pretitle">Our new website. In progress.</p>
          <h1 id="coming-soon-title" aria-label="Coming soon">Coming<br />soon<span>.</span></h1>
          <div className="zeus-description"><p><strong>Our website is getting a new look.<br />The shop is open as usual.</strong></p><p>For paint correction, ceramic protection, and other detailing inquiries, get in touch with our team.</p></div>
          <div className="zeus-actions"><a className="zeus-coming-soon__call" href={phone}><span>Call the shop</span><strong>{brandConfig.displayPhone}</strong></a><a className="zeus-facebook" href={brandConfig.facebookPageUrl} target="_blank" rel="noopener noreferrer">Find us on Facebook <ArrowUpRight aria-hidden="true" size={18} /></a></div>
          <p className="zeus-contact-line"><a href={map} target="_blank" rel="noopener noreferrer">{brandConfig.location}</a><span aria-hidden="true"> · </span><a href={phone}>{brandConfig.displayPhone}</a></p>
        </div>
      </main>
    </div>
  </HomeIntro></>;
}
