// Run: node --test .claude/hooks/verify.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// P1-15: Next regenerates next-env.d.ts on every dev, build and typegen run, with different
// contents, so the repository ignores it and type-checking generates it first.
test("the repository ignores and does not track next-env.d.ts, and typecheck runs next typegen first", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  assert.equal(spawnSync("git", ["check-ignore", "-q", "next-env.d.ts"], { cwd: root }).status, 0, "next-env.d.ts is not ignored");
  assert.notEqual(spawnSync("git", ["ls-files", "--error-unmatch", "next-env.d.ts"], { cwd: root }).status, 0, "next-env.d.ts is still tracked");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.typecheck, "next typegen && tsc --noEmit");
});

test("an ignored next-env.d.ts change runs no checks; a source change still does", () => {
  const dir = tempDir();
  const git = (...args) => assert.equal(spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).status, 0, args.join(" "));
  git("init", "-q");
  writeFileSync(path.join(dir, ".gitignore"), "next-env.d.ts\n");
  git("add", ".gitignore");
  git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "init");
  writeFileSync(path.join(dir, "next-env.d.ts"), '/// <reference types="next" />\n');
  const ignored = runHook(dir, { stop_hook_active: false });
  assert.equal(ignored.status, 0);
  assert.equal(ignored.stderr, "");
  // A real source change is still detected: the checks run (and fail here, with no package.json).
  writeFileSync(path.join(dir, "page.ts"), "export const x = 1;\n");
  const changed = runHook(dir, { stop_hook_active: false });
  assert.equal(changed.status, 2);
  assert.match(changed.stderr, /npm run typecheck failed/);
});

// P1-15: `next dev` writes a managed agent-rules block into AGENTS.md when it detects an AI agent,
// which dirties the tree on every agent dev run. The documented opt-out must stay set.
test("next.config disables Next's AGENTS.md/CLAUDE.md agent-rules writer", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const { default: config } = await import(pathToFileURL(path.join(root, "next.config.mjs")).href);
  assert.equal(config.agentRules, false);
});
