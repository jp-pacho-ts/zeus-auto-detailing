// P1-07 route handlers before any session: same-origin and JSON rules on every unsafe method,
// 401 for anonymous callers, no-store/no-referrer on every response, and the module boundary.
// No database: an absent cookie never reaches one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";

process.env.APP_ORIGIN = "http://localhost:3000";
process.env.CLIENT_IP_SOURCE = "PROXY_HOPS";
process.env.TRUSTED_PROXY_HOPS = "1";
const ORIGIN = "http://localhost:3000";
const ID = "0b8b3b3e-2b1a-4e5c-9f00-000000000001";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes: [string, string, () => Promise<Record<string, unknown>>, Record<string, string>][] = [
  ["GET", "/api/admin/board?date=2027-03-01", () => import("@/app/api/admin/board/route"), {}],
  ["PUT", `/api/admin/bookings/${ID}/workers/${ID}`, () => import("@/app/api/admin/bookings/[id]/workers/[staffId]/route"), { id: ID, staffId: ID }],
  ["DELETE", `/api/admin/bookings/${ID}/workers/${ID}`, () => import("@/app/api/admin/bookings/[id]/workers/[staffId]/route"), { id: ID, staffId: ID }],
  ["GET", "/api/admin/queues?date=2027-03-01", () => import("@/app/api/admin/queues/route"), {}],
  ["POST", "/api/admin/queues/WASH/days/2027-03-01/order", () => import("@/app/api/admin/queues/[code]/days/[date]/order/route"), { code: "WASH", date: "2027-03-01" }],
  ["GET", "/api/admin/bookings", () => import("@/app/api/admin/bookings/route"), {}],
  ["POST", "/api/admin/bookings/search", () => import("@/app/api/admin/bookings/search/route"), {}],
  ["GET", `/api/admin/bookings/${ID}`, () => import("@/app/api/admin/bookings/[id]/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/status`, () => import("@/app/api/admin/bookings/[id]/status/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/decline`, () => import("@/app/api/admin/bookings/[id]/decline/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/move`, () => import("@/app/api/admin/bookings/[id]/move/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/notify`, () => import("@/app/api/admin/bookings/[id]/notify/route"), { id: ID }],
  ["PUT", `/api/admin/bookings/${ID}/bay`, () => import("@/app/api/admin/bookings/[id]/bay/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/lines`, () => import("@/app/api/admin/bookings/[id]/lines/route"), { id: ID }],
  ["POST", `/api/admin/bookings/${ID}/lines/${ID}/remove`, () => import("@/app/api/admin/bookings/[id]/lines/[lineId]/remove/route"), { id: ID, lineId: ID }],
  ["POST", `/api/admin/bookings/${ID}/lines/${ID}/status`, () => import("@/app/api/admin/bookings/[id]/lines/[lineId]/status/route"), { id: ID, lineId: ID }],
  ["POST", `/api/admin/bookings/${ID}/lines/${ID}/price`, () => import("@/app/api/admin/bookings/[id]/lines/[lineId]/price/route"), { id: ID, lineId: ID }],
  ["GET", "/api/admin/bays", () => import("@/app/api/admin/bays/route"), {}],
  ["POST", "/api/admin/bays", () => import("@/app/api/admin/bays/route"), {}],
  ["PATCH", `/api/admin/bays/${ID}`, () => import("@/app/api/admin/bays/[bayId]/route"), { bayId: ID }],
  ["GET", "/api/admin/schedule/caps?from=2027-03-01&to=2027-03-02", () => import("@/app/api/admin/schedule/caps/route"), {}],
  ["PUT", "/api/admin/schedule/caps/WASH", () => import("@/app/api/admin/schedule/caps/[code]/route"), { code: "WASH" }],
  ["PUT", "/api/admin/schedule/caps/WASH/2027-03-01", () => import("@/app/api/admin/schedule/caps/[code]/[date]/route"), { code: "WASH", date: "2027-03-01" }],
  ["DELETE", "/api/admin/schedule/caps/WASH/2027-03-01", () => import("@/app/api/admin/schedule/caps/[code]/[date]/route"), { code: "WASH", date: "2027-03-01" }],
  ["POST", "/api/admin/customers/history", () => import("@/app/api/admin/customers/history/route"), {}],
  ["GET", "/api/admin/calendar?from=2027-03-01&to=2027-03-07", () => import("@/app/api/admin/calendar/route"), {}],
  ["GET", "/api/admin/schedule", () => import("@/app/api/admin/schedule/route"), {}],
  ["PUT", "/api/admin/schedule/hours", () => import("@/app/api/admin/schedule/hours/route"), {}],
  ["POST", "/api/admin/schedule/closed-dates", () => import("@/app/api/admin/schedule/closed-dates/route"), {}],
  ["DELETE", `/api/admin/schedule/closed-dates/${ID}`, () => import("@/app/api/admin/schedule/closed-dates/[id]/route"), { id: ID }],
];
const call = async (method: string, target: string, load: () => Promise<Record<string, unknown>>, params: Record<string, string>, headers: Record<string, string>, body?: string) => {
  const handler = (await load())[method] as Handler;
  assert.equal(typeof handler, "function", `${method} ${target} is exported`);
  return handler(new NextRequest("http://localhost:3000" + target, { method, headers: { "x-forwarded-for": "198.51.100.7", ...headers }, body }), { params: Promise.resolve(params) });
};
const unsafe = (method: string) => method !== "GET";

test("anonymous callers get 401 on every admin route, with no-store and no-referrer", async () => {
  for (const [method, target, load, params] of routes) {
    const headers: Record<string, string> = unsafe(method) ? { origin: ORIGIN, "content-type": "application/json" } : {};
    const response = await call(method, target, load, params, headers, unsafe(method) ? "{}" : undefined);
    assert.equal(response.status, 401, `${method} ${target}`);
    assert.equal(response.headers.get("cache-control"), "no-store", target);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", target);
    const body = await response.json();
    assert.deepEqual([body.ok, body.error.code, body.error.currentBooking], [false, "UNAUTHENTICATED", null]);
  }
});

test("unsafe methods check the exact origin, Sec-Fetch-Site and JSON content type before the session", async () => {
  for (const [method, target, load, params] of routes.filter(([m]) => unsafe(m))) {
    for (const [label, headers] of [["no origin", { "content-type": "application/json" }], ["cross origin", { origin: "https://evil.example", "content-type": "application/json" }],
      ["cross-site fetch", { origin: ORIGIN, "sec-fetch-site": "cross-site", "content-type": "application/json" }], ["form body", { origin: ORIGIN, "content-type": "text/plain" }]] as const) {
      const response = await call(method, target, load, params, headers, "{}");
      assert.equal(response.status, 403, `${label}: ${method} ${target}`);
    }
    const huge = await call(method, target, load, params, { origin: ORIGIN, "content-type": "application/json" }, JSON.stringify({ x: "a".repeat(17_000) }));
    assert.equal(huge.status, 403, `16 KiB cap: ${target}`);
  }
});

test("only the admin route handlers import the admin services, and no customer route does", () => {
  const roots = [path.join(process.cwd(), "src", "app"), path.join(process.cwd(), "src", "components")];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && /@\/server\/admin/.test(fs.readFileSync(p, "utf8"))
        && !p.split(path.sep).join("/").includes("/src/app/api/admin/")) offenders.push(p);
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, []);
});
