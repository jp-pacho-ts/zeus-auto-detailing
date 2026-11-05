// P1-37: money and percentage helpers shared by the services, the screens and the tests. No floating point anywhere:
// a percentage is a decimal string with at most two decimals, a rate is an integer in basis points (1000 = 10.00%),
// and money is integer centavos.

/** "12.5" to 1250. Only a string of the form 0 to 100 with at most two decimals is accepted; anything else is null. */
export function percentToBasisPoints(text: string): number | null {
  const match = /^(100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/.exec(text.trim());
  if (!match) return null;
  const [whole, fraction = ""] = match[1].split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

/** 1250 to "12.5", 1000 to "10", 725 to "7.25". The shortest exact text, so it round-trips with percentToBasisPoints. */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.floor(bp / 100), fraction = bp % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * Centavos read from the database (bigint columns come back as bigint, sums as bigint or numeric text) as a JS number.
 * Every amount the database accepts (at most 1,000,000,000,000) is far below Number.MAX_SAFE_INTEGER, so this is exact;
 * if a value ever were not, it throws instead of showing a rounded amount.
 */
export function safeCentavos(value: bigint | number | string): number {
  const big = typeof value === "bigint" ? value : BigInt(value);
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (big > limit || big < -limit) throw new RangeError("An amount is too large to be shown exactly");
  return Number(big);
}

/** 123456 to "₱1,234.56". Integer arithmetic on the centavos; never a float division. */
export function formatPesos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError("An amount is too large to be shown exactly");
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(centavos));
  const pesos = Math.floor(abs / 100), cents = abs % 100;
  return `${sign}₱${pesos.toLocaleString("en-PH")}.${String(cents).padStart(2, "0")}`;
}
