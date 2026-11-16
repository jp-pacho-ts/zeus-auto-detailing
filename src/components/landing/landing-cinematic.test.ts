import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
require.extensions[".css"] = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LandingPage } = require("./landing-page") as typeof import("./landing-page");
const html = () => renderToStaticMarkup(createElement(LandingPage, { catalog: null, status: "OPEN" }));

test("cinematic hero is a poster-first, nonlooping pass without a playback control", () => {
  const markup = html();
  assert.doesNotMatch(markup, /\bloop=""|Pause video|Play video/);
  assert.match(markup, /src="\/media\/preview\/hero-terminal\.webp"/);
  assert.doesNotMatch(markup, /<video[^>]+src=/, "no-JS must not download or start video");
});

test("cinematic flow uses approved process photos and a distinct meaningful closing photo", () => {
  const markup = html();
  assert.match(markup, /class="landing-process/);
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
