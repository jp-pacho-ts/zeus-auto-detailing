import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");
const render = (status: "OPEN" | "PAUSED" | "UNKNOWN" = "OPEN") => renderToStaticMarkup(createElement(LandingPage, { catalog: null, status }));

test("LuxAuto redesign connects the brand, care journey, genuine shop work and feedback", () => {
  const html = render();
  for (const id of ["top", "about", "care", "work", "services", "estimate", "coatings", "gallery", "reviews", "faq", "visit"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /Car &amp; motorcycle detailing/);
  assert.equal(html.match(/<h1[ >]/g)?.length, 1);
  assert.match(html, /Car and motorcycle detailing in Tacloban City/);
  assert.match(html, /Review awaiting owner approval/);
  assert.doesNotMatch(html, /aggregateRating|reviewCount|Five out of five|★★★★★|Jordan L\./);
  assert.match(html, /Prices are unavailable right now/);
});

test("new closing CTA stays honest in every booking state", () => {
  assert.match(render("PAUSED"), /Online booking is paused\. Call or message us to book\./);
  assert.doesNotMatch(render("PAUSED"), /Book online, or call/);
  assert.match(render("UNKNOWN"), /We could not check online booking just now/);
  assert.match(render(), /href="\/book"/);
});

test("LE revision: Book now and Manage booking are first-screen actions in every booking state", () => {
  for (const status of ["OPEN", "PAUSED", "UNKNOWN"] as const) {
    const html = render(status);
    const hero = html.slice(html.indexOf('id="top"'), html.indexOf('id="about"'));
    assert.match(hero, /href="\/book"[^>]*>Book now/);
    assert.match(hero, /href="\/book\/manage"[^>]*>Manage booking/);
    assert.doesNotMatch(hero, />Call to book<|>Book an appointment</);
    assert.match(hero, /<video[^>]*loop=""/);
  }
});

test("cinematic car asset supplies real alpha transparency at a bounded source size", () => {
  const png = readFileSync("public/media/landing-hero/zeus-car.png");
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1536, 1024]);
  assert.equal(png[25], 6, "RGBA format preserves the car silhouette");
  assert.ok(png.length < 2 * 1024 * 1024);
});

test("workshop keeps all three photographs and price links available before motion starts", () => {
  const html = render();
  const work = html.slice(html.indexOf('id="work"'), html.indexOf('id="services"'));
  assert.equal(work.match(/class="landing-step-photo"/g)?.length, 3);
  assert.match(work, /class="landing-stage-progress" aria-hidden="true"/);
  assert.doesNotMatch(work, /landing-stage-backdrop|landing-stage-wipe/);
  assert.equal(work.match(/class="landing-step"/g)?.length, 3);
  assert.equal(work.match(/href="#services"/g)?.length, 3);
  assert.doesNotMatch(work, /is-motion-scene|aria-hidden="true"[^>]*>Wash/);
});

test("minimal hero keeps the headline and booking actions without decorative location copy", () => {
  const html = render();
  const hero = html.slice(html.indexOf('id="top"'), html.indexOf('id="about"'));
  assert.doesNotMatch(hero, /landing-hero-side|landing-hero-location|Precision\. Protection\. Pride\.|Tacloban City, PH|The art of considered car care|From the everyday refresh/);
  assert.doesNotMatch(hero, /landing-video-control|Pause video|landing-lede/);
  assert.match(html, /<header class="landing-header" data-scrolled="false"/);
});

test("hero keeps direct booking actions without availability notices in all states", () => {
  for (const state of ["OPEN", "PAUSED", "UNKNOWN"] as const) {
    const html = render(state);
    const hero = html.slice(html.indexOf('id="top"'), html.indexOf('id="about"'));
    assert.doesNotMatch(hero, /Online booking is paused|We could not check online booking|landing-status/);
    assert.match(hero, /href="\/book"/);
    assert.match(hero, /class="landing-hero-manage" href="\/book\/manage"/);
  }
});

test("opening leads directly into the shop introduction without a repeated facts strip", () => {
  const html = render();
  assert.doesNotMatch(html, /Zeus at a glance|Built around your vehicle|A clearer starting point|For the pride/);
  assert.match(html, /Professional care for your vehicle/);
});

test("service choices use familiar names and header has clear section destinations", () => {
  const html = render();
  const care = html.slice(html.indexOf('id="care"'), html.indexOf('id="work"'));
  for (const name of ["Wash", "Detailing", "Graphene coating"]) assert.ok(care.includes(`<h3>${name}</h3>`), name);
  assert.doesNotMatch(care, /<h3>Refresh|<h3>Restore|more considered reset/);
  const nav = html.slice(html.indexOf('class="landing-desktop-nav"'), html.indexOf('</nav>'));
  assert.equal(nav.match(/<a /g)?.length, 5);
  for (const target of ["#about", "#services", "#work", "#faq", "#visit"]) assert.ok(nav.includes(`href="${target}"`), target);
});

test("workshop has natural proportions without buttons and feedback follows the real shop work", () => {
  const html = render();
  const work = html.slice(html.indexOf('id="work"'), html.indexOf('id="reviews"'));
  assert.doesNotMatch(work, /data-care-jump|<button/);
  assert.ok(html.indexOf('id="reviews"') > html.indexOf('id="work"'));
  assert.ok(html.indexOf('id="reviews"') < html.indexOf('id="services"'));
});
