import "server-only";
import { crc32 } from "node:zlib";

// P1-18 deposit proof images. The type comes from the content only (magic bytes and a full
// structural walk), never from a file name or a declared type. The stored copy is rebuilt from
// the image structure alone: camera metadata (EXIF, XMP, text chunks, comments, ICC profiles)
// and anything after the end of the image are dropped, so nothing but pixels is ever served.
// Nothing here decodes pixels; staff browsers do, so dimensions are bounded.
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const MAX_PROOF_DIMENSION = 10_000;
export type ProofContentType = "image/jpeg" | "image/png" | "image/webp";
export type InspectedImage =
  | { ok: true; contentType: ProofContentType; data: Buffer; width: number; height: number }
  | { ok: false; reason: "TYPE" | "SIZE" };

class Malformed extends Error {}
const fail = (): never => { throw new Malformed(); };
const need = (cond: boolean) => { if (!cond) fail(); };
const inBounds = (w: number, h: number) => w >= 1 && h >= 1 && w <= MAX_PROOF_DIMENSION && h <= MAX_PROOF_DIMENSION;

export function inspectDepositImage(input: Uint8Array): InspectedImage {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length > MAX_PROOF_BYTES) return { ok: false, reason: "SIZE" };
  try {
    if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return png(b);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
    if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return webp(b);
  } catch (error) {
    if (!(error instanceof Malformed) && !(error instanceof RangeError)) throw error;
  }
  return { ok: false, reason: "TYPE" };
}

// PNG: every chunk CRC-checked; critical chunks must be known; only rendering chunks are kept.
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs"]);
function png(b: Buffer): InspectedImage {
  const out: Buffer[] = [b.subarray(0, 8)];
  let at = 8, width = 0, height = 0, idat = false, first = true;
  for (;;) {
    need(at + 12 <= b.length);
    const len = b.readUInt32BE(at), type = b.toString("latin1", at + 4, at + 8);
    need(/^[A-Za-z]{4}$/.test(type) && len <= b.length - at - 12);
    const body = b.subarray(at + 4, at + 8 + len);
    need(crc32(body) === b.readUInt32BE(at + 8 + len));
    if (first) {
      need(type === "IHDR" && len === 13);
      width = b.readUInt32BE(at + 8);
      height = b.readUInt32BE(at + 12);
      need(inBounds(width, height));
      first = false;
    } else need(type !== "IHDR");
    const critical = type.charCodeAt(0) < 0x61;
    if (critical) need(PNG_KEEP.has(type));
    if (type === "IDAT") idat = true;
    if (PNG_KEEP.has(type)) out.push(b.subarray(at, at + 12 + len));
    at += 12 + len;
    if (type === "IEND") break;
  }
  need(idat);
  return { ok: true, contentType: "image/png", data: Buffer.concat(out), width, height };
}

// JPEG: walk the marker segments; keep frame, tables, scans and JFIF; drop APP1-APP15 (EXIF,
// XMP, ICC, maker notes) and comments; stop at EOI.
function jpeg(b: Buffer): InspectedImage {
  const out: Buffer[] = [b.subarray(0, 2)];
  let at = 2, width = 0, height = 0, frame = false, scans = 0;
  for (;;) {
    need(at < b.length && b[at] === 0xff);
    while (at < b.length && b[at] === 0xff) at++; // fill bytes
    need(at < b.length);
    const marker = b[at++];
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); break; }
    need(marker !== 0xd8 && marker !== 0x00 && !(marker >= 0xd0 && marker <= 0xd7) && marker !== 0x01);
    need(at + 2 <= b.length);
    const len = b.readUInt16BE(at);
    need(len >= 2 && at + len <= b.length);
    const segment = b.subarray(at - 2, at + len);
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      need(!frame && len >= 8);
      height = b.readUInt16BE(at + 3);
      width = b.readUInt16BE(at + 5);
      need(inBounds(width, height));
      frame = true;
      out.push(Buffer.from([0xff, marker]), b.subarray(at, at + len));
    } else if (marker === 0xe0 || marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xcc) {
      out.push(segment);
    } else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) {
      // metadata: dropped
    } else if (marker === 0xda) {
      need(frame);
      out.push(segment);
      let end = at + len;
      // Entropy-coded data runs to the next marker that is not stuffing (FF00) or a restart.
      for (;;) {
        need(end + 1 < b.length);
        if (b[end] === 0xff && b[end + 1] !== 0x00 && !(b[end + 1] >= 0xd0 && b[end + 1] <= 0xd7)) break;
        end++;
      }
      out.push(b.subarray(at + len, end));
      scans++;
      at = end;
      continue;
    } else fail();
    at += len;
  }
  need(frame && scans > 0);
  return { ok: true, contentType: "image/jpeg", data: Buffer.concat(out), width, height };
}

// WebP: RIFF chunks; keep image, alpha and animation chunks; drop ICCP, EXIF, XMP and unknown
// chunks; clear the VP8X metadata flags and rewrite the RIFF size.
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
function webp(b: Buffer): InspectedImage {
  const size = b.readUInt32LE(4);
  need(size >= 4 && size + 8 <= b.length);
  const end = size + 8, out: Buffer[] = [];
  let at = 12, width = 0, height = 0, image = false, first = true;
  while (at < end) {
    need(at + 8 <= end);
    const fourcc = b.toString("latin1", at, at + 4), len = b.readUInt32LE(at + 4);
    need(/^[\x20-\x7e]{4}$/.test(fourcc) && len <= end - at - 8);
    const data = b.subarray(at + 8, at + 8 + len), padded = len + (len % 2);
    need(at + 8 + padded <= end);
    if (fourcc === "VP8X") {
      need(first && len >= 10);
      width = data.readUIntLE(4, 3) + 1;
      height = data.readUIntLE(7, 3) + 1;
      const copy = Buffer.from(b.subarray(at, at + 8 + padded));
      copy[8] &= ~(0x20 | 0x08 | 0x04);
      out.push(copy);
    } else if (fourcc === "VP8 " || fourcc === "VP8L") {
      if (first) [width, height] = fourcc === "VP8L" ? vp8lSize(data) : vp8Size(data);
      image = true;
      out.push(b.subarray(at, at + 8 + padded));
    } else if (WEBP_KEEP.has(fourcc)) {
      if (fourcc === "ANMF") image = true;
      need(!first);
      out.push(b.subarray(at, at + 8 + padded));
    }
    first = false;
    at += 8 + padded;
  }
  need(image && inBounds(width, height));
  const body = Buffer.concat([Buffer.from("WEBP"), ...out]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return { ok: true, contentType: "image/webp", data: Buffer.concat([head, body]), width, height };
}
function vp8lSize(d: Buffer): [number, number] {
  need(d.length >= 5 && d[0] === 0x2f);
  const bits = d.readUInt32LE(1);
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
}
function vp8Size(d: Buffer): [number, number] {
  need(d.length >= 10 && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a);
  return [d.readUInt16LE(6) & 0x3fff, d.readUInt16LE(8) & 0x3fff];
}
