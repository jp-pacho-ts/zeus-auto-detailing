// P1-37: the commission rule, in the database. commission_split(base, rates) is the one implementation the accrual
// trigger uses. These tests check the rule's worked examples, its edge cases, and then ~400 generated cases against an
// independent BigInt reference written here. Own sibling database (<T007 name>_split); synthetic data only (this suite
// creates no rows at all). Without T007_TEST_DATABASE_URL the tests skip.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createAndMigrate, siblingDatabaseUrl } from "../catalog-db.fixture";

const url = process.env.T007_TEST_DATABASE_URL;
const skip = !url;
const splitUrl = url ? siblingDatabaseUrl(url, "split") : "postgresql://unused@localhost/zeus_t007_unused_split";
const root = new PrismaClient({ datasources: { db: { url: url || "postgresql://unused@localhost/zeus_t007_unused" } } });
const db = new PrismaClient({ datasources: { db: { url: splitUrl } } });

before(async () => { if (!skip) await createAndMigrate(root, splitUrl); });
after(async () => { await db.$disconnect(); await root.$disconnect(); });

interface Row { idx: number; share: number; amount: number }
async function split(base: number, rates: number[]): Promise<Row[]> {
  const rows = await db.$queryRawUnsafe<{ idx: number; share_centavos: bigint; amount_centavos: bigint }[]>(
    "SELECT idx, share_centavos, amount_centavos FROM commission_split($1::bigint, $2::integer[]) ORDER BY idx", BigInt(base), rates);
  return rows.map((r) => ({ idx: Number(r.idx), share: Number(r.share_centavos), amount: Number(r.amount_centavos) }));
}

// BigInt() calls, not literals: the test tsconfig targets below ES2020.
// The rule, written independently of the SQL (BigInt, no floating point anywhere).
function reference(base: number, rates: number[]): Row[] {
  const n = BigInt(rates.length);
  if (n === BigInt(0)) return [];
  const B = BigInt(base);
  const shares = rates.map((_, i) => B / n + (BigInt(i + 1) <= B % n ? BigInt(1) : BigInt(0)));
  const nums = shares.map((s, i) => s * BigInt(rates[i]));
  const total = (nums.reduce((a, b) => a + b, BigInt(0)) + BigInt(5000)) / BigInt(10000);
  const floors = nums.map((x) => x / BigInt(10000));
  const leftover = Number(total - floors.reduce((a, b) => a + b, BigInt(0)));
  const order = nums.map((x, i) => ({ i, frac: x % BigInt(10000) })).sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));
  const extra = new Set(order.slice(0, leftover).map((o) => o.i));
  return rates.map((_, i) => ({ idx: i + 1, share: Number(shares[i]), amount: Number(floors[i]) + (extra.has(i) ? 1 : 0) }));
}

const amounts = (rows: Row[]) => rows.map((r) => r.amount);
const shares = (rows: Row[]) => rows.map((r) => r.share);

test("P1-37 worked example 1: one person, P123.45 at 10% rounds half up to 1,235 centavos", { skip }, async () => {
  assert.deepEqual(await split(12_345, [1000]), [{ idx: 1, share: 12_345, amount: 1_235 }]);
});

test("P1-37 worked example 2: two people, 100,001 centavos at 10%: the first share gets the extra centavo, amounts 5,000 and 5,000", { skip }, async () => {
  const rows = await split(100_001, [1000, 1000]);
  assert.deepEqual(shares(rows), [50_001, 50_000]);
  assert.deepEqual(amounts(rows), [5_000, 5_000]);
});

test("P1-37 worked example 3: three people, P1,000.00 at 12.5%: leftover centavos go to the largest remainders, amounts add up to exactly 12,500", { skip }, async () => {
  const rows = await split(100_000, [1250, 1250, 1250]);
  assert.deepEqual(shares(rows), [33_334, 33_333, 33_333]);
  assert.deepEqual(amounts(rows), [4_167, 4_167, 4_166]);
  assert.equal(amounts(rows).reduce((a, b) => a + b, 0), 12_500);
});

test("P1-37 worked example 4: different personal percentages, 100,000 centavos, 10% and 15%: 5,000 + 7,500", { skip }, async () => {
  assert.deepEqual(amounts(await split(100_000, [1000, 1500])), [5_000, 7_500]);
});

