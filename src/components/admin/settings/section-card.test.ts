// 2026-11-25 Settings polish (final-review minors): the card footer keeps its note under a save result, and card ids never clash.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsCard } from "./section-card";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node).replace(/<!-- -->/g, "");

test("a save result shows above the card's note, not instead of it", () => {
  const out = html(createElement(SettingsCard, { title: "Maintenance message", result: "The message was saved.", hint: "12 / 200 characters" }));
  const footer = out.split("data-settings-card-footer")[1] ?? "";
  assert.ok(footer.includes("The message was saved."), footer);
  assert.ok(footer.includes("12 / 200 characters"), "the note stays visible after a save");
  assert.ok(footer.indexOf("The message was saved.") < footer.indexOf("12 / 200 characters"), "the result comes first");
});

test("two cards with the same title still get different heading ids", () => {
  const out = html(createElement(Fragment, null, createElement(SettingsCard, { title: "Status" }), createElement(SettingsCard, { title: "Status" })));
  const ids = [...out.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.match(out, new RegExp(`<h3 id="${id.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c)}"`), id);
});
