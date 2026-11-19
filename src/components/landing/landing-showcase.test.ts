import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingCatalog, ServicePackage } from "@/types/catalog-contracts";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");

// P1-90 (CEO-approved strategy and identity, 2026-11-16): the showcase structure, written before the build.
const timed = (vehicleCategoryId: string, unitPriceCentavos: number, minutes = 60) => ({ vehicleCategoryId, onlineBooking: "PRICED", state: "OFFERED", unitPriceCentavos, duration: { kind: "TIMED", minutes } });
const multiDay = (vehicleCategoryId: string, unitPriceCentavos: number) => ({ vehicleCategoryId, onlineBooking: "PRICED", state: "OFFERED", unitPriceCentavos, duration: { kind: "MULTI_DAY" } });
const service = (slug: string, name: string, category: string, inclusions: string[] = [], offers: unknown[] = [timed("s", 50000)]) => ({ id: slug, slug, name, category, type: "BASE", unit: "VEHICLE", description: null, inclusions, offers }) as unknown as ServicePackage;
const sizes = [{ id: "m", code: "MOTOR", name: "Motor / Motorcycle" }, { id: "s", code: "S", name: "Small" }];
const services = [
  service("basic-wash", "Basic Wash", "WASH"), service("signature-wash", "Signature Wash", "WASH"),
  service("exterior-detailing", "Exterior Detailing", "DETAILING"),
  service("eclipse-graphene", "Eclipse", "GRAPHENE", ["Decon wash", "Graphene base"], [multiDay("s", 1170000)]),
  service("kenzo-graphene", "Kenzo", "GRAPHENE", ["Decon wash", "Graphene base", "Graphene top"], [multiDay("s", 1750000)]),
];
const catalog = (over: Partial<BookingCatalog> = {}) => ({ catalogReleaseId: "release", catalogVersion: 1, vehicleCategories: sizes, services, addOnCompatibility: [], ...over }) as unknown as BookingCatalog;
const page = (status: "OPEN" | "PAUSED" | "UNKNOWN" = "OPEN", c: BookingCatalog | null = catalog()) => renderToStaticMarkup(createElement(LandingPage, { catalog: c, status }));
const section = (html: string, id: string) => { const start = html.indexOf(`id="${id}"`); assert.ok(start > 0, id); return html.slice(start, html.indexOf("</section>", start)); };

test("What we do: the process stage names each category, links its catalog services and its prices, and uses the approved stage photos", () => {
  const work = section(page(), "work");
  assert.match(work, /<h2[^>]*>What we do in the shop<\/h2>/);
  for (const name of ["Wash", "Detailing", "Graphene"]) assert.match(work, new RegExp(`<h3[^>]*>${name}</h3>`));
  assert.match(work, /href="#service-basic-wash"[^>]*>Basic Wash</);
  assert.match(work, /href="#service-eclipse-graphene"[^>]*>Eclipse</);
  assert.match(work, /href="#services-WASH"[^>]*>See wash prices</);
  assert.match(work, /href="#services-GRAPHENE"[^>]*>See graphene prices</);
  // Wash = signature-wash, Detailing = exterior-detailing, Graphene = arcane (identity 5.3); never the coatings photo.
  const photos = [...work.matchAll(/url=%2Fmedia%2Flanding%2F([a-z-]+)\.webp/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(photos)], ["signature-wash", "exterior-detailing", "arcane"]);
  assert.doesNotMatch(work, /\b0?[123]\.|<ol/, "no numbering: the work is not a fixed sequence");
});

