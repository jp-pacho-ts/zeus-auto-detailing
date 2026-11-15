import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingServices } from "./landing-services";
import type { DisplayCatalog } from "./landing-services";
test("SSR services remain plain anchors with all category headings, before tab enhancement", () => {
  const catalog: DisplayCatalog = { vehicleCategories: [], services: [], addOnCompatibility: [] };
  const html = renderToStaticMarkup(createElement(LandingServices, { catalog, phone: "+630000000000", messenger: "https://example.test", status: "OPEN" }));
  assert.doesNotMatch(html, /role="tab(?:list|panel)?"/);
  for (const kind of ["WASH", "DETAILING", "GRAPHENE", "TINT", "PPF", "REPAINT"]) assert.ok(html.includes(`id="services-${kind}"`));
  assert.match(html, /The estimate needs JavaScript\. Prices and booking links above still work\./);
  assert.doesNotMatch(html, /quoteToken|catalogReleaseId|queueId/);
});
