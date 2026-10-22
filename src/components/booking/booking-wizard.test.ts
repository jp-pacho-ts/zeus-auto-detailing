import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { brandConfig } from "@/config/brand";

// P1-12 I2 (Claude review): the customer phone field's example must not be the shop's own number
// (customers copy it, and it shares digits with a published payment number).
const digits = (s: string) => s.replace(/\D/g, "");
test("the customer phone field shows a neutral example, never a shop number", () => {
  const source = readFileSync(path.join(process.cwd(), "src/components/booking/booking-wizard.tsx"), "utf8");
  const field = source.slice(source.indexOf('id="customerPhone"'), source.indexOf("/>", source.indexOf('id="customerPhone"')));
  const placeholder = /placeholder="([^"]*)"/.exec(field)?.[1];
  assert.equal(placeholder, "0917 000 0000");
  const shopNumbers = [brandConfig.supportPhone, brandConfig.contactPhone, brandConfig.displayPhone].map((p) => digits(p).slice(-10));
  assert.ok(shopNumbers.every((n) => n.length === 10 && !digits(placeholder!).endsWith(n)));
});
