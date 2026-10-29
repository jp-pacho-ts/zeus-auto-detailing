import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import HomePage from "@/app/page";

const originalMode = process.env.ONLINE_BOOKING_MODE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.ONLINE_BOOKING_MODE;
  else process.env.ONLINE_BOOKING_MODE = originalMode;
});
const render = () => renderToStaticMarkup(HomePage());

test("the temporary root explains the website notice and offers genuine shop contact without the original landing DOM", () => {
  const html = render();
  assert.match(html, /Our new website/);
  assert.match(html, /Coming soon/);
  assert.match(html, /The shop is open/);
  assert.ok(html.includes(`href="tel:${brandConfig.contactPhone.replace(/\s+/g, "")}"`));
  assert.ok(html.includes(`href="${brandConfig.facebookPageUrl}"`));
  assert.ok(html.includes(brandConfig.location));
  assert.ok(html.includes(`alt="${brandConfig.businessName}"`));
  assert.doesNotMatch(html, /<nav\b|id="services"|Appointment Guidelines|Book an Appointment|<form\b/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
});

test("temporary homepage renders the same complete static content in PAUSED and OPEN without changing mode", () => {
  process.env.ONLINE_BOOKING_MODE = "PAUSED";
  const paused = render();
  assert.equal(process.env.ONLINE_BOOKING_MODE, "PAUSED");
  process.env.ONLINE_BOOKING_MODE = "OPEN";
  assert.equal(render(), paused);
  assert.equal(process.env.ONLINE_BOOKING_MODE, "OPEN");
  const content = paused.replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.doesNotMatch(content, /<script\b|<canvas\b|countdown|>[0-9]+%<|instagram\.com/);
});
