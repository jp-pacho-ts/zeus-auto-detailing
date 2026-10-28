import Image from "next/image";
import { ArrowUpRight, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { comingSoonStyles } from "./coming-soon.styles";

// Server-rendered static fallback; the entrance animation needs no JavaScript.
export function ComingSoon() {
  return (
    <main className="zeus-coming-soon" aria-labelledby="coming-soon-title">
      <style>{comingSoonStyles}</style>
      <div className="zeus-coming-soon__brand">
        <Image src={brandConfig.logoUrl} alt={brandConfig.businessName} width={715} height={275}
          priority sizes="(max-width: 767px) 90vw, 1088px" className="zeus-coming-soon__logo" />
      </div>
      <div className="zeus-coming-soon__notice">
        <h1 id="coming-soon-title"><span>Our new website.</span><span>Coming soon.</span></h1>
        <div className="zeus-coming-soon__contact">
          <p>The shop is open. For detailing inquiries and appointments, contact our team.</p>
          <a className="zeus-coming-soon__call" href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}>
            <Phone size={20} aria-hidden="true" />
            <span>Call the shop <span className="zeus-coming-soon__phone">{brandConfig.displayPhone}</span></span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </a>
        </div>
      </div>
      <footer className="zeus-coming-soon__footer">
        <p>{brandConfig.location}</p>
        <a href={brandConfig.facebookPageUrl} target="_blank" rel="noopener noreferrer">
          Find us on Facebook <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}
