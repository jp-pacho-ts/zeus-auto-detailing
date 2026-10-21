import { crc32, deflateSync } from "node:zlib";

// P1-18 test fixture: synthetic, structurally valid images only (never a real photo).
const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  return Buffer.concat([be32(data.length), body, be32(crc32(body))]);
}
// A decodable RGB PNG; `fill` varies the pixels so two images differ.
export function png(w = 2, h = 2, extra: Buffer[] = [], trailing = Buffer.alloc(0), fill = 0x7f): Buffer {
  const ihdr = Buffer.concat([be32(w), be32(h), Buffer.from([8, 2, 0, 0, 0])]);
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, fill)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra,
    chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)), trailing]);
}
export const seg = (marker: number, data: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
// Structurally valid baseline JPEG (markers, tables, one scan); not meant to decode.
export function jpeg(w = 2, h = 2, extra: Buffer[] = [], trailing = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("4a46494600010100000100010000", "hex")),
    ...extra,
    seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    seg(0xc0, Buffer.from([8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0])),
    seg(0xc4, Buffer.concat([Buffer.from([0]), Buffer.from([1, ...Array(15).fill(0)]), Buffer.from([0])])),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    Buffer.from([0xff, 0xd9]),
    trailing,
  ]);
}
export const wchunk = (fourcc: string, data: Buffer): Buffer =>
  Buffer.concat([Buffer.from(fourcc, "latin1"), le32(data.length), data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
export function riff(chunks: Buffer[], trailing = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  return Buffer.concat([Buffer.from("RIFF"), le32(body.length), body, trailing]);
}
export function vp8l(w = 2, h = 2): Buffer {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return wchunk("VP8L", Buffer.concat([Buffer.from([0x2f]), le32(bits >>> 0), Buffer.from([0, 0, 0])]));
}
// Extended WebP with the ICC, EXIF and XMP flags set in VP8X.
export function webpExtended(extra: Buffer[], w = 2, h = 2): Buffer {
  const canvas = Buffer.alloc(10);
  canvas[0] = 0x20 | 0x08 | 0x04;
  canvas.writeUIntLE(w - 1, 4, 3);
  canvas.writeUIntLE(h - 1, 7, 3);
  return riff([wchunk("VP8X", canvas), ...extra, vp8l(w, h)]);
}
