// Run: node --test .claude/hooks/verify.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const hook = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify.mjs");
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-hook-"));
  dirs.push(dir);
  return dir;
}

function runHook(projectDir, event) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
}

test("stop_hook_active skips all checks", () => {
  assert.equal(runHook(tempDir(), { stop_hook_active: true }).status, 0);
});

test("a clean repository passes without running checks", () => {
  const dir = tempDir();
  assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
  const result = runHook(dir, { stop_hook_active: false });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("a git status failure blocks with a diagnostic instead of passing", () => {
  const result = runHook(tempDir(), { stop_hook_active: false }); // not a repository: git exits 128
  assert.equal(result.status, 2);
  assert.match(result.stderr, /git status failed/);
});
