import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import HomePage from "@/app/page";
import {
  HOME_INTRO_PREPAINT,
  HOME_INTRO_PENDING_CSS,
  HOME_INTRO_PENDING_STYLE_ID,
  HOME_INTRO_PREPAINT_ID,
  HOME_INTRO_SESSION_KEY,
} from "@/components/home/home-intro-prepaint";

const originalMode = process.env.ONLINE_BOOKING_MODE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.ONLINE_BOOKING_MODE;
  else process.env.ONLINE_BOOKING_MODE = originalMode;
});
const render = () => renderToStaticMarkup(HomePage());
// Visible-percentage guard (F4): link/image targets and inline styles are blanked first, so a percent-encoded Maps
// href or next/image's fill style (height:100%) can't trip it, while any number+% in text or in alt, aria-label and
// title still does.
const percentText = (html: string) =>
  /[0-9]+%/.test(html.replace(/\s(?:href|src|srcSet|srcset|sizes|style)="[^"]*"/g, ""));

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
  // The notice stays static: no countdown, canvas, loading percentage or social embeds, and no scripts except the
  // one fixed pre-paint script (P1-26 F2, approved by CLAUDE-PM 2026-10-29), which must match its constant exactly.
  const scripts = [...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal((content.match(/<script\b/g) ?? []).length, 1, "exactly one script");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1].trim(), `id="${HOME_INTRO_PREPAINT_ID}"`, "fixed id, no src or other attributes");
  assert.equal(scripts[0][2], HOME_INTRO_PREPAINT, "script text is byte-equal to the exported constant");
  const rest = content.replace(scripts[0][0], "");
  assert.doesNotMatch(rest, /<script\b|<canvas\b|countdown|instagram\.com/);
  assert.equal(percentText(rest), false, "no visible percentage");
});

test("the visible-percentage guard catches loading percentages and ignores encoded link targets", () => {
  assert.equal(percentText("<p>Loading 45%</p>"), true);
  assert.equal(percentText('<span aria-label="45% loaded"></span>'), true);
  assert.equal(percentText('<img alt="Polish 90% done">'), true);
  assert.equal(percentText('<img style="position:absolute;height:100%" src="/a.jpg?w=100%25">'), false);
  assert.equal(percentText('<a href="https://www.google.com/maps/search/?api=1&amp;query=Brgy%2095">Map</a>'), false);
});

// Runs the real pre-paint script against a minimal fake document. `head` holds the injected pending styles.
function prepaint({ seen = false, reduced = false, storageThrows = false } = {}) {
  const head: { id: string; textContent: string; remove: () => void }[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const stored = new Map<string, string>();
  const sandbox = {
    document: {
      createElement: () => {
        const node = { id: "", textContent: "", remove: () => { const i = head.indexOf(node); if (i >= 0) head.splice(i, 1); } };
        return node;
      },
      head: { appendChild: (node: (typeof head)[number]) => head.push(node) },
    },
    sessionStorage: {
      getItem: () => {
        if (storageThrows) throw new Error("SecurityError");
        return seen ? "seen" : null;
      },
      setItem: (name: string, value: string) => stored.set(name, value),
    },
    matchMedia: () => ({ matches: reduced }),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as Record<string, unknown>;
  sandbox.window = sandbox;
  runInNewContext(HOME_INTRO_PREPAINT, sandbox);
  return { head, listeners, stored, sandbox };
}

test("pre-paint script marks only a fresh, motion-allowed session and never throws", () => {
  const fresh = prepaint();
  assert.equal(fresh.head.length, 1);
  assert.equal(fresh.head[0].id, HOME_INTRO_PENDING_STYLE_ID);
  assert.equal(fresh.head[0].textContent, HOME_INTRO_PENDING_CSS);
  assert.equal(prepaint({ seen: true }).head.length, 0, "repeat visit in the same tab");
  assert.equal(prepaint({ reduced: true }).head.length, 0, "reduced motion");
  assert.equal(prepaint({ storageThrows: true }).head.length, 0, "storage refused");
});

test("pre-paint Escape or a click on the curtain releases the page before the app script loads", () => {
  const escape = prepaint();
  escape.listeners.get("keydown")!({ key: "Tab" });
  assert.equal(escape.head.length, 1);
  assert.equal(escape.stored.size, 0);
  escape.listeners.get("keydown")!({ key: "Escape" });
  assert.equal(escape.head.length, 0);
  assert.equal(escape.listeners.size, 0, "listeners removed");
  assert.equal(escape.stored.get(HOME_INTRO_SESSION_KEY), "seen", "a skip counts as seen");

  const click = prepaint();
  click.listeners.get("click")!({ target: { closest: () => null } });
  assert.equal(click.head.length, 1, "clicks elsewhere are ignored");
  click.listeners.get("click")!({ target: { closest: (selector: string) => (selector === "[data-home-curtain]" ? {} : null) } });
  assert.equal(click.head.length, 0);
});
