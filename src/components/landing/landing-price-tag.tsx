import type { ServicePackage, VehicleBodyType, VehicleCategory } from "@/types/catalog-contracts";
import { money, servicePrice } from "./landing-model";
import { bestDealPercent, serviceDeal } from "./landing-deals";

// One price line for a service, with the admin promo shown as a discount: the selling price, the regular price struck
// through and a "−N%" badge for the chosen size, or "Up to N% off" before a size is chosen. Screen readers hear
// "Promo price …, regular price …".
export function PriceTag({ service, size, body, id }: { service: ServicePackage; size?: VehicleCategory; body?: VehicleBodyType; id?: string }) {
  const deal = serviceDeal(service, size, body);
  const best = size ? null : bestDealPercent(service);
  const unit = service.unit === "PANEL" ? " per panel" : "";
  return <>
    {(deal || best) && <span className="landing-deal">{deal ? `−${deal.percent}%` : `Up to ${best}% off`}</span>}
    <p className="landing-price" id={id}>{deal
      ? <><span className="landing-sr">Promo price </span>{money(deal.priceCentavos) + unit}<s className="landing-price-was"><span className="landing-sr">, regular price </span>{money(deal.regularCentavos)}</s></>
      : servicePrice(service, size, body)}</p>
  </>;
}
