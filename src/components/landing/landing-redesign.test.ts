import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");
const render = (status: "OPEN" | "PAUSED" | "UNKNOWN" = "OPEN") => renderToStaticMarkup(createElement(LandingPage, { catalog: null, status }));

test("LuxAuto redesign connects the brand, care journey, genuine shop work and feedback", () => {
  const html = render();
  for (const id of ["top", "about", "care", "work", "services", "estimate", "coatings", "gallery", "reviews", "faq", "visit"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /Care beyond the surface/);
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
