import test from "node:test";
import assert from "node:assert/strict";
import { careShotIndexAtProgress, careFocusProgress, careShotWindow } from "./landing-scene-model";

test("the workshop counter switches at the midpoint of each wipe", () => {
  const at = (progress: number) => careShotIndexAtProgress(progress, 3);
  assert.deepEqual([-.1, .249, .25, .749, .75, 1.1].map(at), [0, 0, 1, 1, 2, 2]);
  assert.equal(careShotIndexAtProgress(.5, 1), 0);
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
