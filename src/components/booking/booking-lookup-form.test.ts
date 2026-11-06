// P1-50: the "Open your booking" lookup as a boarding pass. Behavior and field names stay; the layout is a ticket with a stub.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import { BookingLookupForm, LOOKUP_TEXT } from "./booking-lookup-form";

process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "b34_synthetic_public_site_key";
const markup = () => renderToStaticMarkup(createElement(BookingLookupForm, { onFound: () => {} }));
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

test("the form keeps its name, field ids and field names", () => {
  const m = markup();
  assert.match(m, /<form[^>]*aria-labelledby="lookup-title"/);
  assert.match(m, /id="lookup-title"[^>]*>Find your booking</);
  assert.match(m, /<label[^>]*for="lookup-reference"[^>]*>Reference code</);
  assert.match(m, /<label[^>]*for="lookup-last-name"[^>]*>Last name</);
  assert.match(m, /<input[^>]*id="lookup-reference"[^>]*name="reference"/);
  assert.match(m, /<input[^>]*id="lookup-last-name"[^>]*name="lastName"/);
  assert.match(m, /<button[^>]*type="submit"[^>]*>.*Find my booking/);
});

test("the reference field has its hint, tied to the input", () => {
  const m = markup();
  const hint = /<p[^>]*id="lookup-reference-hint"[^>]*>It starts with ZEUS- and is in your confirmation\.<\/p>/;
  assert.match(m, hint);
  assert.match(m, /<input[^>]*id="lookup-reference"[^>]*aria-describedby="lookup-reference-hint"/);
});

test("boarding pass: the stub carries the logo, the security check and the button, in that order, after the fields", () => {
  const m = markup();
  const stub = m.indexOf('data-part="stub"');
  assert.ok(stub > 0, "a stub part exists");
  assert.ok(m.indexOf('id="lookup-last-name"') < stub, "the fields come first");
  const inStub = m.slice(stub);
  assert.ok(inStub.indexOf(`alt="${brandConfig.businessName}"`) > 0, "the logo (the Logo component) is in the stub");
  assert.ok(inStub.indexOf('type="submit"') > inStub.indexOf(`alt="${brandConfig.businessName}"`), "button after the logo");
  assert.doesNotMatch(m.slice(0, stub), /<img|<svg[^>]*lucide-car/);
  assert.doesNotMatch(m, /lucide-car/, "no car icon");
  assert.match(m, /data-part="stub-mark"/, "the mark spot is its own element, easy to swap");
});

test("one title, no private-code form, no extra help box inside the form", () => {
  const t = text(markup());
  assert.equal((t.match(/Find your booking/g) ?? []).length, 1);
  assert.doesNotMatch(t, /private code|Can't open your booking/i);
});

test("the texts the tests and customers rely on are unchanged", () => {
  assert.equal(LOOKUP_TEXT.notFound, "We couldn't find that booking. Check the reference code and last name.");
  assert.equal(LOOKUP_TEXT.tooMany, "Too many tries. Use the link in your confirmation email, or call the shop.");
  assert.equal(LOOKUP_TEXT.challenge, "Complete the security check again.");
});