test("Coatings: package panels show prices, shared inclusions appear once, and the table keeps differences", () => {
  const coatings = section(page(), "coatings");
  const title = /<h2[^>]*aria-label="Coatings and films"[^>]*><span class="landing-bleed-line" aria-hidden="true"><span class="landing-bleed-text">Coatings<\/span><\/span> <span class="landing-bleed-line" aria-hidden="true"><span class="landing-bleed-text">and films/;
  assert.match(coatings, title);
  assert.match(section(page("OPEN", null), "coatings"), title, "the title renders without the catalog");
  assert.match(coatings, /url=%2Fmedia%2Flanding%2Feclipse\.webp/);
  assert.doesNotMatch(coatings, /landing-coating-edge/, "the edge frame that drew the black strip is gone");
  assert.match(coatings, /<h3[^>]*>Compare graphene packages<\/h3>/);
  assert.match(coatings, /<select id="landing-compare-size"/);
  assert.match(coatings, /<h4>Included in every package<\/h4>/);
  assert.equal([...coatings.matchAll(/Decon wash/g)].length, 1);
  assert.match(coatings, /<table/);
  assert.match(coatings, /<th scope="col"[^>]*>Eclipse<\/th>/);
  assert.match(coatings, /<th scope="row"[^>]*>Graphene top<\/th>/);
  // Eclipse lacks "Graphene top": its cell says so to assistive technology, with no typed dash.
  assert.match(coatings, /Not included/);
  assert.match(coatings, /<span class="landing-sr">Included<\/span>/);
  assert.match(coatings, /href="\/book">Book Eclipse<svg/);
  assert.match(coatings, /class="landing-compare-packages"/);
});

test("Coatings: packages with identical inclusions have no comparison matrix", () => {
  const identical = services.map((s) => s.category === "GRAPHENE" ? { ...s, inclusions: ["Decon wash"] } : s);
  const coatings = section(page("OPEN", catalog({ services: identical })), "coatings");
  assert.match(coatings, /<h4>Eclipse<\/h4>/);
  assert.match(coatings, /<h4>Kenzo<\/h4>/);
  assert.match(coatings, /url=%2Fmedia%2Flanding%2Fkenzo\.webp/);
  assert.doesNotMatch(coatings, /<table/);
});

test("FAQ: only the confirmed questions, as buttons; answers follow the booking state and the catalog", () => {
  const open = section(page("OPEN"), "faq");
  assert.match(open, /<h2[^>]*>Questions before you book<\/h2>/);
  const questions = [...open.matchAll(/<button[^>]*aria-expanded="(true|false)"[^>]*>([^<]+)/g)].map((m) => m[2]);
  assert.deepEqual(questions, ["How much will it cost for my vehicle?", "How long does a service take?", "Can I book online?", "Can I change my booking?", "Do you work on motorcycles?", "What are your opening hours?", "Where is the shop?", "What does a graphene package include?"]);
  assert.match(open, /Some coatings take more than one day\./);
  assert.match(open.replace(/<[^>]+>/g, ""), /Yes\. Choose your services and a date at Book an appointment\./);
  assert.match(section(page("PAUSED"), "faq"), /Online booking is paused\. Call or message us to book\./);
  assert.match(section(page("UNKNOWN"), "faq"), /We could not check online booking just now\./);
  // No motorcycle size, no motorcycle question; no multi-day coating, no second sentence.
  const cars = section(page("OPEN", catalog({ vehicleCategories: [sizes[1]], services: services.slice(0, 3) } as Partial<BookingCatalog>)), "faq");
  assert.doesNotMatch(cars, /Do you work on motorcycles\?|more than one day/);
  assert.doesNotMatch(open, /How long does a coating last|deposit|How can I pay|wait at the shop/, "owner items stay out");
});

test("Hero: original responsive posters support looping workshop video; availability remains available outside the hero", () => {
  const html = page("PAUSED");
  assert.match(html, /srcSet="\/media\/home\/hero-poster-720\.jpg"/);
  assert.match(html, /src="\/media\/home\/hero-poster\.jpg"/);
  assert.match(html, /<video[^>]*loop=""/);
  assert.match(html, /Online booking is paused\. Call or message us to book\./);
  const css = readFileSync("src/components/landing/landing.css", "utf8");
  assert.doesNotMatch(css, /border-left:3px/, "no side-tab rules (impeccable detect, landing.css:64 and :147)");
});

