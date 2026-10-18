// Run: node --require ./src/server/__tests__/register.cjs --test ./src/app/admin/staff-portal.test.ts
// P1-06: every /admin page is guarded on the server; the demo sessionStorage gate stays gone.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { safeNextPath } from "@/server/auth/guards";

const adminDir = path.join(process.cwd(), "src", "app", "admin");
const files = fs
  .readdirSync(adminDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => path.join(adminDir, f));
const pages = files.filter((f) => f.endsWith("page.tsx"));
const loginDir = path.join(adminDir, "login");

test("covers every admin route", () => {
  assert.ok(pages.length >= 7, `expected the 7 admin pages, found ${pages.length}`);
});

test("no client-side session gate, storage or demo credentials anywhere under /admin", () => {
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /sessionStorage|localStorage|zeus_staff_auth|zeus_staff_user/, file);
    assert.doesNotMatch(src, /Demo Access|Enter any email|demonstration mode/i, file);
  }
});

test("every admin page except the login page calls requireStaffPage with its own path first", () => {
  for (const file of pages.filter((f) => !f.startsWith(loginDir))) {
    const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const route = "/" + path.relative(path.join(process.cwd(), "src", "app"), path.dirname(file)).split(path.sep).join("/");
    assert.doesNotMatch(src, /"use client"/, file);
    assert.match(src, new RegExp(`export default async function \\w+\\([^)]*\\) \\{\\n  await requireStaffPage\\("${route}"\\);`), file);
  }
});

test("the layout is a noindex Server Component; the login page is a Server Component", () => {
  const layout = fs.readFileSync(path.join(adminDir, "layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /"use client"/);
  assert.match(layout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  const login = fs.readFileSync(path.join(loginDir, "page.tsx"), "utf8");
  assert.doesNotMatch(login, /"use client"/);
  assert.match(login, /getStaffSession\(\)/);
  assert.match(login, /safeNextPath\(/);
});

test("the login form posts JSON to the auth route and leaves paste and autofill alone", () => {
  const form = fs.readFileSync(path.join(loginDir, "login-form.tsx"), "utf8");
  assert.match(form, /fetch\("\/api\/admin\/auth\/login"/);
  assert.match(form, /autoComplete="username"/);
  assert.match(form, /autoComplete="current-password"/);
  assert.doesNotMatch(form, /onPaste|onCopy|password\.trim/);
  // The success body is read before navigating, so the login request completes (browser smoke).
  assert.match(form, /if \(response\.ok\) \{[^}]*await response\.json\(\)[^}]*router\.replace\(next\)/);
});

test("?next= accepts admin paths only (no open redirects)", () => {
  for (const ok of ["/admin", "/admin/bookings", "/admin/bay-calendar"]) assert.equal(safeNextPath(ok), ok);
  for (const bad of ["/admin/login", "//evil.example", "https://evil.example/admin", "/admin/../api", "/admin/Bookings",
    "/admin/bookings?x=1", "/admin/", "/administrator", "/admin//bookings", "", null, ["/admin"], "/admin/bookings/"]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});
