// P1-86 (CEO 2026-11-14): the admin Bookings page and Bay board are back to their pre-P1-76 design (4692fcf), with the fixes kept.
// These pins fail on the P1-76 layout and pass on the restored one; the kept fixes are pinned too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const tab = readFileSync(join(__dirname, "..", "bookings-tab.tsx"), "utf8");
const board = readFileSync(join(__dirname, "bay-board.tsx"), "utf8");
const fields = readFileSync(join(__dirname, "use-admin-resource.tsx"), "utf8");

test("restored Bookings page: the old toolbar, Search as its own mode, the Open button rows and the queue tabs at every width", () => {
  assert.doesNotMatch(tab, /DayStepper/, "no P1-76 day stepper");
  assert.doesNotMatch(tab, /role="search"|aria-label="Search bookings"/, "no always-visible search box on Day");
  assert.match(tab, /aria-label="Previous day"/);
  assert.match(tab, /aria-label="Next day"/);
  assert.match(tab, />\s*Open\s*<\/Button>/, "each row has its Open button");
  assert.doesNotMatch(tab, /id=\{"booking-row-"/, "no whole-row buttons");
  assert.match(tab, /role="tablist" aria-label="Queues" className="flex flex-wrap/, "queue tabs show at every width");
  assert.doesNotMatch(tab, /<label[^>]*sm:hidden">\s*Queue/, "no phone Queue select");
});

test("restored Bay board: the Move car button and the old toolbar; the P1-80 fixes re-applied", () => {
  assert.doesNotMatch(board, /function MoveForm|Move to …|"Move to " \+/, "no P1-76 Move-to control");
  assert.match(board, />\s*Move car\s*<\/Button>/);
  assert.doesNotMatch(board, /DayStepper/, "Board day alone, no stepper");
  assert.match(board, /\{!review && \(\s*<Button variant="outline" disabled=\{busy\} onClick=\{\(\) => void refresh\(\)\}>\s*Refresh board/, "B1: Refresh board in the uncertain-move alert");
  assert.match(board, /data-board-row-scroll className="flex flex-col gap-3\.5 md:flex-row overflow-x-auto p-3\.5"/, "B3: bays stack below md");
});

test("kept fixes: shared Select and 44 px dates on the old controls, pixel-sized squares, focus return through the Open button", () => {
  assert.equal((tab.match(/<Select\b/g) ?? []).length, 2, "Status and Dates use the shared Select");
  assert.doesNotMatch(tab, /<select\b/, "no plain select left");
  assert.equal((tab.match(/className=\{dateClass \+ " block"\}/g) ?? []).length, 3, "Queue day, From and To use the 44 px date style");
  assert.match(tab, /inline-flex h-\[44px\] w-\[44px\]/, "Previous/Next are 44 px in pixels (the admin root is 92.5%)");
  assert.match(board, /className=\{dateBare\}/, "Board day uses the 44 px date style");
  assert.match(fields, /export const dateBare = dateBase;/);
  assert.doesNotMatch(fields, /export function DayStepper/, "the unused stepper is gone");
  assert.match(tab, /id=\{"booking-open-" \+ b\.id\}/);
  assert.match(tab, /document\.getElementById\("booking-open-" \+ row\)\?\.focus\(\)/, "closing the details returns focus to the Open button");
});
