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
  assert.match(wizard, /<ol aria-label="Booking steps"/);
  assert.match(wizard, /data-layout=\{kioskOnExit \? "kiosk"/);
  // The bar stays on every kiosk step except the wide services board, whose order panel holds Continue.
  assert.match(wizard, /"sm:px-8" \+ \(step === 2 \? " lg:hidden" : ""\)/);
  assert.match(wizard, /<div className="mt-4 hidden space-y-2 lg:block \[&>button\]:w-full">\{renderPrimary\(\)\}\{renderBack\(\)\}<\/div>/);
});

test("the kiosk flow is an ordering screen in the landing's style", () => {
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  // The booking stage's rules live in the shared stage module (/book uses the same screen); the welcome's in kiosk.module.css.
  const css = readFileSync("src/app/kiosk/kiosk.module.css", "utf8") + readFileSync("src/components/booking/booking-stage.module.css", "utf8");
  assert.match(wizard, /\{renderKioskOrder\(\)\}/);
  assert.match(wizard, />Your order</);
  assert.match(wizard, /md:grid-cols-\[repeat\(auto-fit,minmax\(200px,1fr\)\)\]/);
  for (const part of ["primary", "back", "end-session", "step-number"]) assert.match(wizard, new RegExp(`data-part="${part}"`));
  // Tablet (iPad mini portrait): the bar's total never truncates; only the description shortens.
  assert.match(wizard, /<span data-part="order-line" className="min-w-0 truncate">/);
  assert.match(wizard, /<strong className="shrink-0 text-xl font-extrabold tabular-nums">\{total\.amount\}<\/strong>/);
  // Idle (LE): 10 minutes without activity returns to the start; the last minute is a countdown dialog, not a banner.
  assert.match(wizard, /const KIOSK_IDLE_MS = 10 \* 60_000;/);
  assert.match(wizard, /expiration = window\.setTimeout\(kioskOnExit, KIOSK_IDLE_MS\);/);
  assert.match(wizard, /<KioskIdleDialog deadline=\{kioskWarning\} total=\{KIOSK_WARNING_MS\}/);
  assert.doesNotMatch(wizard, /This session will end soon/);
  assert.match(readFileSync("src/components/booking/kiosk-end-dialog.tsx", "utf8"), /role="timer"/);
  // Loading states use the shared Skeleton (LE): menu cards, pricing and days; the pulse respects reduced motion.
  assert.match(wizard, /import \{ Skeleton \} from "@\/components\/ui\/skeleton";/);
  assert.match(wizard, /data-part="skeleton-card"/);
  assert.ok((wizard.match(/<span className="sr-only">Pricing…<\/span><Skeleton/g) ?? []).length >= 2);
  assert.match(readFileSync("src/components/booking/day-picker.tsx", "utf8"), /<Skeleton key=\{i\} className="h-16 rounded-xl" \/>/);
  assert.match(readFileSync("src/components/ui/skeleton.tsx", "utf8"), /motion-safe:animate-pulse/);
  // End session asks first (LE); Keep booking is the focused default and Escape keeps the order.
  assert.match(wizard, /data-part="end-session" onClick=\{\(\) => setConfirmEnd\(true\)\}/);
  assert.match(wizard, /<KioskEndDialog onKeep=\{\(\) => setConfirmEnd\(false\)\} onEnd=\{\(\) => \{ setConfirmEnd\(false\); kioskOnExit\(\); \}\} \/>/);
  // Ending plays its own exit before the welcome returns; reduced motion resets at once.
  const kioskSource = readFileSync("src/app/kiosk/kiosk.tsx", "utf8");
  assert.match(kioskSource, /<BookingStage ending=\{ending\}>\s+<BookingWizard kioskOnExit=\{end\} \/>/);
  assert.match(kioskSource, /leaveTimer\.current = window\.setTimeout\(reset, END_MS\)/);
  assert.match(css, /\.booking\[data-ending\] :global\(\.wizard-root\) \{\s+animation: fade-out/);
  const dialog = readFileSync("src/components/booking/kiosk-end-dialog.tsx", "utf8");
  assert.match(dialog, /node\?\.showModal\(\);\s+keep\.current\?\.focus\(\);/);
  assert.match(dialog, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); onKeep\(\); \}\}/);
  assert.match(wizard, /\{renderKioskMenu\(\)\}/);
  assert.match(wizard, /<nav aria-label="Service categories"/);
  assert.match(wizard, /<aside aria-label="Your order"/);
  assert.match(wizard, /onChange=\{\(\) => togglePick\(s\)\} className="sr-only"/);
  // Cinematic stage: shop still behind every step, heading wipe and card stagger per step, all behind reduced motion.
  assert.match(readFileSync("src/components/booking/booking-stage.tsx", "utf8"), /<div className=\{styles\.backdrop\} aria-hidden="true">/);
  assert.match(wizard, /key=\{step\}\s+id="wizard-step-title"/);
  const motion = css.slice(css.indexOf("/* The camera pushes in slowly"));
  for (const name of ["push", "wipe-up", "settle"]) assert.match(motion, new RegExp(`animation: ${name} `));
  assert.match(css, /font-family: var\(--display\)/);
  // Type follows /preview/landing: landing fonts only, weights up to 600, section headings in the display face, no monospace.
  assert.match(css, /\.booking \{[^}]*font-family: LandingText, LandingGeist/);
  assert.match(css, /\.booking :global\(:is\(\.font-bold, \.font-extrabold, \.font-black, strong, b\)\) \{\s+font-weight: 600;/);
  assert.match(css, /\.booking :global\(h2\) \{\s+font-family: var\(--display\);/);
  assert.match(css, /\.booking :global\(\.font-mono\) \{\s+font-family: var\(--display\);/);
  assert.match(css, /\.welcome \.bar \{\s+font-family: LandingDisplay/);
  assert.match(css, /clip-path: polygon\(0 0, calc\(100% - var\(--cut\)\) 0/);
});

test("the welcome is a one-screen landing hero attract screen without the services showcase", () => {
  const kiosk = readFileSync("src/app/kiosk/kiosk.tsx", "utf8");
  const css = readFileSync("src/app/kiosk/kiosk.module.css", "utf8");
  assert.match(kiosk, /className=\{`landing \$\{styles\.welcome\}`\} data-leaving=/);
  assert.match(kiosk, /className=\{`landing-hero-art \$\{styles\.art\}`\}/);
  assert.match(kiosk, /Beyond clean<span className="landing-gold-dot">/);
  // One start control (LE): no gold button; "Touch anywhere to begin" is the focusable button, and the whole screen also starts.
  assert.equal(kiosk.match(/<button/g)?.length, 1);
  assert.match(kiosk, /<button ref=\{startButton\} type="button" className=\{styles\.bar\}>Touch anywhere to begin<\/button>/);
  assert.doesNotMatch(kiosk, /landing-kbtn/);
  assert.match(css, /\.bar:focus-visible \{/);
  // Tap to start plays the exit before the booking mounts; reduced motion starts at once.
  assert.match(kiosk, /data-leaving=\{leaving \|\| undefined\} onClick=\{start\}/);
  assert.match(kiosk, /prefers-reduced-motion: reduce\)"\)\.matches\) return setStarted\(true\)/);
  assert.match(kiosk, /setTimeout\(\(\) => setStarted\(true\), EXIT_MS\)/);
  assert.match(css, /\.welcome\[data-leaving\] \.art \{\s+animation: push-out \.95s/);
  assert.doesNotMatch(kiosk, /kiosk-services|landingPhoto\(/);
  assert.match(css, /height: 100svh;[\s\S]*overflow: clip;/);
});
