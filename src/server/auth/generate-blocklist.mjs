// Generates password-blocklist.txt from a pinned public common-password list (S-04).
//
// Source: SecLists, Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt
//   https://github.com/danielmiessler/SecLists, commit 1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56
//   License: MIT (SecLists). The list is the UK NCSC's top 100,000 passwords from the
//   Have I Been Pwned breach corpus.
//
// Usage (from the repository root):
//   node src/server/auth/generate-blocklist.mjs                 # download the pinned file
//   node src/server/auth/generate-blocklist.mjs --source <file> # use a local copy
// The source must match --source-sha256 (default: the pinned file's checksum). Entries are
// normalized like blocklistForm() in password.ts and kept only at 6+ code points. Lines
// with control characters are dropped, since no password may contain them. Nothing is
// ever sent anywhere: the only network call is the optional download of the public list.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://raw.githubusercontent.com/danielmiessler/SecLists/1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt";
const SOURCE_SHA256 = "c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0";
const MIN_CODE_POINTS = 6;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sourcePath = option("--source", null);
const expected = option("--source-sha256", SOURCE_SHA256);
const out = option("--out", path.join(path.dirname(fileURLToPath(import.meta.url)), "password-blocklist.txt"));

let bytes;
if (sourcePath) bytes = fs.readFileSync(sourcePath);
else {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (sha256(bytes) !== expected) {
  process.stderr.write(`Source checksum mismatch: expected ${expected}, got ${sha256(bytes)}\n`);
  process.exit(1);
}

const entries = new Set();
for (const line of bytes.toString("utf8").split(/\r?\n/)) {
  if (CONTROL.test(line)) continue;
  const form = line.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
  if (Array.from(form).length >= MIN_CODE_POINTS) entries.add(form);
}
const text = [...entries].sort().join("\n") + "\n";
fs.writeFileSync(out, text);
process.stdout.write(`${entries.size} entries, sha256 ${sha256(Buffer.from(text, "utf8"))}\n`);
