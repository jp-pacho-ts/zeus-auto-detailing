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

test("Visit: a 3D map orbits the verified pin (Google embed as fallback) with Google directions, alongside address and contact", () => {
  const html = page(), visit = section(html, "visit");
  assert.match(visit, /<address[^>]*>.*Brgy 95 Caibaan, Tacloban City.*<\/address>/);
  // LE 2026-11-20: MapLibre + OpenFreeMap 3D map, loaded on the client only when the section is near.
  assert.match(visit, /<div class="landing-visit-map-canvas" role="region" aria-label="3D map around Zeus Auto Detailing\. Use Get directions for Google Maps\."><\/div>/);
  const map = readFileSync("src/components/landing/landing-visit-map.tsx", "utf8");
  assert.match(map, /brandConfig\.mapCoordinates\.split/);
  assert.match(map, /await import\("maplibre-gl"\)/);
  assert.match(map, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(map, /<iframe src=\{brandConfig\.mapEmbedUrl\}[^>]*loading="lazy"/);
  assert.match(visit, /https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=11\.2054621%2C124\.991338/);
  assert.match(visit, /href="tel:\+639300162234"/);
  assert.match(visit, /href="https:\/\/m\.me\/zeusautodetailingtacloban"/);
  assert.match(section(html, "reviews"), /Customer feedback will appear here\./);
  assert.match(html, /href="#reviews"[^>]*>Reviews</);
  assert.match(html, /<nav class="landing-menu-links"[^>]*>.*href="\/preview\/faq"[^>]*>FAQ</);
});

test("Footer groups customer links and keeps staff sign-in out of public navigation", () => {
  const footer = page().match(/<footer id="site-footer"[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer);
  assert.match(footer, /<nav aria-labelledby="landing-footer-explore"/);
  assert.match(footer, /href="#estimate">Get an estimate/);
  assert.match(footer, /href="\/book\/manage">Manage booking/);
  assert.match(footer, /href="tel:\+639300162234"[^>]*>.*0930 016 2234/);
  assert.match(footer, /href="https:\/\/m\.me\/zeusautodetailingtacloban"/);
  assert.match(footer, /href="https:\/\/www\.instagram\.com\/zeus\.otodetailing"/);
  assert.match(footer, /destination=11\.2054621%2C124\.991338/);
  // LE 2026-11-20: no back-to-top link; an oversized ZEUS signature (decorative) sits above the bottom line.
  assert.doesNotMatch(footer, /Back to top|href="#top"/);
  // The signature is the real logo's ZEUS letters (a re-sharpened mask cut from logo.png), not a font.
  assert.match(footer, /<div class="landing-footer-mark" aria-hidden="true"><\/div>/);
  assert.match(readFileSync("src/components/landing/landing.css", "utf8"), /\.landing \.landing-footer-mark\{[^}]*mask:url\("\/images\/zeus-wordmark-mask\.png"\)/);
  assert.equal(readFileSync("public/images/zeus-wordmark-mask.png").toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.doesNotMatch(footer, /\/admin\/login|Staff login/);
});

test("The landing preview uses local Geist with an uppercase display hierarchy", () => {
  const css = readFileSync("src/components/landing/landing.css", "utf8").replace(/\s+/g, "");
  assert.match(css, /@font-face\{font-family:LandingGeist;src:url\('\/fonts\/landing\/Geist-Variable.woff2'\)/);
  assert.match(css, /\.landing\{[^}]*LandingGeist/);
  // LE 2026-11-19: body, subheads and descriptions share the display face's family (Zalando Sans), Geist only as fallback.
  assert.match(css, /@font-face\{font-family:LandingText;src:url\('\/fonts\/landing\/ZalandoSans-Variable.woff2'\)/);
  assert.match(css, /\.landing\{[^}]*font:1rem\/1\.7LandingText,LandingGeist/);
  assert.equal(readFileSync("public/fonts/landing/ZalandoSans-Variable.woff2").subarray(0, 4).toString("ascii"), "wOF2");
  assert.match(readFileSync("public/fonts/landing/ZalandoSans-OFL.txt", "utf8"), /SIL Open Font License, Version 1\.1/);
  assert.match(css, /\.landingh1,\.landingh2:not\(\.landing-footer-heading\)\{[^}]*text-transform:uppercase/);
  assert.equal(readFileSync("public/fonts/landing/Geist-Variable.woff2").subarray(0, 4).toString("ascii"), "wOF2");
});

test("Display headings use local Zalando Sans Expanded (OFL), not Koenigsegg's licensed fonts", () => {
  const css = readFileSync("src/components/landing/landing.css", "utf8").replace(/\s+/g, "");
  // Measured 2026-11-19 over ~80 free families: Unbounded scored highest but read playful; the LE chose the next match, Zalando Sans Expanded, a step bolder. 93.1% matches the reference cap height.
  assert.match(css, /@font-face\{font-family:LandingDisplay;src:url\('\/fonts\/landing\/ZalandoSansExpanded-Variable.woff2'\)[^}]*size-adjust:93\.1%/);
  assert.match(css, /\.landingh1,\.landingh2:not\(\.landing-footer-heading\)\{font-family:LandingDisplay,[^}]*font-weight:600[^}]*text-transform:uppercase/);
  assert.doesNotMatch(css, /Gustavo|BaselGrotesk|koenigsegg\.com/i);
  assert.equal(readFileSync("public/fonts/landing/ZalandoSansExpanded-Variable.woff2").subarray(0, 4).toString("ascii"), "wOF2");
  assert.match(readFileSync("public/fonts/landing/ZalandoSansExpanded-OFL.txt", "utf8"), /SIL Open Font License, Version 1\.1/);
});

test("Hero puts Discover beside the title and keeps booking controls in their own bar", () => {
  const hero = renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));
  const top = hero.slice(hero.indexOf('id="top"'), hero.indexOf('id="about"'));
  assert.match(top, /<\/h1><a class="landing-scroll-cue" href="#about"/);
  const bar = top.slice(top.indexOf('class="landing-hero-bar"'));
  assert.doesNotMatch(bar, /landing-scroll-cue/);
  assert.match(bar, /class="landing-hero-manage" href="\/book\/manage"/);
});

test("A fresh tab gets the shared pre-paint intro curtain before the page, with the landing's own timeline", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));
  // Script first, so the curtain is up from the first frame; then the hidden curtain, then the page content.
  assert.match(html, /<div class="landing" data-landing-preview="[^"]*"><script id="zeus-home-intro-prepaint">\(function\(\)\{try\{if\(sessionStorage\.getItem\("zeus\.home\.intro\.v1"\)\|\|matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\)return;/);
  assert.match(html, /<div data-home-intro="idle"><div data-home-curtain="[^"]*" hidden="" class="zeus-intro">.*<button type="button" class="zeus-intro__skip">Skip intro<\/button><\/div><div data-home-content="[^"]*"><a class="landing-skip"/);
  assert.match(readFileSync("src/components/landing/landing-intro.tsx", "utf8"), /import\("\.\/landing-intro-motion"\)\)\.playLandingIntro/);
  assert.match(readFileSync("src/components/landing/landing-lifecycle.tsx", "utf8"), /document\.getElementById\(HOME_INTRO_PENDING_STYLE_ID\)\) return;/);
  const css = readFileSync("src/components/landing/landing.css", "utf8").replace(/\s+/g, "");
  assert.match(css, /\.landing\[hidden\]:not\(\[data-home-curtain\]\)\{display:none!important\}/);
  // LE 2026-11-20: the logo reveals letter by letter with a soft light pass, built on the client so the shared markup
  // stays, and torn down again when it ends.
  const motion = readFileSync("src/components/landing/landing-intro-motion.ts", "utf8");
  assert.match(motion, /const LETTER_CUTS = \[0, 26\.85, 49\.37, 74\.41, 100\];/);
  assert.match(motion, /logo\.remove\(\); bars\.forEach\(\(bar\) => bar\.remove\(\)\); img\.hidden = false;/);
  // Cinematic exit: the black parts into widescreen film bars around the hero, then the bars leave.
  assert.match(motion, /innerWidth \/ 2\.39/);
  // Title over footage: the hero film plays dim and black-and-white behind the mark, then its colour comes back.
  assert.match(motion, /filter: "grayscale\(1\) brightness\(\.75\)"/);
  assert.match(motion, /filter: "grayscale\(0\) brightness\(1\)"/);
  assert.match(css, /\.landing\.zeus-intro__bar\{[^}]*background:#000\}/);
  assert.match(motion, /return restore;/);
  assert.match(css, /\.landing\.zeus-intro__shine\{[^}]*mask:var\(--logo\)/);
});

