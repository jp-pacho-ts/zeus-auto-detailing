import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AdminDaySchema, AdminIdSchema } from "@/lib/admin-validation";
import { fieldError } from "./errors";

// Keyset cursors (ARCHITECTURE T-019 list semantics): base64url of {"v":1,"s":sort,"f":filterHash,"k":key}.
// Authorization and filters are re-applied on every page, so the cursor needs no signature. A
// search cursor travels only in POST bodies and responses and is never logged.
type Key = (string | number)[];
const MAX = 512;
const Instant = z.string().datetime({ precision: 3, offset: false });
const Frame = z.object({ v: z.literal(1), s: z.enum(["DAY_ASC", "CREATED_AT_DESC"]), f: z.string().regex(/^[a-f0-9]{16}$/), k: z.unknown() }).strict();
const DayKey = z.tuple([AdminDaySchema, Instant, AdminIdSchema]);
const CreatedKey = z.tuple([Instant, AdminIdSchema]);

export const filterHash = (tuple: unknown[]): string => createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex").slice(0, 16);

export function encodeCursor(c: { s: string; f: string; k: Key }): string {
  return Buffer.from(JSON.stringify({ v: 1, s: c.s, f: c.f, k: c.k }), "utf8").toString("base64url");
}

export function decodeCursor(text: string, sort: string, hash: string): Key {
  const bad = () => fieldError("cursor", "This page link is out of date. Start again from the first page.");
  if (text.length > MAX || !/^[A-Za-z0-9_-]+$/.test(text) || Buffer.from(text, "base64url").toString("base64url") !== text) throw bad();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(text, "base64url").toString("utf8")); } catch { throw bad(); }
  const frame = Frame.safeParse(value);
  if (!frame.success || frame.data.s !== sort || frame.data.f !== hash) throw bad();
  const key = (frame.data.s === "DAY_ASC" ? DayKey : CreatedKey).safeParse(frame.data.k);
  if (!key.success) throw bad();
  return key.data;
}
