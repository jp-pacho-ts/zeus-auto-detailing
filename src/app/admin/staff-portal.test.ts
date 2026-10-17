// Run: node --require ./src/server/__tests__/register.cjs --test ./src/app/admin/staff-portal.test.ts
// Regression for the demo login: until P1-06, every /admin route is the static closed page.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const adminDir = path.join(process.cwd(), "src", "app", "admin");
const routeFiles = fs
  .readdirSync(adminDir, { recursive: true, encoding: "utf8" })
  .filter((f) => /(^|[\\/])(page|layout)\.tsx$/.test(f))
  .map((f) => path.join(adminDir, f));

test("covers every admin route", () => {
  const pages = routeFiles.filter((f) => f.endsWith("page.tsx")).length;
  assert.ok(pages >= 7, `expected the 7 admin pages, found ${pages}`);
});

test("no client-side session gate, form or demo credentials in any admin route", () => {
  for (const file of routeFiles) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /sessionStorage|localStorage|zeus_staff_auth/, file);
    assert.doesNotMatch(src, /<form|type="password"|"use client"/, file);
    assert.doesNotMatch(src, /AdminPortal|router\.(push|replace)/, file);
  }
});

test("every admin page renders the closed page and the layout is noindex", () => {
  for (const file of routeFiles.filter((f) => f.endsWith("page.tsx"))) {
    assert.match(fs.readFileSync(file, "utf8"), /<StaffPortalClosed \/>/, file);
  }
  const layout = fs.readFileSync(path.join(adminDir, "layout.tsx"), "utf8");
  assert.match(layout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});
