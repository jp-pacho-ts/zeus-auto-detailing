import type { ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight, Hexagon } from "lucide-react";
import type { LandingPhoto } from "./landing-photos";

// One card shape for services, coatings (17.4). No hooks, so it renders on the server or inside the client services.
export function LandingCard({ chip, duration, title, level = 4, price, priceId, arrow, action, photo, children }: {
  chip: string; duration?: string | null; title: string; level?: 3 | 4; price: string; priceId?: string;
  arrow: { href: string; label: string }; action?: ReactNode; photo?: LandingPhoto; children?: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return <article className="landing-card landing-reveal">
    <div className="landing-chips"><span className="landing-chip">{chip}</span>{duration && <span className="landing-chip">{duration}</span>}</div>
    {/* D1: labelled frame where the owner has not supplied a photo of this service yet. Cards sit below the hero: lazy, no priority. */}
    <div className="landing-photo">{photo ? <Image src={photo.src} alt={photo.alt} width={1600} height={1200} sizes="(max-width: 767px) 100vw, (max-width: 1199px) 50vw, 400px" /> : <><Hexagon aria-hidden="true" strokeWidth={1.25} /><span>Photo coming soon</span></>}</div>
    <Heading>{title}</Heading>
    <p className="landing-price" id={priceId}>{price}</p>
    <div className="landing-card-actions">{action}<a className="landing-arrow" href={arrow.href} aria-label={arrow.label}><ArrowUpRight aria-hidden="true" /></a></div>
    {children}
  </article>;
}
