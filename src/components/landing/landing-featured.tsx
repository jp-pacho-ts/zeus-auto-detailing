import type { ServicePackage, VehicleCategory } from "@/types/catalog-contracts";
import { bookingAction, money } from "./landing-model";
import { bestDealPercent, bestSavingCentavos, featuredServices, serviceDeal } from "./landing-deals";
import { landingPhoto } from "./landing-photos";
import { CATEGORY_LABEL, servicePage } from "./landing-pages";
import { LandingShowroom, type ShowroomPick } from "./landing-showroom";

const CATEGORY_PHOTO = { WASH: "basic-wash", DETAILING: "exterior-detailing", GRAPHENE: "eclipse-graphene" } as Record<string, string>;

// LE 2026-11-20: shows clients the best services for them (featuredServices: promos first, then the shop's lead service
// per category) as a showroom, one pick at a time. Everything here comes from the catalog the server loaded; the
// client component only presents it. No priced services, no section.
export function LandingFeatured({ services, sizes }: { services: ServicePackage[]; sizes: VehicleCategory[] }) {
  const picks: ShowroomPick[] = featuredServices(services).map((service) => {
    const photo = landingPhoto(service.slug) ?? landingPhoto(CATEGORY_PHOTO[service.category] ?? "");
    const priced = sizes.flatMap((size) => {
      const offer = service.offers.find((o) => o.vehicleCategoryId === size.id);
      return offer?.state === "OFFERED" && offer.onlineBooking === "PRICED" ? [{ size, offer }] : [];
    });
    const saving = bestSavingCentavos(service);
    return {
      id: service.id, name: service.name, kind: CATEGORY_LABEL[service.category], description: service.description,
      photo: photo && { src: photo.src, alt: photo.alt, position: photo.position },
      percent: bestDealPercent(service), saving: saving === null ? null : money(saving),
      rows: priced.map(({ size, offer }) => {
        const deal = serviceDeal(service, size, "SUV");
        return { size: size.name, price: money(deal ? deal.priceCentavos : offer.unitPriceCentavos), regular: deal ? money(deal.regularCentavos) : null };
      }),
      details: servicePage(service.slug),
    };
  });
  if (!picks.length) return null;
  return <section id="featured" className="landing-section landing-featured" aria-labelledby="landing-featured-title">
    <div className="landing-wrap landing-featured-head">
      <p className="landing-eyebrow">Featured services</p>
      <h2 id="landing-featured-title">Top picks for your car<span className="landing-gold-dot">.</span></h2>
    </div>
    {/* Full width: the showroom is a stage, not a card. */}
    <LandingShowroom picks={picks} booking={bookingAction()} />
  </section>;
}
