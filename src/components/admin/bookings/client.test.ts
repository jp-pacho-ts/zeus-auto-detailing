/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const clientFile = path.join(
  process.cwd(),
  "src/components/admin/bookings/client.ts",
);
const modelFile = path.join(
  process.cwd(),
  "src/components/admin/bookings/model.ts",
);
test("P1-08 live client and workflow model replace the fixture-only portal", () => {
  assert.ok(existsSync(clientFile), "live admin HTTP client is required");
  assert.ok(
    existsSync(modelFile),
    "role and revision workflow model is required",
  );
});
const ready = existsSync(clientFile) && existsSync(modelFile);
const load = () => ({ c: require("./client"), m: require("./model") });
test(
  "transport keeps phone in POST JSON, sends cookies and no-store, and handles empty logout",
  { skip: !ready },
  async () => {
    const { c } = load();
    let seen: { url: string; init: RequestInit } | undefined;
    const transport = async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({
        ok: true,
        data: { bookings: [], truncated: false },
      });
    };
    await c.adminRequest(
      "/api/admin/customers/history",
      { method: "POST", body: { phone: "09170000001" } },
      transport,
    );
    assert.equal(seen!.url, "/api/admin/customers/history");
    assert.ok(!seen!.url.includes("0917"));
    assert.equal(seen!.init.cache, "no-store");
    assert.equal(seen!.init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(seen!.init.body)), {
      phone: "09170000001",
    });
    await assert.rejects(() =>
      c.adminRequest(
        "/api/admin/customers/history?phone=09170000001",
        {},
        transport,
      ),
    );
    await assert.rejects(() =>
      c.adminRequest(
        "https://elsewhere.test/api/admin/bookings",
        {},
        transport,
      ),
    );
    const out = await c.adminRequest(
      "/api/admin/auth/logout",
      { method: "POST", body: {} },
      async () => new Response(null, { status: 204 }),
    );
    assert.equal(out, null);
  },
);
test(
  "409 exposes the current booking without retrying a mutation; 401 remains distinct",
  { skip: !ready },
  async () => {
    const { c } = load();
    let calls = 0;
    await assert.rejects(
      () =>
        c.adminRequest(
          "/api/admin/bookings/123/status",
          {
            method: "POST",
            body: { expectedRevision: 1, status: "CONFIRMED" },
          },
          async () => {
            calls++;
            return Response.json(
              {
                ok: false,
                error: {
                  code: "VERSION_CONFLICT",
                  message: "Changed",
                  currentBooking: { id: "123", revision: 2 },
                  fieldErrors: {},
                  retryable: false,
                  commitState: "NOT_COMMITTED",
                },
              },
              { status: 409 },
            );
          },
        ),
      (e: Error & { status: number; currentBooking: { revision: number } }) => {
        assert.equal(e.status, 409);
        assert.equal(e.currentBooking.revision, 2);
        return true;
      },
    );
    assert.equal(calls, 1);
    await assert.rejects(
      () =>
        c.adminRequest("/api/admin/queues?date=2026-10-19", {}, async () =>
          Response.json(
            { ok: false, error: { message: "Sign in" } },
            { status: 401 },
          ),
        ),
      (e: { status: number }) => e.status === 401,
    );
  },
);
test(
  "superseding reads and sign-out invalidate pending responses",
  { skip: !ready },
  () => {
    const { c } = load();
    const gate = c.requestGeneration();
    const old = gate.next(),
      latest = gate.next();
    assert.equal(gate.current(old), false);
    assert.equal(gate.current(latest), true);
    gate.clear();
    assert.equal(gate.current(latest), false);
  },
);
test(
  "legal controls respect STAFF, legacy completion, declined-only reinstate and unfinished lines",
  { skip: !ready },
  () => {
    const { m } = load();
    const booking = {
      status: "PENDING",
      snapshot: "QUEUE_V3",
      cancellationKind: null,
      lines: [{ workStatus: "WAITING", removed: false }],
    };
    assert.deepEqual(m.statusActions(booking, "STAFF"), ["IN_PROGRESS"]);
    assert.deepEqual(m.statusActions(booking, "ADMIN"), [
      "CONFIRMED",
      "IN_PROGRESS",
    ]);
    assert.deepEqual(
      m.statusActions({ ...booking, status: "IN_PROGRESS" }, "STAFF"),
      [],
    );
    assert.deepEqual(
      m.statusActions(
        {
          ...booking,
          status: "IN_PROGRESS",
          lines: [{ workStatus: "DONE", removed: false }],
        },
        "STAFF",
      ),
      ["COMPLETED"],
    );
    assert.deepEqual(
      m.statusActions(
        { ...booking, status: "IN_PROGRESS", snapshot: "LEGACY" },
        "STAFF",
      ),
      ["COMPLETED"],
    );
    assert.deepEqual(
      m.statusActions(
        { ...booking, status: "CANCELLED", cancellationKind: "CUSTOMER" },
        "ADMIN",
      ),
      [],
    );
    assert.deepEqual(
      m.statusActions(
        { ...booking, status: "CANCELLED", cancellationKind: "SHOP_DECLINED" },
        "ADMIN",
      ),
      ["PENDING"],
    );
    assert.deepEqual(
      m.statusActions(
        { ...booking, status: "CANCELLED", cancellationKind: "SHOP_DECLINED" },
        "STAFF",
      ),
      [],
    );
  },
);
test(
  "reorder sends every open member exactly once with its own current revision",
  { skip: !ready },
  () => {
    const { m } = load();
    const all = [
      { id: "a", revision: 2, status: "PENDING" },
      { id: "b", revision: 7, status: "CONFIRMED" },
      { id: "x", revision: 4, status: "CANCELLED" },
    ];
    assert.deepEqual(m.reorderPayload(all, "b", -1), {
      bookings: [
        { id: "b", expectedRevision: 7 },
        { id: "a", expectedRevision: 2 },
      ],
    });
    assert.equal(m.reorderPayload(all, "a", -1), null);
  },
);
test(
  "money input is exact integer centavos, estimates never become final charges",
  { skip: !ready },
  () => {
    const { m } = load();
    assert.equal(m.centavos("123.45"), 12345);
    assert.equal(m.centavos("0"), 0);
    for (const v of ["-1", "1.001", "NaN", "1e3", "", "1000000.01"])
      assert.equal(m.centavos(v), null, v);
    assert.match(
      m.totalLabel({
        currentTotalCentavos: 10000,
        forQuoteCount: 1,
        currentEstimateCentavos: 450000,
      }),
      /for quote/,
    );
    assert.match(
      m.totalLabel({
        currentTotalCentavos: 10000,
        forQuoteCount: 1,
        currentEstimateCentavos: null,
      }),
      /for quote/,
    );
  },
);
test(
  "reinstatement controls hide past and out-of-horizon days",
  { skip: !ready },
  () => {
    const { m } = load();
    const today = m.shopDate(),
      future = new Date(Date.parse(today) + 91 * 86400000)
        .toISOString()
        .slice(0, 10);
    const booking = {
      status: "CANCELLED",
      snapshot: "QUEUE_V3",
      cancellationKind: "SHOP_DECLINED",
      lines: [],
      bookingDate: "2000-01-01",
    };
    assert.deepEqual(m.statusActions(booking, "ADMIN"), []);
    assert.deepEqual(
      m.statusActions({ ...booking, bookingDate: future }, "ADMIN"),
      [],
    );
  },
);
