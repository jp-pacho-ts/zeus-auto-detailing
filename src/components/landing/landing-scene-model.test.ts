import test from "node:test";
import assert from "node:assert/strict";
import { careTrackRange, careFocusProgress, careShotWindow } from "./landing-scene-model";

test("horizontal care journey centers its first and last cards at different viewport widths", () => {
  for (const viewport of [960, 1200, 1500]) {
    const card = 340, gap = 80, track = card * 3 + gap * 2;
    const range = careTrackRange(viewport, card, track);
    assert.equal(range.start + card / 2, viewport / 2);
    assert.equal(range.end + (card + gap) * 2 + card / 2, viewport / 2);
    const middle = range.start + (range.end - range.start) * careFocusProgress(1, 3);
    assert.equal(middle + card + gap + card / 2, viewport / 2);
  }
});

test("keyboard scene positions are bounded and a single care choice never divides by zero", () => {
  assert.equal(careFocusProgress(0, 3), 0);
  assert.equal(careFocusProgress(1, 3), .5);
  assert.equal(careFocusProgress(2, 3), 1);
  assert.equal(careFocusProgress(-2, 3), 0);
  assert.equal(careFocusProgress(9, 3), 1);
  assert.equal(careFocusProgress(0, 1), 0);
});

test("centered workshop shots have room to hold and room to transition", () => {
  const shots = Array.from({ length: 3 }, (_, i) => careShotWindow(i, 3));
  assert.equal(shots[0].start, 0);
  assert.equal(shots[2].end, 1);
  shots.forEach((shot, i) => {
    const focus = careFocusProgress(i, shots.length);
    assert.ok(shot.start < shot.end && shot.start <= focus && focus <= shot.end);
    if (i > 0) assert.ok(shots[i - 1].end < shot.start);
  });
});
