import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingCatalog, ServicePackage, VehicleCategory } from "@/types/catalog-contracts";
import { bestDealPercent, bestSavingCentavos, featuredDeals, featuredServices, serviceDeal } from "./landing-deals";
import { PriceTag } from "./landing-price-tag";
import { categoryPage, servicePage } from "./landing-pages";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");

// LE 2026-11-20: promos set in admin (promo price saved as the selling price, regular price as compare-at) show as
// discounts on the landing page, and services on promo are featured. Never overstate a saving.
const offer = (vehicleCategoryId: string, unitPriceCentavos: number, compareAtCentavos: number | null = null, extra: object = {}) =>
  ({ vehicleCategoryId, onlineBooking: "PRICED", state: "OFFERED", bookingMode: "FIXED_ONLINE", unitPriceCentavos, compareAtCentavos, duration: { kind: "UNKNOWN" }, ...extra });
const service = (slug: string, offers: unknown[], type = "BASE") => ({ id: slug, slug, name: slug, category: "WASH", type, unit: "VEHICLE", description: null, inclusions: [], offers }) as unknown as ServicePackage;
const small = { id: "s", code: "S", name: "Small" } as VehicleCategory;
const large = { id: "l", code: "L", name: "Large" } as VehicleCategory;

test("a size's deal is its promo price against the regular price, rounded down so it never overstates", () => {
  const wash = service("wash", [offer("s", 85000, 100000), offer("l", 120000)]);
  assert.deepEqual(serviceDeal(wash, small), { priceCentavos: 85000, regularCentavos: 100000, percent: 15 });
  assert.equal(serviceDeal(wash, large), null, "no compare-at, no deal");
  assert.equal(serviceDeal(wash), null, "no size chosen, no single price to discount");
  assert.equal(serviceDeal(service("odd", [offer("s", 66700, 100000)]), small)?.percent, 33, "33.3% shows as 33");
});

test("no deal for a compare-at that is not higher, a quote-only or unconfirmed offer, or a pickup price", () => {
  assert.equal(serviceDeal(service("same", [offer("s", 100000, 100000)]), small), null);
  assert.equal(serviceDeal(service("quote", [offer("s", 85000, 100000, { onlineBooking: "FOR_QUOTE" })]), small), null);
  assert.equal(serviceDeal(service("unconfirmed", [offer("s", 85000, 100000, { state: "UNCONFIRMED" })]), small), null);
  assert.equal(serviceDeal(service("tiny", [offer("s", 99950, 100000)]), small), null, "under 1% is not a deal");
  const truck = service("truck", [offer("l", 150000, 200000, { pickupPriceCentavos: 180000 })]);
  assert.equal(serviceDeal(truck, large, "PICKUP"), null, "compare-at covers the standard price only");
  assert.equal(serviceDeal(truck, large), null, "body not chosen: the shown price may be the pickup price");
  assert.deepEqual(serviceDeal(truck, large, "SUV"), { priceCentavos: 150000, regularCentavos: 200000, percent: 25 });
});

test("the best percent across sizes drives 'Up to' and the featured order; add-ons and services without promos are not featured", () => {
  const wash = service("wash", [offer("s", 85000, 100000), offer("l", 120000, 200000)]);
  const coat = service("coat", [offer("s", 900000, 1000000)]);
  const plain = service("plain", [offer("s", 50000)]);
  const addOn = service("addon", [offer("s", 10000, 50000)], "ADD_ON");
  assert.equal(bestDealPercent(wash), 40);
  assert.equal(bestSavingCentavos(wash), 80000, "largest peso saving on any size (Large: ₱2,000 → ₱1,200)");
  assert.equal(bestSavingCentavos(plain), null);
  assert.equal(bestDealPercent(plain), null);
  assert.deepEqual(featuredDeals([plain, coat, addOn, wash]).map((s) => s.slug), ["wash", "coat"]);
  assert.deepEqual(featuredDeals([plain]), []);
  assert.equal(featuredDeals(Array.from({ length: 5 }, (_, i) => service(`w${i}`, [offer("s", 85000, 100000)]))).length, 3, "at most three");
});

test("top picks: promos first, then the lead priced main service of each category in catalog order, three at most", () => {
  const kind = (s: ServicePackage, category: string) => ({ ...s, category }) as ServicePackage;
  const washA = kind(service("wash-a", [offer("s", 50000)]), "WASH"), washB = kind(service("wash-b", [offer("s", 60000)]), "WASH");
  const detail = kind(service("detail", [offer("s", 300000)]), "DETAILING"), coat = kind(service("coat", [offer("s", 900000, 1000000)]), "GRAPHENE");
  const tint = kind(service("tint", [offer("s", 200000)]), "TINT"), quote = kind(service("quote", [offer("s", 1, null, { onlineBooking: "FOR_QUOTE" })]), "DETAILING");
  assert.deepEqual(featuredServices([washA, washB, quote, detail, coat, tint]).map((s) => s.slug), ["coat", "wash-a", "detail"]);
  assert.deepEqual(featuredServices([tint, washB]).map((s) => s.slug), ["wash-b", "tint"]);
  assert.deepEqual(featuredServices([quote]), [], "no online price, no pick");
});

