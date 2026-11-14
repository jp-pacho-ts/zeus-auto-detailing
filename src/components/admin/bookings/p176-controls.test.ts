/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const html = (type: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(type as never, props));

// P1-76: one select style (own chevron 12 px in, text stops before it) and one 44 px date style.
test("shared Select: native select, appearance-none, pr-9, 44 px, chevron 12 px in", () => {
  const { Select, dateClass } = require("./use-admin-resource");
  const out = html(Select, { "aria-label": "Status", children: createElement("option", { value: "A" }, "A") });
  assert.match(out, /^<span class="relative block mt-1"><select aria-label="Status" class="w-full appearance-none pr-9 min-h-\[44px\]/);
  const chevron = out.match(/<svg[^>]*>/)?.[0] ?? "";
  assert.match(chevron, /aria-hidden="true"/);
  assert.match(chevron, /class="[^"]*pointer-events-none absolute right-3 top-1\/2/);
  assert.match(dateClass, /min-h-\[44px\]/);
  assert.match(dateClass, /min-w-\[10\.5rem\]/);
  assert.doesNotMatch(dateClass, /w-full/, "a date field sizes to its content");
});

// P1-86 (CEO): the P1-76 day stepper, Move-to button and whole-row booking list were reverted with the old Bookings design,
// so their tests went with them (listed in .team/handoffs/P1-86.md). The shared Select and date styles above stay.
