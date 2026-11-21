import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the kiosk starts its own standalone app and reuses the public booking wizard and landing hero video", () => {
  const manifest = JSON.parse(readFileSync("public/kiosk/manifest.webmanifest", "utf8"));
  assert.equal(manifest.start_url, "/kiosk");
  assert.equal(manifest.scope, "/kiosk");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) assert.ok(readFileSync("public" + icon.src).length > 0);
  const kiosk = readFileSync("src/app/kiosk/kiosk.tsx", "utf8");
  assert.match(kiosk, /<LandingVideo/);
  assert.match(kiosk, /<BookingWizard kioskOnExit=/);
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  assert.match(wizard, /autoComplete=\{kioskOnExit \? "off"/);
  assert.match(wizard, /Next customer/);
});

test("the kiosk uses a horizontal step header and a persistent action bar", () => {
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  assert.match(wizard, /kioskOnExit && <ol aria-label="Booking steps"/);
  assert.match(wizard, /data-layout=\{kioskOnExit \? "kiosk"/);
  // The bar stays on every kiosk step except the wide services board, whose order panel holds Continue.
  assert.match(wizard, /kioskOnExit \? "sm:px-8" \+ \(step === 2 \? " lg:hidden" : ""\) : "lg:hidden"/);
  assert.match(wizard, /<div className="mt-4 hidden lg:block \[&>button\]:w-full">\{renderPrimary\(\)\}<\/div>/);
});

test("the kiosk flow is an ordering screen in the landing's style", () => {
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  const css = readFileSync("src/app/kiosk/kiosk.module.css", "utf8");
  assert.match(wizard, /kioskOnExit \? renderKioskOrder\(\)/);
  assert.match(wizard, />Your order</);
  assert.match(wizard, /md:grid-cols-\[repeat\(auto-fit,minmax\(200px,1fr\)\)\]/);
  for (const part of ["primary", "back", "end-session", "step-number"]) assert.match(wizard, new RegExp(`data-part="${part}"`));
  assert.match(wizard, /kioskOnExit \? renderKioskMenu\(\) : renderCategories\(\)/);
  assert.match(wizard, /<nav aria-label="Service categories"/);
  assert.match(wizard, /<aside aria-label="Your order"/);
  assert.match(wizard, /onChange=\{\(\) => togglePick\(s\)\} className="sr-only"/);
  assert.match(css, /font-family: var\(--display\)/);
  assert.match(css, /clip-path: polygon\(0 0, calc\(100% - var\(--cut\)\) 0/);
});

test("the welcome is a one-screen landing hero attract screen without the services showcase", () => {
  const kiosk = readFileSync("src/app/kiosk/kiosk.tsx", "utf8");
  const css = readFileSync("src/app/kiosk/kiosk.module.css", "utf8");
  assert.match(kiosk, /className=\{`landing \$\{styles\.welcome\}`\} onClick=\{\(\) => setStarted\(true\)\}/);
  assert.match(kiosk, /className=\{`landing-hero-art \$\{styles\.art\}`\}/);
  assert.match(kiosk, /Beyond clean<span className="landing-gold-dot">/);
  // Kiosk start pattern: one large centred start target plus a full-width touch bar.
  assert.match(kiosk, /type="button" className=\{`landing-pill landing-gold landing-kbtn \$\{styles\.start\}`\}/);
  assert.match(kiosk, /<div className=\{styles\.bar\} aria-hidden="true">/);
  assert.match(css, /\.welcome \.start \{\s+min-width: min\(440px, 80vw\);\s+min-height: 96px;/);
  assert.doesNotMatch(kiosk, /kiosk-services|landingPhoto\(/);
  assert.match(css, /height: 100svh;[\s\S]*overflow: clip;/);
});
