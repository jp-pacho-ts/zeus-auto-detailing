import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardProgress,
  canDrop,
  bayPayload,
  plateLabel,
  writeFeedback,
} from "./board-model";

test("board progress counts active service lines only; plate fallback preserves real plates", () => {
  assert.deepEqual(
    boardProgress([
      { workStatus: "DONE", removed: false },
      { workStatus: "WAITING", removed: false },
      { workStatus: "DONE", removed: true },
    ]),
    { done: 1, total: 2 },
  );
  assert.deepEqual(boardProgress([]), { done: 0, total: 0 });
  assert.equal(plateLabel("  "), "No plate");
  assert.equal(plateLabel("ABC 123"), "ABC 123");
});
test("one keyboard/drag payload uses revision; STAFF, inactive and busy drops are unavailable, and any queue fits any empty bay", () => {
  const card = {
    id: "car",
    revision: 7,
    queueCode: "WASH",
    assignedBayId: null,
  };
  const bay = {
    id: "bay",
    isActive: true,
    cards: [],
  };
  assert.equal(canDrop("ADMIN", card, bay), true);
  assert.equal(canDrop("STAFF", card, bay), false);
  assert.equal(canDrop("ADMIN", card, { ...bay, cards: [card] }), false);
  // P1-62 (LE 2026-11-07): this line used to assert that a PAINT-type bay refuses a WASH car. A bay has no kind that restricts cars any more,
  // so the same car is accepted by any empty active bay whatever the container is usually for.
  const repaintCar = { ...card, queueCode: "REPAINT" };
  assert.equal(canDrop("ADMIN", repaintCar, bay), true);
  assert.equal(canDrop("ADMIN", { ...card, assignedBayId: "bay" }, bay), false, "already in that bay");
  assert.equal(canDrop("ADMIN", card, { ...bay, isActive: false }), false);
  assert.deepEqual(bayPayload(card, "2026-10-20", "bay"), {
    expectedRevision: 7,
    date: "2026-10-20",
    bayId: "bay",
  });
});
test("capacity refusal is shown once and only VERSION_CONFLICT requests revision review (Claude U1)", () => {
  assert.deepEqual(
    writeFeedback({
      code: "SCHEDULE_CONFLICT",
      message: "Bay is busy.",
      fieldErrors: { bayId: ["Bay is busy."] },
    }),
    { message: "Bay is busy.", review: false },
  );
  assert.equal(
    writeFeedback({ code: "VERSION_CONFLICT", message: "Changed" }).review,
    true,
  );
});

test("QUEUE_V3 completion requires at least one active service", async () => {
  const { statusActions } = await import("./model");
  assert.deepEqual(
    statusActions(
      {
        status: "IN_PROGRESS",
        snapshot: "QUEUE_V3",
        lines: [],
        cancellationKind: null,
      },
      "STAFF",
    ),
    [],
  );
});
