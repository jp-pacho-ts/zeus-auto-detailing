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
test("one keyboard/drag payload uses revision; STAFF, wrong-type, inactive and busy drops are unavailable", () => {
  const card = {
    id: "car",
    revision: 7,
    queueCode: "WASH",
    assignedBayId: null,
  };
  const bay = {
    id: "bay",
    bayType: "WASH" as const,
    isActive: true,
    cards: [],
  };
  assert.equal(canDrop("ADMIN", card, bay, "WASH"), true);
  assert.equal(canDrop("STAFF", card, bay, "WASH"), false);
  assert.equal(
    canDrop("ADMIN", card, { ...bay, cards: [card] }, "WASH"),
    false,
  );
  assert.equal(canDrop("ADMIN", card, bay, "PAINT"), false);
  assert.equal(
    canDrop("ADMIN", card, { ...bay, isActive: false }, "WASH"),
    false,
  );
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
