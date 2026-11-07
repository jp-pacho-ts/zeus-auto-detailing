/* eslint-disable @typescript-eslint/no-require-imports */
// P1-20 item 4 (LE 2026-10-28): bays are added, renamed and removed inline on the board rows,
// through the existing audited bay routes. ADMIN only; remove = deactivate; a busy bay stays.
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addBayRequest, bayNameError, moveBayRequest, removeBayBlocked, removeBayRequest, renameBayRequest } from "./bay-controls";

const bay = (id: string, name: string, bayType: "WASH" | "DETAILING" | "PAINT", cards: { id: string }[] = []) => ({
  id, name, bayType, sortOrder: Number(id.slice(-1)), isActive: true, updatedAt: "2026-10-20T00:00:00.000Z", cards,
});
const bays = [bay("b1", "Wash bay 1", "WASH", [{ id: "car" }]), bay("b2", "Detail bay 1", "DETAILING"), bay("b3", "Paint bay 1", "PAINT")];

test("add, rename and remove send the existing bay routes their exact bodies", () => {
  // P1-62: a bay is added to a container; no bay type is sent any more (it is a placeholder the server fills in).
  assert.deepEqual(addBayRequest("k3", "  Paint bay 2 ", bays), {
    url: "/api/admin/bays", method: "POST", body: { name: "Paint bay 2", containerId: "k3", sortOrder: 4 },
  });
  assert.deepEqual(moveBayRequest(bays[1], "k2"), {
    url: "/api/admin/bays/b2/move", method: "POST", body: { expectedUpdatedAt: "2026-10-20T00:00:00.000Z", containerId: "k2" },
  });
  assert.deepEqual(renameBayRequest(bays[1], " Detail bay A "), {
    url: "/api/admin/bays/b2", method: "PATCH", body: { expectedUpdatedAt: "2026-10-20T00:00:00.000Z", name: "Detail bay A" },
  });
  assert.deepEqual(removeBayRequest(bays[2]), {
    url: "/api/admin/bays/b3", method: "PATCH", body: { expectedUpdatedAt: "2026-10-20T00:00:00.000Z", isActive: false },
  });
});

test("bay names: required, at most 40 characters, not already used (any case), the same name is no change", () => {
  assert.equal(bayNameError("", bays), "Enter a bay name.");
  assert.equal(bayNameError("   ", bays), "Enter a bay name.");
  assert.equal(bayNameError("x".repeat(41), bays), "Use at most 40 characters.");
  assert.equal(bayNameError(" wash BAY 1 ", bays), "A bay with this name already exists.");
  assert.equal(bayNameError("Wash bay 1", bays, "b1"), "That is already this bay's name.");
  assert.equal(bayNameError("Wash bay 2", bays), null);
});

test("a bay with a car in it cannot be removed; the reason is plain", () => {
  assert.equal(removeBayBlocked(bays[0]), "Move the car out of Wash bay 1 before removing it.");
  assert.equal(removeBayBlocked(bays[1]), null);
});

const containers = [
  { id: "k1", name: "Wash", sortOrder: 1, usualQueues: [], updatedAt: "2026-10-20T00:00:00.000Z", bays: [{ ...bays[0], cards: [] }] },
  { id: "k2", name: "Detailing", sortOrder: 2, usualQueues: [], updatedAt: "2026-10-20T00:00:00.000Z", bays: [{ ...bays[1], cards: [] }] },
  { id: "k3", name: "Paint", sortOrder: 3, usualQueues: [], updatedAt: "2026-10-20T00:00:00.000Z", bays: [{ ...bays[2], cards: [] }] },
];
const board = {
  date: "2026-10-20", closed: null, workers: [], containers, waiting: [], done: [],
  queues: [
    { code: "WASH", name: "Wash", bayType: "WASH", waiting: [] },
    { code: "DETAILING_COATING", name: "Detailing + Coating", bayType: "DETAILING", waiting: [] },
    { code: "REPAINT", name: "Repaint", bayType: "PAINT", waiting: [] },
  ],
  bays: bays.map((b) => ({ ...b, cards: [] })),
};
function render(role: "ADMIN" | "STAFF") {
  const resources = require("./use-admin-resource");
  mock.method(resources, "useAdminResource", (url: string | null) => ({
    data: url?.startsWith("/api/admin/board?") ? board : null, loading: false, error: null, reload: async () => {}, setData: () => {},
  }));
  try {
    return renderToStaticMarkup(createElement(require("./bay-board").BayBoard, { role }));
  } finally {
    mock.restoreAll();
  }
}