test("Header is logo, Book now and a two-line menu toggle; links and Manage booking sit in the full-screen menu", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  const bar = header.slice(0, header.indexOf('id="landing-menu"'));
  assert.doesNotMatch(bar, /landing-desktop-nav|href="#about"|\/book\/manage/);
  assert.match(bar, /<button class="landing-menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="landing-menu"><svg[^>]*aria-hidden="true">(<line [^>]*><\/line>){2}<\/svg><\/button>/);
  const menu = header.slice(header.indexOf('id="landing-menu"'));
  assert.match(menu, /^id="landing-menu" class="landing-menu" hidden=""/);
  assert.match(menu, /href="\/book\/manage">Manage booking/);
  assert.match(menu, /class="landing-kbtn landing-k-outline" href="\/book"><span class="landing-k-label"><span>Book now<\/span><\/span>/);
  const more = menu.slice(menu.indexOf('class="landing-menu-more"'));
  assert.match(more, /href="tel:\+639300162234">Call 0930 016 2234/);
  assert.match(more, /href="https:\/\/m\.me\/zeusautodetailingtacloban">Messenger/);
  assert.match(more, /href="https:\/\/www\.instagram\.com\/zeus\.otodetailing">Instagram/);
  assert.match(more, /destination=11\.2054621%2C124\.991338" target="_blank" rel="noreferrer"/);
  const css = readFileSync("src/components/landing/landing.css", "utf8").replace(/\s+/g, "");
  // The header Book now starts hidden and only shows once the hero's Book now has scrolled away.
  assert.match(header, /^<header class="landing-header"[^>]* data-past-hero="false">/);
  // LE 2026-11-19: one 154px transparent header at the top; it hides as soon as the page scrolls down and has no solid scroll-up bar.
  assert.match(header, /^<header class="landing-header" data-menu-open="false" data-hidden="false" data-past-hero="false">/);
  assert.doesNotMatch(css, /data-scrolled/);
  assert.match(css, /\.landing\{--header-top:154px;--header-bar:112px;--header-h:var\(--header-bar\)\}/);
  assert.match(css, /\.landing-header\[data-hidden=true\]:not\(:has\(:focus-visible\)\)\{transform:translateY\(-100%\)\}/);
  assert.match(css, /\.landing:has\(\.landing-header\[data-hidden=true\]\)\{--header-h:0px\}/);
  // Regression: globals.css "html.dark header" (0,1,2) beat a bare .landing-header transition, so the hide snapped instead of sliding.
  assert.match(css, /\.landing\.landing-header\{transition:[^}]*height\.5s[^}]*transform\.6s/);
  assert.match(css, /\.landing-header:is\(\[data-past-hero=false\],\[data-menu-open=true\],\[data-hidden=true\]\)\.landing-header-cta\{opacity:0;visibility:hidden\}/);
  assert.match(css, /\.landing-menu:not\(\[hidden\]\)\{animation:landing-menu-wipe/);
  // LE 2026-11-19: closing plays the wipe in reverse instead of vanishing.
  assert.match(css, /\.landing-menu\[data-closing\]\{animation:landing-menu-wipe-out[^}]*forwards\}/);
  assert.match(readFileSync("src/components/landing/landing-header.tsx", "utf8"), /hidden=\{!open && !closing\}/);
  // Both cut corners: top-right and bottom-left.
  assert.match(css, /clip-path:polygon\(00,calc\(100%-var\(--k-cut\)\)0,100%var\(--k-cut\),100%100%,var\(--k-cut\)100%,0calc\(100%-var\(--k-cut\)\)\)/);
  assert.match(css, /@media\(hover:hover\)and\(prefers-reduced-motion:no-preference\)\{:is\(\.landing-kbtn,\.landing-header-cta\):hover\.landing-k-arrowsvg\{animation/);
  // CTA wipe: collapsed slanted polygon at rest, the full cut-corner shape on hover; the label rolls to its text-shadow copy.
  assert.match(css, /\.landing\.landing-kbtn::after\{[^}]*clip-path:polygon\(00,00,00,-30%100%,-30%100%,-30%100%\);transition:clip-path/);
  assert.match(css, /@media\(hover:hover\)\{\.landing\.landing-kbtn:hover::after\{clip-path:polygon\(00,calc\(100%-var\(--k-cut\)\)0/);
  assert.match(css, /\.landing-kbtn:hover\.landing-k-label>span\{transform:translateY\(-1\.3em\)\}/);
  assert.match(html, /landing-kbtn" href="\/book"><span class="landing-k-label"><span>Book now<\/span><\/span><span class="landing-k-arrow">/);
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
