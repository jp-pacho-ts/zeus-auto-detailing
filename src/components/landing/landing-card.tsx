import type { ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { LandingPhoto } from "./landing-photos";

// priceTag: the <PriceTag> line (price, plus the promo discount when one is set in admin).
export function LandingCard({ anchor, addOn, duration, title, priceTag, arrow, action, photo, children }: {
  anchor: string; addOn: boolean; duration?: string | null; title: string; priceTag: ReactNode;
  arrow: { href: string; label: string }; action?: ReactNode; photo?: LandingPhoto; children?: ReactNode;
}) {
  const heading = <div className="landing-service-heading">
    <h4>{title}</h4>
    {priceTag}
    {(addOn || duration) && <ul className="landing-service-meta">{addOn && <li>Add-on</li>}{duration && <li>{duration}</li>}</ul>}
  </div>;
  return <article id={anchor} className={`landing-service-card${photo ? " landing-service-card--photo" : " landing-service-card--compact"}`}>
    {photo ? <div className={photo.contain ? "landing-photo landing-photo-contain" : "landing-photo"}>
      <Image src={photo.src} alt={photo.alt} width={1600} height={1200} sizes="(max-width: 767px) 100vw, (max-width: 1264px) 50vw, 600px" style={photo.position ? { objectPosition: photo.position } : undefined} />
      {heading}
    </div> : heading}
    {children && <div className="landing-card-body">{children}</div>}
    <div className="landing-card-actions">{action}<a className="landing-arrow" href={arrow.href} aria-label={arrow.label}><ArrowUpRight aria-hidden="true" /></a></div>
  </article>;
}
