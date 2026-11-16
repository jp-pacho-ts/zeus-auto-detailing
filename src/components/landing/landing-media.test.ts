import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Inspect the shipped container, rather than relying on a playback deadline or a filename.
function elements(data: Buffer, start = 0, end = data.length): { id: number; start: number; end: number }[] {
  const result = [];
  for (let at = start; at < end;) {
    let idBytes = 1; while (idBytes <= 4 && !(data[at] & (1 << (8 - idBytes)))) idBytes++;
    assert.ok(idBytes <= 4);
    const id = data.readUIntBE(at, idBytes); at += idBytes;
    let lengthBytes = 1; while (lengthBytes <= 8 && !(data[at] & (1 << (8 - lengthBytes)))) lengthBytes++;
    assert.ok(lengthBytes <= 6);
    let length = data[at] & ((1 << (8 - lengthBytes)) - 1);
    for (let n = 1; n < lengthBytes; n++) length = length * 256 + data[at + n];
    at += lengthBytes; assert.ok(at + length <= end);
    result.push({ id, start: at, end: at + length }); at += length;
  }
  return result;
}

test("preview clip files are physically <=4.5 seconds, indexed and video-only without private metadata", () => {
  assert.deepEqual(readdirSync("public/media/preview").sort(), ["hero-pass-720.webm", "hero-pass.webm", "hero-terminal.webp"]);
  for (const name of ["hero-pass.webm", "hero-pass-720.webm"]) {
    const data = readFileSync(`public/media/preview/${name}`);
    assert.ok(data.length < 2 * 1024 * 1024);
    const segment = elements(data).find((e) => e.id === 0x18538067)!;
    const contents = elements(data, segment.start, segment.end);
    assert.ok(contents.some((e) => e.id === 0x114d9b74), "seek index");
    assert.ok(contents.some((e) => e.id === 0x1c53bb6b), "keyframe cues");
    assert.ok(contents.every((e) => [0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b].includes(e.id)), "no tags, chapters or attachments");
    const info = contents.find((e) => e.id === 0x1549a966)!;
    const duration = elements(data, info.start, info.end).find((e) => e.id === 0x4489)!;
    assert.equal(data.readDoubleBE(duration.start), 4250);
    const tracks = contents.find((e) => e.id === 0x1654ae6b)!;
    const entries = elements(data, tracks.start, tracks.end);
    assert.equal(entries.length, 1, "no audio track");
    const fields = elements(data, entries[0].start, entries[0].end);
    const kind = fields.find((e) => e.id === 0x83)!;
    assert.equal(data.readUIntBE(kind.start, kind.end - kind.start), 1);
    const codec = fields.find((e) => e.id === 0x86)!;
    assert.equal(data.toString("utf8", codec.start, codec.end), "V_VP9");
    let frames = 0, lastFrameMs = 0;
    for (const cluster of contents.filter((e) => e.id === 0x1f43b675)) {
      const blocks = elements(data, cluster.start, cluster.end), timestamp = blocks.find((e) => e.id === 0xe7)!;
      const base = data.readUIntBE(timestamp.start, timestamp.end - timestamp.start);
      for (const block of blocks.filter((e) => e.id === 0xa3)) { frames++; lastFrameMs = Math.max(lastFrameMs, base + data.readInt16BE(block.start + 1)); }
    }
    assert.equal(frames, 102); assert.ok(lastFrameMs + 1000 / 24 <= 4500);
  }
  const poster = readFileSync("public/media/preview/hero-terminal.webp");
  assert.equal(poster.toString("ascii", 8, 12), "WEBP");
  for (let at = 12; at < poster.length;) { const chunk = poster.toString("ascii", at, at + 4); assert.ok(!["EXIF", "XMP ", "ICCP"].includes(chunk)); const length = poster.readUInt32LE(at + 4); at += 8 + length + (length & 1); }
});
