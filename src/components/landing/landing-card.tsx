import type { ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight, Hexagon } from "lucide-react";
import type { LandingPhoto } from "./landing-photos";

// One card shape for the services (P1-90 identity 6.4): a 4:5 photo with its chips on it, fading into the card body.
// No hooks, so it renders on the server or inside the client services.
export function LandingCard({ anchor, chip, duration, title, level = 4, price, priceId, arrow, action, photo, children }: {
  anchor?: string; chip: string; duration?: string | null; title: string; level?: 3 | 4; price: string; priceId?: string;
  arrow: { href: string; label: string }; action?: ReactNode; photo?: LandingPhoto; children?: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return <article id={anchor} className="landing-card landing-service-card">
    {/* D1: labelled frame where the owner has not supplied a photo of this service yet. Cards sit below the hero: lazy, no priority. */}
    <div className={photo?.contain ? "landing-photo landing-photo-contain" : "landing-photo"}><span className="landing-chips"><span className="landing-chip">{chip}</span>{duration && <span className="landing-chip">{duration}</span>}</span>
      {photo ? <Image src={photo.src} alt={photo.alt} width={1600} height={1200} sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 400px" style={photo.position ? { objectPosition: photo.position } : undefined} /> : <><Hexagon aria-hidden="true" strokeWidth={1.25} /><span>Photo coming soon</span></>}</div>
    <div className="landing-card-body">
      <Heading>{title}</Heading>
      <p className="landing-price" id={priceId}>{price}</p>
      {children}
      <div className="landing-card-actions">{action}<a className="landing-arrow" href={arrow.href} aria-label={arrow.label}><ArrowUpRight aria-hidden="true" /></a></div>
    </div>
  </article>;
}
