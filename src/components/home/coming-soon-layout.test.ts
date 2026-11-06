import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import HomePage from "@/app/page";

// P1-46: the redone coming-soon layout. One message, one primary action (Call), social icons, a quiet address.
const html = () => renderToStaticMarkup(HomePage());
const body = () => html().replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script\b[\s\S]*?<\/script>/g, "");
const phone = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;
const INSTAGRAM = "https://www.instagram.com/zeus.otodetailing";
// The opening tag of the first <a> whose tag text matches.
const anchor = (content: string, pattern: RegExp) => content.match(new RegExp(`<a\\b[^>]*${pattern.source}[^>]*>[\\s\\S]*?</a>`));

test("P1-46: the shop's real Instagram page is the one brand setting, not the bare instagram.com placeholder", () => {
  assert.equal(brandConfig.instagram, INSTAGRAM);
  assert.equal(brandConfig.instagramHandle, "@zeus.otodetailing");
});

test("P1-46: one short message says the website is coming and the shop is open, with no repeated lines", () => {
  const content = body();
  assert.equal((content.match(/<h1\b/g) ?? []).length, 1);
  assert.match(content, /<p class="zeus-lede">Our new website is on the way\. The shop is open as usual\.<\/p>/);
  assert.doesNotMatch(content, /zeus-pretitle|zeus-description|zeus-kicker|In progress|getting a new look/);
});

test("P1-56: Book now (to /book) and Manage booking (to /book/manage) are the two main actions, side by side in one row", () => {
  const content = body();
  const row = content.match(/<div class="zeus-actions">([\s\S]*?)<\/div>/);
  assert.ok(row, "actions row present");
  const links = [...row[1].matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
  assert.equal(links.length, 2, "exactly two actions");
  assert.match(links[0], /href="\/book"/);
  assert.match(links[0], />Book now<\/a>/);
  assert.match(links[0], /zeus-seg--primary/);
  assert.match(links[1], /href="\/book\/manage"/);
  assert.match(links[1], />Manage booking<\/a>/);
  assert.doesNotMatch(links[1], /zeus-seg--primary/, "Manage booking is the quieter segment");
  for (const link of links) assert.match(link, /<svg\b[^>]*aria-hidden="true"/, "decorative icon before the label");
});

test("P1-56: Call is a phone icon inside the social row with its tel link, a spoken name with the number, a decorative icon and no visible number", () => {
  const content = body();
  const social = content.match(/<div class="zeus-social">([\s\S]*?)<\/div>/);
  assert.ok(social, "social row present");
  const call = anchor(social[1], /href="tel:[^"]*"/);
  assert.ok(call, "Call link is inside the social row");
  assert.ok(call[0].includes(`href="${phone}"`));
  assert.match(call[0], new RegExp(`aria-label="Call the shop ${brandConfig.displayPhone}"`));
  assert.match(call[0], /<svg\b[^>]*aria-hidden="true"/);
  assert.equal((content.match(/href="tel:/g) ?? []).length, 1, "one phone link on the page");
  assert.doesNotMatch(content, /zeus-coming-soon__call/);
  const text = content.replace(/<[^>]*>/g, " ");
  assert.ok(!text.includes(brandConfig.displayPhone), "the number is in the link name, not visible text");
});

test("P1-46: Facebook and Instagram are icon links with spoken names, safe external attributes and decorative icons", () => {
  const content = body();
  const facebook = anchor(content, /aria-label="Zeus Auto Detailing on Facebook"/);
  const instagram = anchor(content, /aria-label="Zeus Auto Detailing on Instagram"/);
  assert.ok(facebook, "Facebook icon link");
  assert.ok(instagram, "Instagram icon link");
  assert.ok(facebook[0].includes(`href="${brandConfig.facebookPageUrl}"`));
  assert.ok(instagram[0].includes(`href="${INSTAGRAM}"`));
  for (const link of [facebook[0], instagram[0]]) {
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.match(link, /<svg\b[^>]*aria-hidden="true"/, "the icon is hidden from screen readers; the link has its own name");
  }
  assert.doesNotMatch(content, /Message us on Facebook|Find us on Facebook/);
});

test("P1-47: the address is a location icon link to Maps; its spoken name carries the address and no address text is shown", () => {
  const content = body();
  const location = anchor(content, /aria-label="Zeus Auto Detailing location: [^"]*"/);
  assert.ok(location, "location icon link");
  assert.ok(location[0].includes(`aria-label="${brandConfig.businessName} location: ${brandConfig.location}"`));
  assert.ok(location[0].includes("google.com/maps"));
  assert.match(location[0], /target="_blank"/);
  assert.match(location[0], /rel="noopener noreferrer"/);
  assert.match(location[0], /<svg\b[^>]*aria-hidden="true"/, "the icon is decorative; the link has its own name");
  assert.doesNotMatch(location[0], new RegExp(brandConfig.displayPhone));
  assert.doesNotMatch(content, /zeus-contact-line/);
  const text = content.replace(/<[^>]*>/g, " ");
  assert.ok(!text.includes(brandConfig.location), "the address is not visible text; it is in the link name");
});

test("P1-56: reading order is logo, headline, Book now, Manage booking, Call, Facebook, Instagram, location; one logo image with its alt text", () => {
  const content = body();
  const at = (needle: string | RegExp) => (typeof needle === "string" ? content.indexOf(needle) : content.search(needle));
  const order = [
    at(`alt="${brandConfig.businessName}"`),
    at("<h1"),
    at('href="/book"'),
    at('href="/book/manage"'),
    at('aria-label="Call the shop'),
    at('aria-label="Zeus Auto Detailing on Facebook"'),
    at('aria-label="Zeus Auto Detailing on Instagram"'),
    at('aria-label="Zeus Auto Detailing location'),
  ];
  assert.ok(order.every((index) => index >= 0), `all present: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "document order");
  assert.equal(content.split(`alt="${brandConfig.businessName}"`).length - 1, 1);
});

test("P1-46: the page still has no header, footer, nav, form or second heading", () => {
  const content = body();
  assert.doesNotMatch(content, /<header\b|<footer\b|<nav\b|<form\b|<h2\b/);
  assert.equal((content.match(/<main\b/g) ?? []).length, 1);
});
