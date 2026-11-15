import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
test("CEO override: unlisted public preview has no auth/session gate or private restore guard", () => {
  const page = source("src/app/preview/landing/page.tsx");
  assert.doesNotMatch(page, /getStaffSession|loadAdminPreview|notFound/);
  assert.match(page, /index: false, follow: false/);
  assert.doesNotMatch(source("src/components/landing/landing-lifecycle.tsx"), /pagehide|pageshow|location.reload|auth\/session/);
  assert.doesNotMatch(source("src/proxy.ts"), /previewCookiePresent/);
});
test("public ComingSoon switch and its video remain isolated", () => {
  const home = source("src/app/page.tsx");
  assert.match(home, /RESTORE_ORIGINAL_HOMEPAGE = false/);
  assert.doesNotMatch(home, /LandingPage/);
  assert.doesNotMatch(source("src/components/home/home-video.tsx"), /Pause video|Play video/);
});

test("unverified booking slots are never presented as shop opening hours", () => {
  assert.doesNotMatch(source("src/server/landing/status.ts"), /timeSlot\.findMany/);
  const page = source("src/components/landing/landing-page.tsx");
  assert.match(page, /Call to confirm hours/);
  assert.doesNotMatch(page, /operatingSchedule|Saved opening hours|Saved shop schedule/);
});
