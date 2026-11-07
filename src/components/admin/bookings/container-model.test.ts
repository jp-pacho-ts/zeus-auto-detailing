// P1-62 A1: the container rules that need no database or React: where a car may go, the "usually for" prompt, and the card tag.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canPlace, placementPrompt, queueLabel, usualForLine, waitingTag } from "./container-model";

const car = { queueCode: "DETAILING_COATING", queueName: "Detailing & Coating" };

test("no label means no prompt, ever", () => {
  assert.equal(placementPrompt(car, { name: "Express", usualQueues: [] }), null);
});

test("a labelled container prompts only when the car's main service is not in its list", () => {
  assert.equal(placementPrompt(car, { name: "Detailing", usualQueues: ["DETAILING_COATING", "TINT_PPF"] }), null);
  assert.equal(placementPrompt(car, { name: "Tint corner", usualQueues: ["TINT_PPF"] }),
    "This car is a Detailing and coating car and Tint corner is usually for Tint and PPF. Place it anyway?");
  assert.equal(placementPrompt({ queueCode: "WASH", queueName: "Wash" }, { name: "Paint", usualQueues: ["REPAINT"] }),
    "This car is a Wash car and Paint is usually for Repaint. Place it anyway?");
  assert.equal(placementPrompt({ queueCode: "WASH", queueName: "Wash" }, { name: "Mixed", usualQueues: ["DETAILING_COATING", "TINT_PPF", "REPAINT"] }),
    "This car is a Wash car and Mixed is usually for Detailing and coating, Tint and PPF and Repaint. Place it anyway?");
});

test("the plain words for a queue, and a code we do not know is shown as it is", () => {
  assert.deepEqual(["WASH", "DETAILING_COATING", "TINT_PPF", "REPAINT", "OTHER"].map(queueLabel), ["Wash", "Detailing and coating", "Tint and PPF", "Repaint", "OTHER"]);
  assert.equal(usualForLine([]), "No usual service");
  assert.equal(usualForLine(["WASH"]), "Usually for Wash");
  assert.equal(usualForLine(["TINT_PPF", "REPAINT"]), "Usually for Tint and PPF and Repaint");
});

test("any car can go in any empty active bay: the kind of bay no longer matters", () => {
  assert.equal(canPlace({ isActive: true, cards: [] }), true);
  assert.equal(canPlace({ isActive: true, cards: [{ id: "x" }] }), false, "one car per bay");
  assert.equal(canPlace({ isActive: false, cards: [] }), false, "a removed bay takes nothing");
});

test("the Waiting tag is the main service, plus how many more services the booking has", () => {
  const line = (queueCode: string) => ({ id: queueCode, name: queueCode, workStatus: "WAITING" as const, queueCode });
  assert.equal(waitingTag({ queueName: "Wash", lines: [line("WASH")] }), "Wash");
  assert.equal(waitingTag({ queueName: "Wash", lines: [line("WASH"), line("TINT_PPF")] }), "Wash + 1 more");
  assert.equal(waitingTag({ queueName: "Wash", lines: [line("WASH"), line("TINT_PPF"), line("REPAINT")] }), "Wash + 2 more");
  assert.equal(waitingTag({ queueName: "Wash", lines: [] }), "Wash");
});
