// P1-37: the percentage and money helpers. No database, no floating point.
import assert from "node:assert/strict";
import { test } from "node:test";
import { basisPointsToPercent, formatPesos, percentToBasisPoints, safeCentavos } from "./commission";

test("a percentage string becomes exact basis points", () => {
  const cases: [string, number][] = [["0", 0], ["0.0", 0], ["0.00", 0], ["10", 1000], ["10.0", 1000], ["12.5", 1250], ["12.50", 1250], ["7.25", 725], ["0.01", 1], ["99.99", 9999], ["100", 10_000], ["100.0", 10_000], ["100.00", 10_000], [" 15 ", 1500], ["01", 100]];
  for (const [text, bp] of cases) assert.equal(percentToBasisPoints(text), bp, text);
});

test("anything that is not a percentage from 0 to 100 with at most two decimals is refused", () => {
  for (const text of ["", " ", "-1", "-0", "+5", "101", "100.01", "100.1", "1.234", "abc", "10%", "1e2", ".5", "5.", "1,5", "1 0", "0x10", "010", "NaN", "Infinity", "10.5.5"])
    assert.equal(percentToBasisPoints(text), null, JSON.stringify(text));
});

test("basis points print as the shortest exact percentage and round-trip for every possible value", () => {
  assert.deepEqual([0, 1, 725, 1000, 1250, 1260, 9999, 10_000].map(basisPointsToPercent), ["0", "0.01", "7.25", "10", "12.5", "12.6", "99.99", "100"]);
  for (let bp = 0; bp <= 10_000; bp++) assert.equal(percentToBasisPoints(basisPointsToPercent(bp)), bp, String(bp));
});

test("database amounts convert exactly, and one that could not be shown exactly is refused instead of rounded (Codex F2)", () => {
  assert.equal(safeCentavos(BigInt(0)), 0);
  assert.equal(safeCentavos(BigInt(200_000_000)), 200_000_000);
  assert.equal(safeCentavos(BigInt("1000000000000")), 1_000_000_000_000, "the top of the supported range");
  assert.equal(safeCentavos("20000000"), 20_000_000);
  assert.equal(safeCentavos(-250), -250);
  assert.equal(safeCentavos(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.throws(() => safeCentavos(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)), RangeError);
  assert.throws(() => safeCentavos(-BigInt(Number.MAX_SAFE_INTEGER) - BigInt(1)), RangeError);
  assert.throws(() => formatPesos(2 ** 53), RangeError);
  assert.throws(() => formatPesos(1.5), RangeError);
  assert.equal(formatPesos(1_000_000_000_000), "₱10,000,000,000.00");
  assert.equal(formatPesos(200_000_000), "₱2,000,000.00");
});

test("centavos print as pesos with integer arithmetic only", () => {
  assert.equal(formatPesos(0), "₱0.00");
  assert.equal(formatPesos(5), "₱0.05");
  assert.equal(formatPesos(99), "₱0.99");
  assert.equal(formatPesos(100), "₱1.00");
  assert.equal(formatPesos(123_456), "₱1,234.56");
  assert.equal(formatPesos(100_000_000), "₱1,000,000.00");
  assert.equal(formatPesos(-250), "-₱2.50");
});
