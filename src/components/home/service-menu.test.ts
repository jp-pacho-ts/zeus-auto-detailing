// Run: node --require ./src/server/__tests__/register.cjs --test ./src/components/home/service-menu.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVICE_MENU } from "./service-menu";

test("lists the six client categories in catalog order, PPF spelled out", () => {
  assert.deepEqual(
    SERVICE_MENU.map((g) => g.name),
    ["Premium Carwash", "Auto Detailing", "Graphene Coating", "Window Tint", "Paint Protection Film", "Repaint"],
  );
});

test("every category has services and names are unique", () => {
  const names = SERVICE_MENU.flatMap((g) => g.services.map((s) => s.name));
  for (const g of SERVICE_MENU) assert.ok(g.services.length > 0, g.name);
  assert.equal(new Set(names).size, names.length);
});

test("no prices, durations, bays or old placeholder services", () => {
  const text = JSON.stringify(SERVICE_MENU);
  assert.doesNotMatch(text, /₱|PHP|\d{1,3},\d{3}|\b\d+\s?(min|hours?)\b/i);
  assert.doesNotMatch(text, /\bbays?\b/i);
  assert.doesNotMatch(text, /Signature 9H Graphene Ceramic Coating|3-Year Commercial Ceramic Shield|Multi-Stage Paint Correction|Full Interior Deep Clean|Premium Exterior Wash/);
});
