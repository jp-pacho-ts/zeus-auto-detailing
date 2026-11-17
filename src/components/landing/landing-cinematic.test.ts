import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");
const html = () => renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));

test("LE correction: hero loops original workshop footage with a poster-first no-JS fallback", () => {
  const markup = html();
  assert.match(markup, /<video[^>]*loop=""[^>]*playsInline=""[^>]*preload="none"/);
  assert.match(markup, /src="\/media\/home\/hero-poster\.jpg"/);
  assert.match(markup, /srcSet="\/media\/home\/hero-poster-720\.jpg"/);
  assert.doesNotMatch(markup, /<video[^>]+src=/, "no-JS must not download video");
  assert.doesNotMatch(markup, /zeus-car\.png/);
});

test("cinematic flow uses approved process photos and a distinct meaningful closing photo", () => {
  const markup = html();
  // P1-90: the "What we do" stage replaced the P1-89 process pair; the same approved work photos lead it.
  assert.match(markup, /id="work"/);
  assert.match(markup, /url=%2Fmedia%2Flanding%2Fexterior-detailing\.webp/);
  assert.match(markup, /url=%2Fmedia%2Flanding%2Fsignature-wash\.webp/);
  const band = markup.slice(markup.indexOf('class="landing-band"'));
  assert.match(band, /\/media\/landing\/full-detailing\.webp/);
  assert.match(band, /alt="Detailer machine-polishing the hood of a white pickup"/);
  assert.doesNotMatch(band, /hero-poster|DSC00698/);
});

test("missing gallery and feedback are generic preview slots without fabricated proof", () => {
  const markup = html();
  assert.match(markup, /id="gallery"/);
  assert.match(markup, /Gallery photos will appear here\./);
  assert.match(markup, /Customer feedback will appear here\./);
  assert.doesNotMatch(markup, /design dependency|handoff|P1-89|reviewCount|aggregateRating|<blockquote/);
});
