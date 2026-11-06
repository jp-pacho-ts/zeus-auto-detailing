// P1-49: the Manage booking progress bar. Step-based only: no percentage the data does not have, status level only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BookingStatus } from "@/types/contracts";
import { BookingProgress, progressPosition, statusSentence } from "./booking-progress";

const render = (status: BookingStatus) => renderToStaticMarkup(createElement(BookingProgress, { status }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const STEPS = ["Received", "Confirmed", "In service", "Completed"];

test("position: the bar and the car stop at the middle of the current step; completed fills the bar", () => {
  assert.deepEqual(progressPosition(0), { car: 0, fill: 0 });
  assert.deepEqual(progressPosition(1), { car: 12.5, fill: 12.5 });
  assert.deepEqual(progressPosition(2), { car: 37.5, fill: 37.5 });
  assert.deepEqual(progressPosition(3), { car: 62.5, fill: 62.5 });
  assert.deepEqual(progressPosition(4), { car: 87.5, fill: 100 });
});

test("each live status: a progressbar with step text, an ordered list with one aria-current, nothing colour-only", () => {
  const expected: Array<[BookingStatus, number]> = [["PENDING", 1], ["CONFIRMED", 2], ["IN_PROGRESS", 3], ["COMPLETED", 4]];
  for (const [status, step] of expected) {
    const markup = render(status);
    assert.match(markup, /role="progressbar"/);
    assert.match(markup, new RegExp(`aria-valuenow="${step}"`));
    assert.match(markup, /aria-valuemin="1"/);
    assert.match(markup, /aria-valuemax="4"/);
    assert.match(markup, new RegExp(`aria-valuetext="Step ${step} of 4: ${STEPS[step - 1]}"`));
    assert.equal((markup.match(/<ol[ >]/g) ?? []).length, 1);
    assert.equal((markup.match(/aria-current="step"/g) ?? []).length, 1);
    const items = [...markup.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => text(m[1]).replace(/\(done\)|\(current step\)/g, "").trim());
    assert.deepEqual(items, STEPS);
    const current = markup.split("<li").filter((li) => li.includes('aria-current="step"'));
    assert.match(text(current[0]), new RegExp(STEPS[step - 1]));
    assert.match(text(markup), new RegExp(statusSentence(status)));
    // a done step says so in words, not only by colour
    assert.equal((markup.match(/\(done\)/g) ?? []).length, step - 1);
  }
});

test("no invented percentage, and nothing about bays, workers, staff reasons or money", () => {
  for (const status of ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
    const t = text(render(status));
    assert.doesNotMatch(t, /%|percent/i);
    assert.doesNotMatch(t, /\bbay\b|worker|detailer|staff|reason|₱|PHP|price|total/i);
  }
});

test("cancelled: a clear state in words, no progressbar and no current step", () => {
  const markup = render("CANCELLED");
  assert.doesNotMatch(markup, /role="progressbar"/);
  assert.doesNotMatch(markup, /aria-current/);
  assert.match(text(markup), /This booking is cancelled/);
});

test("the sentences are plain words per status and announce politely", () => {
  assert.equal(statusSentence("IN_PROGRESS"), "Your car is being detailed right now");
  assert.match(render("IN_PROGRESS"), /aria-live="polite"/);
  assert.notEqual(statusSentence("PENDING"), statusSentence("CONFIRMED"));
});

test("motion: the shine and the pulse are motion-safe only and the fill has no motion under reduced motion", () => {
  const markup = render("IN_PROGRESS");
  assert.match(markup, /motion-reduce:transition-none/);
  assert.doesNotMatch(markup, /(?<!motion-safe:)animate-zeus/);
  assert.match(markup, /motion-safe:animate-zeus-shine/);
  assert.doesNotMatch(render("COMPLETED"), /animate-zeus-shine/, "a finished bar stops shining");
});
