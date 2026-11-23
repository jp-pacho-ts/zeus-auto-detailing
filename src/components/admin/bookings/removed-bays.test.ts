/* eslint-disable @typescript-eslint/no-require-imports */
// 2026-11-24: removed bays are brought back on the Bay board (Settings no longer manages bays).
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminBay, AdminContainer } from "@/types/admin-contracts";
import { boardBaysKey, removedBays } from "./removed-bays";

const c = (id: string, sortOrder: number) => ({ id, name: id, sortOrder, isActive: true, usualQueues: [], updatedAt: "x" }) as unknown as AdminContainer;
const b = (id: string, containerId: string, sortOrder: number, isActive = false) =>
  ({ id, name: id, containerId, sortOrder, isActive, updatedAt: "x", bayType: "WASH" }) as AdminBay;

test("removedBays: only removed bays, by container order, orphans last", () => {
  const rows = removedBays([b("p2", "paint", 2), b("w1", "wash", 1), b("live", "wash", 3, true), b("t1", "gone", 1), b("p1", "paint", 1)], [c("paint", 2), c("wash", 1)]);
  assert.deepEqual(rows.map((r) => [r.bay.id, r.container?.id ?? null]), [["w1", "wash"], ["p1", "paint"], ["p2", "paint"], ["t1", null]]);
  assert.deepEqual(removedBays([b("live", "wash", 1, true)], [c("wash", 1)]), []);
});

// Review I1: the lists keep their last answer while reloading, so the open panel (and the focused button) never unmounts mid-save.
function render(bays: AdminBay[], containers: AdminContainer[], loading = false) {
  const kept = require("../team/use-kept-resource");
  mock.method(kept, "useKeptResource", (url: string | null) => ({
    data: url === "/api/admin/bays" ? bays : url === "/api/admin/bay-containers" ? containers : null,
    loading, error: null, reload: async () => {},
  }));
  try {
    return renderToStaticMarkup(createElement(require("./removed-bays").RemovedBays, { refresh: 1, onDone: async () => {} })).replace(/<!-- -->/g, "");
  } finally {
    mock.restoreAll();
  }
}

test("RemovedBays: a removed bay can be brought back; one whose container is gone must be moved first", () => {
  const html = render([b("w1", "wash", 1), b("t1", "gone", 1), b("live", "wash", 2, true)], [c("wash", 1)]);
  assert.match(html, /Removed bays \(2\)/);
  assert.match(html, /aria-label="Removed bays"/);
  assert.match(html, />Bring back w1</);
  assert.match(html, /aria-label="Move t1 to"/);
  assert.doesNotMatch(html, /Bring back t1/, "it cannot be brought back while its container is gone");
  assert.doesNotMatch(html, /Bring back live/, "a working bay is not listed");
});

test("RemovedBays: a reload in flight keeps the list on screen", () => {
  assert.match(render([b("w1", "wash", 1)], [c("wash", 1)], true), />Bring back w1</);
});

test("RemovedBays: nothing on the board when no bay is removed", () => {
  assert.equal(render([b("live", "wash", 1, true)], [c("wash", 1)]), "");
});

test("boardBaysKey: changes when a bay or a container changes, so the list reloads", () => {
  const key = boardBaysKey([{ id: "tent", updatedAt: "1" }, { id: "paint", updatedAt: "1" }], [{ id: "t1", updatedAt: "1" }]);
  assert.equal(boardBaysKey([{ id: "tent", updatedAt: "1" }, { id: "paint", updatedAt: "1" }], [{ id: "t1", updatedAt: "1" }]), key, "same board, same key");
  assert.notEqual(boardBaysKey([{ id: "paint", updatedAt: "1" }], [{ id: "t1", updatedAt: "1" }]), key, "a container was removed");
  assert.notEqual(boardBaysKey([{ id: "tent", updatedAt: "1" }, { id: "paint", updatedAt: "1" }], []), key, "a bay was removed");
  assert.notEqual(boardBaysKey([{ id: "tent", updatedAt: "2" }, { id: "paint", updatedAt: "1" }], [{ id: "t1", updatedAt: "1" }]), key, "a container was renamed");
});