test("a price line shows the promo price, the struck regular price and the badge, and reads as promo then regular", () => {
  const wash = service("wash", [offer("s", 85000, 100000), offer("l", 120000)]);
  const sized = renderToStaticMarkup(createElement(PriceTag, { service: wash, size: small, id: "p" }));
  assert.match(sized, /<span class="landing-deal">−15%<\/span><p class="landing-price" id="p"><span class="landing-sr">Promo price <\/span>₱850<s class="landing-price-was"><span class="landing-sr">, regular price <\/span>₱1,000<\/s><\/p>/);
  assert.match(renderToStaticMarkup(createElement(PriceTag, { service: wash })), /<span class="landing-deal">Up to 15% off<\/span><p class="landing-price">/);
  assert.equal(renderToStaticMarkup(createElement(PriceTag, { service: wash, size: large, id: "p" })), '<p class="landing-price" id="p">from ₱1,200</p>', "no promo: the existing price line, unchanged");
});

test("top picks lead with promos (the discount as the hero) and never show a discount for a non-promo pick", () => {
  const sizes = [small, large];
  const page = (services: ServicePackage[]) => renderToStaticMarkup(createElement(LandingPage, { catalog: { catalogReleaseId: "r", catalogVersion: "1", vehicleCategories: sizes, services, addOnCompatibility: [] } as BookingCatalog, status: "OPEN" }));
  const html = page([service("basic-wash", [offer("s", 85000, 100000), offer("l", 120000)]), service("plain", [offer("s", 50000)])]);
  const featured = html.slice(html.indexOf('id="featured"'), html.indexOf('id="about"'));
  assert.ok(html.indexOf('id="featured"') > html.indexOf('id="top"'), "after the hero");
  // The discount is the hero: a PROMO tag and a big figure (screen readers get "Up to 15% off"), plus the peso saving.
  assert.match(featured, /<span class="landing-featured-tag" data-promo="true">Promo<\/span><p class="landing-featured-off"><span class="landing-sr">Up to 15% off<\/span><span class="landing-featured-off-vis" aria-hidden="true">.*<strong><span>15<\/span>%<\/strong>/);
  // LE 2026-11-20: no duration in the showroom; service times are not guaranteed.
  assert.doesNotMatch(featured, /Duration|\d+ min/);
  // Showroom spec numbers: the discount and the peso saving.
  assert.match(featured, /<dl class="landing-showroom-specs"><div><dt>You save up to<\/dt><dd>₱150<\/dd><\/div><\/dl>/);
  assert.match(featured, /<dt>Small<\/dt><dd><span class="landing-sr">Promo price <\/span><strong>₱850<\/strong><s>/);
  assert.match(featured, /<dt>Large<\/dt><dd><strong>₱1,200<\/strong><\/dd>/);
  assert.match(featured, /href="\/preview\/services\/basic-wash">Details/);
  assert.doesNotMatch(featured, /plain/, "the Wash place is taken by the promo");
  // Nothing on promo: the lead service still shows as a pick, with a plain tag, its normal prices and no discount.
  const calm = page([service("plain", [offer("s", 50000)])]);
  assert.match(calm, /id="landing-featured-title">Top picks for your car/);
  assert.match(calm, /<span class="landing-featured-tag" data-promo="false">Featured<\/span><\/div>/);
  assert.doesNotMatch(calm, /landing-featured-off|landing-featured-save|Promo price/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" })), /id="featured"/);
});

test("About lists only stated shop facts as spec lines, never unconfirmed hours", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));
  const about = html.slice(html.indexOf('id="about"'), html.indexOf('id="concerns"'));
  assert.match(about, /<dl class="landing-about-facts"><div><dt>Call or message<\/dt><dd><a href="tel:\+639300162234">0930 016 2234<\/a><\/dd><\/div>/);
  assert.match(about, /<dt>The shop<\/dt><dd>Brgy 95 Caibaan, Tacloban City<\/dd>/);
  assert.doesNotMatch(about, /08:00|06:00|MON/, "the page asks visitors to confirm hours");
});

test("service cards open their coming-soon pages; only known pages resolve, never prototype keys", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));
  const care = html.slice(html.indexOf('id="care"'), html.indexOf('id="work"'));
  for (const slug of ["wash", "detailing", "graphene-coating"]) assert.match(care, new RegExp(`class="landing-care-card" href="/preview/services/${slug}"`));
  // Selector panels: the first opens by default; the vertical spine title is decoration, the h3 is the real name.
  assert.equal(care.match(/data-active="true"/g)?.length, 1);
  assert.match(care, /href="\/preview\/services\/wash" data-active="true"/);
  assert.match(care, /<span class="landing-care-spine" aria-hidden="true">Wash<\/span><div class="landing-care-content"><h3>Wash<\/h3>/);
  assert.equal(categoryPage("wash")?.title, "Wash");
  assert.equal(categoryPage("constructor"), undefined);
  assert.equal(categoryPage("__proto__"), undefined);
  assert.equal(servicePage("a b/c"), "/preview/services/a%20b%2Fc");
});