test("Cards: title and price sit on the photo, each card has its service anchor, and Kenzo is contained on a dark mat", () => {
  const services = section(page(), "services");
  assert.match(services, /id="service-basic-wash"/);
  assert.match(services, /class="landing-photo">[^]*?<div class="landing-service-heading"><h4>Basic Wash<\/h4><p class="landing-price"/);
  assert.match(services, /class="landing-photo landing-photo-contain"/);
});

test("Visit: the verified pin has a lazy Google Maps embed and direct directions, alongside address and contact", () => {
  const html = page(), visit = section(html, "visit");
  assert.match(visit, /<address[^>]*>.*Brgy 95 Caibaan, Tacloban City.*<\/address>/);
  assert.match(visit, /<iframe[^>]*src="https:\/\/www\.google\.com\/maps\/embed\?pb=[^"]*0x7e38b176ace74446[^>]*title="Google Maps location for Zeus Auto Detailing"[^>]*loading="lazy"/);
  assert.match(visit, /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=11\.2054621%2C124\.991338/);
  assert.match(visit, /href="tel:\+639300162234"/);
  assert.match(visit, /href="https:\/\/m\.me\/zeusautodetailingtacloban"/);
  assert.match(section(html, "reviews"), /Customer feedback will appear here\./);
  assert.match(html, /href="#reviews"[^>]*>Reviews</);
  assert.match(html, /<nav class="landing-desktop-nav"[^>]*>.*href="#faq"[^>]*>FAQ</);
});

test("Footer groups site links, contact links and utilities while keeping their destinations", () => {
  const footer = page().match(/<footer id="site-footer"[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer);
  assert.match(footer, /<nav aria-labelledby="landing-footer-explore"/);
  assert.match(footer, /href="#estimate">Get an estimate/);
  assert.match(footer, /href="\/book\/manage">Manage booking/);
  assert.match(footer, /href="tel:\+639300162234"[^>]*>.*0930 016 2234/);
  assert.match(footer, /href="https:\/\/m\.me\/zeusautodetailingtacloban"/);
  assert.match(footer, /href="https:\/\/www\.instagram\.com\/zeus\.otodetailing"/);
  assert.match(footer, /destination=11\.2054621%2C124\.991338/);
  assert.match(footer, /class="landing-footer-bottom"[^>]*>.*href="\/admin\/login">Staff login.*href="#top">Back to top/);
});

test("LuxAuto identity uses local DM Sans throughout, including the monumental Zeus word", () => {
  const css = readFileSync("src/components/landing/landing.css", "utf8").replace(/\s+/g, "");
  assert.match(css, /@font-face\{font-family:LandingBody;src:url\('\/fonts\/home\/DMSans.ttf'\)/);
  assert.match(css, /\.landing-word\{[^}]*LandingBody/);
  assert.doesNotMatch(css, /LandingDisplay|BarlowCondensed/);
});

test("UI/UX F1: a graphene package with no catalog inclusions is left out of the comparison; under two packages, no comparison", () => {
  const moto = service("motorcycle-graphene", "Motorcycle Graphene", "GRAPHENE", [], [multiDay("m", 200000)]);
  const coatings = section(page("OPEN", catalog({ services: [...services, moto] } as Partial<BookingCatalog>)), "coatings");
  assert.doesNotMatch(coatings, /<th scope="col"[^>]*>Motorcycle Graphene<\/th>/);
  assert.doesNotMatch(coatings, /<h4>Motorcycle Graphene<\/h4>/);
  assert.match(coatings, /<th scope="col"[^>]*>Kenzo<\/th>/);
  // The motorcycle package keeps its card in the Graphene tab.
  assert.match(section(page("OPEN", catalog({ services: [...services, moto] } as Partial<BookingCatalog>)), "services"), /id="service-motorcycle-graphene"/);
  const one = section(page("OPEN", catalog({ services: [...services.filter((s) => s.slug !== "kenzo-graphene"), moto] } as Partial<BookingCatalog>)), "coatings");
  assert.doesNotMatch(one, /Compare graphene packages|<table/);
});
