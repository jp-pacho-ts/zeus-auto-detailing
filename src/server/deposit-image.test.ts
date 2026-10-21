import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectDepositImage, MAX_PROOF_BYTES, MAX_PROOF_DIMENSION } from "./deposit-image";
import { chunk, jpeg, le32, png, riff, seg, vp8l, wchunk, webpExtended } from "./deposit-image.fixture";

// P1-18: the canaries stand in for camera metadata (EXIF GPS, PNG text, WebP XMP) that must
// never be stored or served.
const CANARY = "GPS-CANARY-14.5995N-120.9842E";
const has = (b: Buffer, s: string) => b.includes(Buffer.from(s, "latin1"));
const ok = (bytes: Buffer) => {
  const r = inspectDepositImage(bytes);
  assert.ok(r.ok, JSON.stringify(r));
  return r.ok ? r : (undefined as never);
};
const refused = (bytes: Buffer, reason: "TYPE" | "SIZE") => assert.deepEqual(inspectDepositImage(bytes), { ok: false, reason });

test("PNG, JPEG and WebP are accepted by content, with server-derived type and size", () => {
  const p = ok(png(3, 2));
  assert.deepEqual([p.contentType, p.width, p.height], ["image/png", 3, 2]);
  const j = ok(jpeg(5, 4));
  assert.deepEqual([j.contentType, j.width, j.height], ["image/jpeg", 5, 4]);
  const w = ok(riff([vp8l(7, 6)]));
  assert.deepEqual([w.contentType, w.width, w.height], ["image/webp", 7, 6]);
  assert.equal(p.data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("wrong types are refused: GIF, PDF, BMP, text, empty", () => {
  refused(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"), "TYPE");
  refused(Buffer.from("%PDF-1.7\n1 0 obj\n", "latin1"), "TYPE");
  refused(Buffer.concat([Buffer.from("BM"), Buffer.alloc(60)]), "TYPE");
  refused(Buffer.from("just some text"), "TYPE");
  refused(Buffer.alloc(0), "TYPE");
});

test("disguised types are refused: HTML, SVG and script content named or typed as an image", () => {
  refused(Buffer.from("<!doctype html><script>alert(1)</script>"), "TYPE");
  refused(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "TYPE");
  refused(Buffer.from("<?xml version=\"1.0\"?><svg/>"), "TYPE");
  refused(Buffer.from("alert(document.cookie)//.png"), "TYPE");
  // A real signature followed by markup is not an image.
  refused(Buffer.concat([png().subarray(0, 8), Buffer.from("<html><script>alert(1)</script></html>")]), "TYPE");
  refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("<script>alert(1)</script>")]), "TYPE");
  refused(Buffer.concat([Buffer.from("RIFF"), le32(30), Buffer.from("WEBP<script>alert(1)</script>")]), "TYPE");
});

test("truncated or corrupt files are refused", () => {
  const p = png();
  refused(p.subarray(0, p.length - 12), "TYPE"); // no IEND
  const bad = Buffer.from(p);
  bad[bad.length - 20] ^= 0xff; // IDAT CRC mismatch
  refused(bad, "TYPE");
  const j = jpeg();
  refused(j.subarray(0, j.length - 2), "TYPE"); // no EOI
  refused(riff([wchunk("EXIF", Buffer.from("x"))]), "TYPE"); // no image data
  refused(png(2, 2, [chunk("ABCD", Buffer.from("x"))]), "TYPE"); // unknown critical chunk
});

test("metadata and trailing bytes are removed before storage (EXIF, text, XMP, ICC, appended HTML)", () => {
  const p = ok(png(2, 2, [chunk("tEXt", Buffer.from("Comment\0" + CANARY)), chunk("eXIf", Buffer.from(CANARY)), chunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0" + CANARY))], Buffer.from("<html>" + CANARY)));
  assert.equal(has(p.data, CANARY), false);
  assert.equal(has(p.data, "<html>"), false);
  assert.ok(p.data.subarray(-12).equals(chunk("IEND", Buffer.alloc(0))));
  const j = ok(jpeg(2, 2, [seg(0xe1, Buffer.from("Exif\0\0" + CANARY)), seg(0xfe, Buffer.from(CANARY)), seg(0xe2, Buffer.from("ICC_PROFILE\0" + CANARY))], Buffer.from("<script>" + CANARY)));
  assert.equal(has(j.data, CANARY), false);
  assert.equal(has(j.data, "<script>"), false);
  assert.deepEqual([...j.data.subarray(-2)], [0xff, 0xd9]);
  assert.ok(has(j.data, "\x12\x34\xff\x00\x56\xff\xd0\x78"), "entropy data and restart markers kept");
  const w = ok(webpExtended([wchunk("ICCP", Buffer.from(CANARY)), wchunk("EXIF", Buffer.from(CANARY)), wchunk("XMP ", Buffer.from(CANARY))]));
  assert.equal(has(w.data, CANARY), false);
  assert.equal(w.data.readUInt32LE(4), w.data.length - 8, "RIFF size rewritten");
  assert.equal(w.data[20] & (0x20 | 0x08 | 0x04), 0, "VP8X metadata flags cleared");
});

test("size and dimension bounds", () => {
  assert.equal(MAX_PROOF_BYTES, 5 * 1024 * 1024);
  refused(Buffer.concat([png(), Buffer.alloc(MAX_PROOF_BYTES)]), "SIZE");
  ok(png(MAX_PROOF_DIMENSION, 1));
  refused(png(MAX_PROOF_DIMENSION + 1, 1), "TYPE");
  refused(jpeg(1, MAX_PROOF_DIMENSION + 1), "TYPE");
  refused(riff([vp8l(MAX_PROOF_DIMENSION + 1, 1)]), "TYPE");
});
