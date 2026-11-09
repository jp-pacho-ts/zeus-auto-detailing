// P1-20 / P1-25 layout guards: the sidebar and header stay put while only the content scrolls,
// and nothing scrolls sideways. (P1-62 A2: the bay board's per-type row scroller is gone, so it is no longer an exception.)
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

test("no admin component scrolls sideways except a bay board container's row of bays", () => {
  assert.ok(sources.length >= 10);
  for (const [file, src] of sources) {
    if (file.replace(/\\/g, "/") === "bookings/bay-board.tsx") continue;
    assert.doesNotMatch(src, /overflow-x-(auto|scroll)|overflow-(auto|scroll)\b(?!-)/, file);
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

test("the bay board lays a container's bays out in a sideways-scrolling single row and stretches Waiting and Done", () => {
  const board = fs.readFileSync(path.join(dir, "bookings", "bay-board.tsx"), "utf8");
  assert.match(board, /data-board-row-scroll/);
  assert.match(board, /overflow-x-auto/);
  assert.match(board, /lg:items-stretch/);
});
