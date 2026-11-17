import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingCatalog, ServicePackage } from "@/types/catalog-contracts";
// The page imports its stylesheet; Next bundles it, node:test only needs it to load.
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");

const offer = { vehicleCategoryId: "s", onlineBooking: "PRICED", state: "OFFERED", unitPriceCentavos: 50000, pickupPriceCentavos: undefined, duration: { kind: "TIMED", minutes: 45 } };
const service = (id: string, name: string, category: string) => ({ id, slug: id, name, category, type: "BASE", unit: "VEHICLE", description: null, inclusions: [], offers: [offer] }) as unknown as ServicePackage;
const catalog = { catalogReleaseId: "release", catalogVersion: 1, vehicleCategories: [{ id: "s", code: "S", name: "Small" }], services: [service("wash", "Basic Wash", "WASH"), service("gloss", "Graphene Coat", "GRAPHENE"), service("tint", "Window Tint", "TINT")], addOnCompatibility: [] } as unknown as BookingCatalog;
const page = (status: "OPEN" | "PAUSED" | "UNKNOWN") => renderToStaticMarkup(createElement(LandingPage, { catalog, status }));
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

test("LuxAuto page: one local service H1, genuine workshop photos and labelled proof slots", () => {
  const html = page("OPEN"), words = text(html);
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
  assert.match(html, /<h1[^>]*>.*Care beyond the surface.*Car and motorcycle detailing in Tacloban City.*<\/h1>/);
  assert.equal([...html.matchAll(/class="landing-letter">([^<]+)</g)].map((m) => m[1]).join(""), "ZEUS");
  assert.match(html, /id="gallery"/);
  assert.match(words, /Gallery photos will appear here\./);
  assert.match(words, /Customer feedback will appear here\./);
  assert.doesNotMatch(html, /<blockquote|aggregateRating|reviewCount|design dependency/);
  assert.doesNotMatch(words, /[—–]|!/);
  assert.deepEqual(words.match(/coming soon/gi)?.length, words.match(/Photo coming soon/g)?.length);
  assert.doesNotMatch(html, /quoteToken|catalogReleaseId|"release"/);
});

test("gold budget: header CTA is neutral; gold only on hero, band and phone-bar pills; the band has one hairline", () => {
  const html = page("OPEN");
  assert.match(html, /class="landing-pill landing-outline landing-header-cta" href="\/book">Book now</);
  assert.equal(html.match(/landing-pill landing-gold/g)?.length, 3);
  assert.equal(html.match(/landing-hairline/g)?.length, 1);
});

test("booking states reach every pill and card arrow; PAUSED arrows call the shop", () => {
  assert.match(page("OPEN"), /class="landing-arrow" href="\/book" aria-label="Book Basic Wash"/);
  const paused = page("PAUSED");
  assert.match(paused, /class="landing-arrow" href="tel:\+639300162234" aria-label="Call to book Basic Wash"/);
  assert.match(paused, /Online booking is paused\. Call or message us to book\./);
  assert.doesNotMatch(paused, /Book online, or call/);
  const unknown = page("UNKNOWN");
  assert.match(unknown, /We could not check online booking just now\./);
  assert.match(unknown, /aria-label="Book Basic Wash"/);
});

test("no JS: toggles remain disabled until hydration and the closing workshop image is visible without doors", () => {
  const html = page("OPEN");
  assert.match(html, /<button type="button" class="landing-toggle" aria-pressed="false" disabled="">/);
  assert.match(html, /class="landing-band-media"><img src="\/media\/landing\/full-detailing\.webp"/);
  assert.match(html, /alt="Detailer machine-polishing the hood of a white pickup"/);
  assert.doesNotMatch(html, /class="landing-door/);
});

test("photos (17.13): a photo only on its own service, lazy next/image with size and alt; other cards keep the labelled frame", () => {
  const services = [service("s1", "Basic Wash", "WASH"), service("s2", "Premium Wash", "WASH"), service("s3", "Kenzo", "GRAPHENE"), service("s4", "Regular Tint", "TINT")];
  ["basic-wash", "premium-wash", "kenzo-graphene", "regular-tint"].forEach((slug, i) => { services[i].slug = slug; });
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: { ...catalog, services } as unknown as BookingCatalog, status: "OPEN" }));
  // Editorial process/coating images are separate from slug-bound catalog cards (P1-89 D4).
  const servicesHtml = html.slice(html.indexOf('id="services"'), html.indexOf('id="coatings"'));
  const imgs = servicesHtml.match(/<img [^>]*url=%2Fmedia%2Flanding%2F[^>]+>/g) ?? [];
  assert.deepEqual(imgs.map((img) => img.match(/url=%2Fmedia%2Flanding%2F([a-z-]+)\.webp/)?.[1]).sort(), ["basic-wash", "kenzo"]);
  for (const img of imgs) {
    assert.match(img, /loading="lazy"/);
    assert.doesNotMatch(img, /fetchPriority|fetchpriority/);
    assert.match(img, /width="1600" height="1200"/);
    assert.match(img, /sizes="\(max-width: 767px\) 100vw, \(max-width: 1023px\) 50vw, 400px"/);
  }
  assert.match(html, /alt="Kenzo coating kit: base and top bottles, Strip panel-prep spray, applicator and card"/);
  assert.equal(html.match(/Photo coming soon/g)?.length, 2);
});

