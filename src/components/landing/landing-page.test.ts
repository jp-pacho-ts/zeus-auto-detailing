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

test("draft 3 page: deck H1, no Gallery or Reviews, no dashes or 'coming soon' filler", () => {
  const html = page("OPEN"), words = text(html);
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
  assert.match(html, /<h1>Car and motorcycle detailing in Tacloban City<\/h1>/);
  assert.match(html, /class="landing-word" aria-hidden="true">ZEUS</);
  assert.doesNotMatch(html, /id="gallery"|id="reviews"|>Gallery<|>Reviews</);
  assert.doesNotMatch(words, /[—–]|!/);
  assert.deepEqual(words.match(/coming soon/gi)?.length, words.match(/Photo coming soon/g)?.length);
  assert.doesNotMatch(html, /quoteToken|catalogReleaseId|"release"/);
});

test("gold budget: header CTA is neutral; gold only on hero, band and phone-bar pills; the band has one hairline", () => {
  const html = page("OPEN");
  assert.match(html, /class="landing-pill landing-outline landing-header-cta" href="\/book">Book an appointment</);
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

test("no JS: the toggles are buttons, disabled until hydration; the band image is in the HTML with doors marked decorative", () => {
  const html = page("OPEN");
  assert.match(html, /<button type="button" class="landing-toggle" aria-pressed="false" disabled="">/);
  assert.match(html, /class="landing-band-media"><img src="\/media\/home\/hero-poster\.jpg"/);
  assert.equal(html.match(/class="landing-door [^"]+" aria-hidden="true"/g)?.length, 2);
});
