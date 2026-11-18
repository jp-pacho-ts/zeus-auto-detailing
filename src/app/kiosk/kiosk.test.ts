import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the kiosk starts its own standalone app and reuses the public booking wizard and homepage video", () => {
  const manifest = JSON.parse(readFileSync("public/kiosk/manifest.webmanifest", "utf8"));
  assert.equal(manifest.start_url, "/kiosk");
  assert.equal(manifest.scope, "/kiosk");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) assert.ok(readFileSync("public" + icon.src).length > 0);
  const kiosk = readFileSync("src/app/kiosk/kiosk.tsx", "utf8");
  assert.match(kiosk, /<HomeVideo/);
  assert.match(kiosk, /<BookingWizard kioskOnExit=/);
  const wizard = readFileSync("src/components/booking/booking-wizard.tsx", "utf8");
  assert.match(wizard, /autoComplete=\{kioskOnExit \? "off"/);
  assert.match(wizard, /Next customer/);
});
