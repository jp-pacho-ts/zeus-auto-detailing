// S-04 corpus: pinned, checksummed, reproducible and fail-closed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BLOCKLIST_PATH, BLOCKLIST_SHA256, BlocklistUnavailableError, loadPasswordBlocklist } from "./blocklist";
import { blocklistForm, screenStaffPassword } from "./password";

const generator = path.join(process.cwd(), "src", "server", "auth", "generate-blocklist.mjs");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

test("the bundled corpus matches its pinned checksum and normalization", () => {
  const text = fs.readFileSync(BLOCKLIST_PATH, "utf8").replace(/\r\n/g, "\n");
  assert.equal(sha256(text), BLOCKLIST_SHA256);
  const lines = text.split("\n").filter(Boolean);
  assert.ok(lines.length > 90000, `only ${lines.length} entries`);
  const sorted = [...lines].sort();
  assert.deepEqual(lines, [...new Set(sorted)]);
  for (const line of lines) {
    assert.equal(blocklistForm(line), line);
    assert.ok(Array.from(line).length >= 6);
  }
});

test("the loaded corpus rejects common passwords through the screening forms", () => {
  const isCommon = loadPasswordBlocklist();
  assert.equal(isCommon("password"), true);
  assert.equal(isCommon("qwerty123"), true);
  assert.equal(isCommon("correct horse battery staple zeus"), false);
  const ctx = { email: "owner@example.com", name: "Shop Owner" };
  assert.equal(screenStaffPassword("Password123456789!", ctx, isCommon), "BLOCKLIST");
  assert.equal(screenStaffPassword("iloveyou12345678", ctx, isCommon), "BLOCKLIST");
  assert.equal(screenStaffPassword("plum orbit lantern seventy", ctx, isCommon), null);
});

// Both checkout forms (core.autocrlf gives CRLF on Windows), whatever form this checkout has.
const corpusForms = () => {
  const lf = fs.readFileSync(BLOCKLIST_PATH, "utf8").replace(/\r\n/g, "\n");
  return { LF: lf, CRLF: lf.replace(/\n/g, "\r\n") };
};

test("a missing, empty or altered corpus fails closed in LF and CRLF form", () => {
  for (const [form, text] of Object.entries(corpusForms())) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zeus-blocklist-${form}-`));
    const eol = form === "CRLF" ? "\r\n" : "\n";
    // The unaltered form loads: the checksum covers the corpus, not the line endings.
    const intact = path.join(dir, "intact.txt");
    fs.writeFileSync(intact, text);
    assert.equal(loadPasswordBlocklist(intact, BLOCKLIST_SHA256)("password"), true, form);
    assert.throws(() => loadPasswordBlocklist(path.join(dir, "missing.txt"), BLOCKLIST_SHA256), BlocklistUnavailableError, form);
    const empty = path.join(dir, "empty.txt");
    fs.writeFileSync(empty, "");
    assert.throws(() => loadPasswordBlocklist(empty, sha256("")), BlocklistUnavailableError, form);
    // Removing an entry, appending one and changing one character each alter the corpus.
    const removed = text.split(eol).filter((line) => line !== "password").join(eol);
    const appended = text + "zeusbypass123" + eol;
    const changed = text.replace(`${eol}password${eol}`, `${eol}passwore${eol}`);
    for (const [label, altered] of Object.entries({ removed, appended, changed })) {
      // The fixture must really differ from the corpus, before and after EOL normalization.
      assert.notEqual(altered.replace(/\r\n/g, "\n"), text.replace(/\r\n/g, "\n"), `${form} ${label} fixture is unchanged`);
      const file = path.join(dir, `${label}.txt`);
      fs.writeFileSync(file, altered);
      assert.throws(() => loadPasswordBlocklist(file, BLOCKLIST_SHA256), BlocklistUnavailableError, `${form} ${label}`);
    }
  }
});

test("the generator normalizes, filters, dedupes and sorts a pinned source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeus-blocklist-gen-"));
  const source = path.join(dir, "source.txt");
  fs.writeFileSync(source, ["12345", "Password", "password", "  Two  Words ", "Café au lait", "abc", "tab\there", ""].join("\r\n"));
  const out = path.join(dir, "out.txt");
  const run = spawnSync(process.execPath, [generator, "--source", source, "--source-sha256", sha256(fs.readFileSync(source)), "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.readFileSync(out, "utf8"), ["café au lait", "password", "two words"].join("\n") + "\n");
  const wrong = spawnSync(process.execPath, [generator, "--source", source, "--source-sha256", "0".repeat(64), "--out", out], { encoding: "utf8" });
  assert.notEqual(wrong.status, 0);
});

// Full reproduction needs the pinned source file; see generate-blocklist.mjs for the URL.
test("the bundled corpus regenerates byte-for-byte from the pinned source", { skip: !process.env.BLOCKLIST_SOURCE_PATH }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeus-blocklist-repro-")), "out.txt");
  const run = spawnSync(process.execPath, [generator, "--source", process.env.BLOCKLIST_SOURCE_PATH!, "--out", out], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(sha256(fs.readFileSync(out)), BLOCKLIST_SHA256);
});
