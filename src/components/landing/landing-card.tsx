import type { ReactNode } from "react";
import { ArrowUpRight, Hexagon } from "lucide-react";

// One card shape for services, coatings (17.4). No hooks, so it renders on the server or inside the client services.
export function LandingCard({ chip, duration, title, level = 4, price, priceId, arrow, action, children }: {
  chip: string; duration?: string | null; title: string; level?: 3 | 4; price: string; priceId?: string;
  arrow: { href: string; label: string }; action?: ReactNode; children?: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return <article className="landing-card landing-reveal">
    <div className="landing-chips"><span className="landing-chip">{chip}</span>{duration && <span className="landing-chip">{duration}</span>}</div>
    {/* D1: labelled frame until the owner supplies real photos of this work. */}
    <div className="landing-photo"><Hexagon aria-hidden="true" strokeWidth={1.25} /><span>Photo coming soon</span></div>
    <Heading>{title}</Heading>
    <p className="landing-price" id={priceId}>{price}</p>
    <div className="landing-card-actions">{action}<a className="landing-arrow" href={arrow.href} aria-label={arrow.label}><ArrowUpRight aria-hidden="true" /></a></div>
    {children}
  </article>;
}
