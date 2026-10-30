// P1-20 / P1-25 layout guards: the sidebar and header stay put while only the content scrolls,
// and only the bay board row scroller scrolls sideways from md up.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const dir = path.join(process.cwd(), "src", "components", "admin");
const sources = fs
  .readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as const);
const portal = fs.readFileSync(path.join(dir, "admin-portal.tsx"), "utf8");

test("no admin component outside the bay board row scroller scrolls sideways", () => {
  assert.ok(sources.length >= 10);
  for (const [file, src] of sources) {
    if (file.replace(/\\/g, "/") === "bookings/bay-board.tsx") {
      assert.deepEqual(src.match(/\S*overflow-x-(?:auto|scroll)\S*/g), ["md:overflow-x-auto"], file);
      assert.doesNotMatch(src, /\boverflow-(auto|scroll)\b(?!-)/, file);
    } else {
      assert.doesNotMatch(src, /overflow-x-(auto|scroll)|overflow-(auto|scroll)\b(?!-)/, file);
    }
  }
});

test("the shell is one screen tall; only the content region scrolls, below a header that stays", () => {
  assert.match(portal, /className="[^"]*\bh-dvh\b[^"]*\boverflow-hidden\b/);
  const content = portal.indexOf('id="admin-content"');
  assert.ok(content > 0, "a named content region");
  assert.match(portal.slice(content, content + 300), /overflow-y-auto/);
  const header = portal.indexOf("<header");
  assert.ok(header > 0 && header < content, "the header sits outside (before) the scrolling region");
});

test("phones and tablets get a menu button that opens the same navigation as a drawer", () => {
  assert.match(portal, /aria-controls="admin-nav"/);
  assert.match(portal, /aria-expanded=\{menuOpen\}/);
  assert.match(portal, /id="admin-nav"/);
  assert.match(portal, /Escape/, "Escape closes the drawer");
});

test("each bay board row scrolls sideways from md instead of wrapping columns", () => {
  const board = fs.readFileSync(path.join(dir, "bookings", "bay-board.tsx"), "utf8");
  assert.doesNotMatch(board, /auto-fill/);
  assert.match(board, /\bmd:flex\b[^"]*\bmd:overflow-x-auto\b[^"]*\bmd:overscroll-x-contain\b/);
  assert.match(board, /\bmd:w-60\b[^"]*\bmd:shrink-0\b/);
});