test("photo files (17.13): one 4:3 WebP per mapped service, under 250 KB, with no EXIF, XMP or ICC chunk", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LANDING_PHOTOS } = require("./landing-photos") as typeof import("./landing-photos");
  const sources = Object.values(LANDING_PHOTOS).map((p) => p.src);
  assert.equal(new Set(sources).size, sources.length, "no photo on two different services");
  // public/ is served as-is: the folder holds only the mapped photos, never notes or originals (N10).
  assert.deepEqual(readdirSync("public/media/landing").sort(), sources.map((src) => src.replace("/media/landing/", "")).sort());
  for (const src of sources) {
    const file = readFileSync(`public${src}`);
    assert.equal(file.toString("latin1", 0, 4) + file.toString("latin1", 8, 12), "RIFFWEBP", src);
    assert.ok(file.length < 250 * 1024, `${src} is ${file.length} bytes`);
    const chunks: string[] = [];
    for (let at = 12; at + 8 <= file.length; at += 8 + file.readUInt32LE(at + 4) + (file.readUInt32LE(at + 4) & 1)) chunks.push(file.toString("latin1", at, at + 4));
    assert.deepEqual(chunks, ["VP8 "], src);
    // Simple-format VP8 frame header: 14-bit width and height at bytes 26 and 28.
    assert.deepEqual([file.readUInt16LE(26) & 0x3fff, file.readUInt16LE(28) & 0x3fff], [1600, 1200], src);
  }
});

test("photos: a slug that names an Object prototype key gets the labelled frame, not a broken render", () => {
  const services = [service("p1", "Odd Wash", "WASH"), service("p2", "Odd Coat", "GRAPHENE")];
  services[0].slug = "constructor"; services[1].slug = "__proto__";
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: { ...catalog, services } as unknown as BookingCatalog, status: "OPEN" }));
  const servicesHtml = html.slice(html.indexOf('id="services"'), html.indexOf('id="coatings"'));
  assert.doesNotMatch(servicesHtml, /url=%2Fmedia%2Flanding%2F/);
  assert.equal(servicesHtml.match(/Photo coming soon/g)?.length, 2);
});

test("coatings summaries use the same arrow icon as the cards, never a text glyph (UI/UX P1-89 copy note)", () => {
  // P1-90 F1: the comparison lists packages with catalog inclusions, so the fixture gives two packages inclusions.
  const withInclusions = (id: string, name: string) => ({ ...service(id, name, "GRAPHENE"), inclusions: ["Decon wash"] }) as unknown as ServicePackage;
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: { ...catalog, services: [withInclusions("gloss", "Graphene Coat"), withInclusions("gloss2", "Graphene Top")] } as unknown as BookingCatalog, status: "OPEN" }));
  assert.doesNotMatch(text(html), /↗/);
  const coatings = html.slice(html.indexOf('id="coatings"'), html.indexOf('id="gallery"'));
  assert.match(coatings, /class="landing-arrow" href="[^"]+" aria-label="Book Graphene Coat"><svg[^>]*aria-hidden="true"/);
});

test("CEO rule A on the page: services cards and coatings summaries say 'Price depends on size' before a size is chosen", () => {
  const sized = { ...service("eclipse", "Eclipse", "GRAPHENE"), inclusions: ["Decon wash"], offers: [{ ...offer, vehicleCategoryId: "s", unitPriceCentavos: 1170000 }, { ...offer, vehicleCategoryId: "m", unitPriceCentavos: 1215000 }] } as unknown as ServicePackage;
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: { ...catalog, vehicleCategories: [{ id: "s", code: "S", name: "Small" }, { id: "m", code: "M", name: "Medium" }], services: [sized, { ...service("kenzo", "Kenzo", "GRAPHENE"), inclusions: ["Decon wash"] }] } as unknown as BookingCatalog, status: "OPEN" }));
  // Graphene tab card and the Coatings phone block (P1-90: the comparison needs two packages with inclusions; the table cell is a td).
  assert.equal(html.match(/<p class="landing-price"[^>]*>Price depends on size<\/p>/g)?.length, 2);
  assert.doesNotMatch(text(html), /from ₱11,700/);
});