test("P1-37 worked example 5: nobody credited returns no rows", { skip }, async () => {
  assert.deepEqual(await split(100_000, []), []);
});

test("P1-37 edge cases: zero total, zero percent, 100 percent, one centavo, the maximum total with twenty people", { skip }, async () => {
  assert.deepEqual(amounts(await split(0, [1000, 1000])), [0, 0]);
  assert.deepEqual(amounts(await split(100_000, [0, 0, 0])), [0, 0, 0]);
  assert.deepEqual(amounts(await split(100_000, [10_000])), [100_000]);
  assert.deepEqual(await split(1, [1000]), [{ idx: 1, share: 1, amount: 0 }]);
  const many = await split(100_000_000, Array.from({ length: 20 }, () => 10_000));
  assert.equal(amounts(many).reduce((a, b) => a + b, 0), 100_000_000);
  assert.equal(shares(many).reduce((a, b) => a + b, 0), 100_000_000);
});

// Codex F2: totals above 100,000,000 (several priced lines) are real and must never be clipped. The supported range is
// 0 to 1,000,000,000,000 centavos; the rule is exact there and refuses what is above it.
test("P1-37 large totals: twenty lines of 100,000,000 and the top of the supported range follow the reference exactly, nothing is clipped", { skip }, async () => {
  assert.deepEqual(await split(2_000_000_000, [1000]), [{ idx: 1, share: 2_000_000_000, amount: 200_000_000 }], 'twenty lines of 100,000,000 at 10%');
  assert.deepEqual(await split(200_000_000, [1000]), [{ idx: 1, share: 200_000_000, amount: 20_000_000 }], 'two lines of 100,000,000 at 10%');
  const fifty = Array.from({ length: 50 }, (_, i) => (i * 197) % 10_001);
  for (const base of [100_000_001, 200_000_000, 2_000_000_000, 4_999_999_999, 123_456_789_012, 1_000_000_000_000])
    for (const rates of [[1000], [1000, 1000], [1250, 1250, 1250], [10_000, 10_000], Array.from({ length: 20 }, () => 10_000), fifty, Array.from({ length: 50 }, () => 10_000)]) {
      const got = await split(base, rates);
      assert.deepEqual(got, reference(base, rates), `base ${base}, ${rates.length} people`);
      assert.equal(shares(got).reduce((a, b) => a + b, 0), base, 'the shares add up to the total');
    }
  await assert.rejects(split(1_000_000_000_001, [1000]), /Invalid commission base/);
});

test("P1-37 a negative or missing total is refused, not guessed", { skip }, async () => {
  await assert.rejects(split(-1, [1000]), /Invalid commission base/);
  await assert.rejects(db.$queryRawUnsafe("SELECT * FROM commission_split(NULL::bigint, ARRAY[1000]::integer[])"), /Invalid commission base/);
});

function prng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("P1-37 property: 400 generated cases match the independent reference and keep every invariant", { skip, timeout: 120_000 }, async () => {
  const next = prng(20261105);
  for (let c = 0; c < 400; c++) {
    const n = 1 + Math.floor(next() * 8);
    const base = next() < 0.1 ? Math.floor(next() * 100_000_000) : Math.floor(next() * 5_000_000);
    const rates = Array.from({ length: n }, () => (next() < 0.3 ? 1000 : Math.floor(next() * 10_001)));
    const rows = await split(base, rates);
    assert.deepEqual(rows, reference(base, rates), `case ${c}: base ${base} rates ${rates}`);
    assert.equal(shares(rows).reduce((a, b) => a + b, 0), base, `case ${c}: shares add up to the total`);
    const exactNum = rows.reduce((a, r, i) => a + BigInt(r.share) * BigInt(rates[i]), BigInt(0));
    assert.equal(BigInt(amounts(rows).reduce((a, b) => a + b, 0)), (exactNum + BigInt(5000)) / BigInt(10000), `case ${c}: amounts add up to the rounded total`);
    rows.forEach((r, i) => {
      const floor = Math.floor((r.share * rates[i]) / 10_000);
      assert.ok(r.amount === floor || r.amount === floor + 1, `case ${c} person ${i}: within one centavo of the exact share`);
    });
  }
});
