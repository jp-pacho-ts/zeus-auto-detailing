// P1-19 W2 + W9 (audit 2026-10-28): the home page's booking calls to action. While online booking is
// PAUSED (server configuration, read at render on the server; Railway applies a change with a
// redeploy) they read "Call to book" and dial the shop; otherwise they open /book with no preset size.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import HomePage from "./page";

const saved = process.env.ONLINE_BOOKING_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.ONLINE_BOOKING_MODE;
  else process.env.ONLINE_BOOKING_MODE = saved;
});
const render = () => renderToStaticMarkup(HomePage());
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test("W9: open booking links go to /book, never with a silent vehicle preset", () => {
  process.env.ONLINE_BOOKING_MODE = "OPEN";
  const markup = render();
  assert.ok(hrefs(markup).includes("/book"));
  assert.ok(hrefs(markup).every((h) => !h.startsWith("/book?")), "no ?vehicle=sedan");
  assert.doesNotMatch(markup, /Call to book/);
});

test("W2: while paused, every booking call to action reads 'Call to book' and dials the shop", () => {
  process.env.ONLINE_BOOKING_MODE = "PAUSED";
  const markup = render();
  assert.ok(hrefs(markup).every((h) => !h.startsWith("/book")), "no link into the paused wizard");
  assert.match(markup, /Call to book/);
  assert.ok(hrefs(markup).includes("tel:" + brandConfig.contactPhone.replace(/\s+/g, "")));
  assert.doesNotMatch(markup, /Book Online/);
});