// P1-22 (LE 2026-10-29): Add bay is a small button that opens a modal, not a full-width block. Its name keeps the visible words first. The
// container goes in aria-label, not an sr-only span: that span is absolutely positioned and escaped the fixed dashboard frame, so the whole
// page scrolled (Claude-QSA, cb63329). P1-62: the button now sits in each CONTAINER header (it used to be in each type row header).
test("ADMIN gets a compact Add bay in every container header and a keyboard menu on every bay; STAFF gets neither", () => {
  const admin = render("ADMIN");
  for (const name of ["Wash", "Detailing", "Paint"]) {
    const start = admin.indexOf(`<article aria-label="${name}"`), heading = admin.indexOf("</h3>", start);
    const add = admin.indexOf(`aria-label="Add bay to ${name}"`, start), firstBay = admin.indexOf("<section", start);
    assert.ok(start > 0 && heading > start && add > heading, name + ": Add bay follows the container heading");
    assert.ok(add < firstBay, name + ": Add bay sits in the container header, before the bays");
    const button = admin.lastIndexOf("<button", add), end = admin.indexOf("</button>", add);
    const tag = admin.slice(button, end);
    assert.match(tag, /aria-haspopup="dialog"/, name + ": Add bay opens a dialog");
    assert.doesNotMatch(tag, /w-full|border-dashed/, name + ": Add bay is compact");
    assert.match(tag, />[^<]*Add bay[^<]*$/, name + ": the visible text is Add bay (label in name)");
  }
  assert.equal(admin.includes("sr-only"), false, "nothing on the board is an absolutely positioned sr-only span");
  assert.equal(admin.includes("<dialog"), false, "no dialog is open until Add bay is clicked");
  for (const b of bays) assert.ok(admin.includes(`aria-label="Options for ${b.name}"`), b.name);
  assert.match(admin, /aria-haspopup="menu"/);
  assert.match(admin, /aria-expanded="false"/);
  const staff = render("STAFF");
  for (const hidden of ["Add bay", "Options for", "aria-haspopup"]) assert.equal(staff.includes(hidden), false, hidden);
});

// P1-62 L2: after a lost response, the retried container/bay change meets a stale-version conflict. It may be someone else's change, so the
// container and bay-move calls close and reload but say RELOADED, never "done"; the older bay rename/remove calls still show the conflict.
test("a stale-version conflict closes and reloads only when the caller says so, without claiming success; every other refusal still shows its words", async () => {
  const { send, RELOADED, removeContainerRequest } = { ...require("./bay-controls"), ...require("./container-controls") };
  const original = globalThis.fetch;
  const reply = (code: string, message: string) => async () => new Response(JSON.stringify({ ok: false, error: { code, message } }), { status: 409 });
  try {
    globalThis.fetch = reply("VERSION_CONFLICT", "Someone else changed this. Reload and try again.") as typeof fetch;
    const request = removeContainerRequest({ id: "k1", updatedAt: "2026-10-20T00:00:00.000Z" });
    assert.equal(await send(request, true), RELOADED, "tolerated: a distinct answer, not a success");
    assert.doesNotMatch(RELOADED, /removed|renamed|moved|saved/i, "it does not claim the caller's own change was applied");
    assert.equal(await send(request), "Someone else changed this. Reload and try again.", "not tolerated: shown");
    globalThis.fetch = reply("NOT_ALLOWED", "Move or remove its bays first.") as typeof fetch;
    assert.equal(await send(request, true), "Move or remove its bays first.", "a different refusal is never swallowed");
  } finally {
    globalThis.fetch = original;
  }
});
