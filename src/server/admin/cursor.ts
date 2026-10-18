import "server-only";
import { createHash } from "node:crypto";
import { fieldError } from "./errors";

// Keyset cursors (ARCHITECTURE T-019 list semantics): base64url of {"v":1,"s":sort,"f":filterHash,"k":key}.
// Authorization and filters are re-applied on every page, so the cursor needs no signature. A
// search cursor travels only in POST bodies and responses and is never logged.
type Key = (string | number)[];
const MAX = 512;

export const filterHash = (tuple: unknown[]): string => createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex").slice(0, 16);

export function encodeCursor(c: { s: string; f: string; k: Key }): string {
  return Buffer.from(JSON.stringify({ v: 1, s: c.s, f: c.f, k: c.k }), "utf8").toString("base64url");
}

export function decodeCursor(text: string, sort: string, hash: string): Key {
  const bad = () => fieldError("cursor", "This page link is out of date. Start again from the first page.");
  if (text.length > MAX || !/^[A-Za-z0-9_-]+$/.test(text)) throw bad();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(text, "base64url").toString("utf8")); } catch { throw bad(); }
  const c = value as { v?: unknown; s?: unknown; f?: unknown; k?: unknown };
  if (!c || c.v !== 1 || c.s !== sort || c.f !== hash || !Array.isArray(c.k) || c.k.length === 0 || c.k.some((x) => typeof x !== "string" && typeof x !== "number")) throw bad();
  return c.k as Key;
}
