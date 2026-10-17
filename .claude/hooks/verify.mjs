// Claude Code Stop hook: when code has uncommitted changes, run typecheck and lint and
// send failures back to Claude (exit 2). Never runs build: Next would load the canonical .env.
import { spawnSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let event = {};
try { event = JSON.parse(input || "{}"); } catch { /* treat malformed input as a first stop */ }
if (event.stop_hook_active) process.exit(0); // already continuing because of this hook

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const status = spawnSync("git", [
  "status", "--porcelain", "--",
  "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs", "package.json", "package-lock.json", "tsconfig.json",
  ":(exclude)next-env.d.ts",
], { cwd, encoding: "utf8" });
if (status.status !== 0 || !status.stdout.trim()) process.exit(0);

for (const script of ["typecheck", "lint"]) {
  const run = spawnSync(`npm run ${script}`, { cwd, encoding: "utf8", shell: true });
  if (run.status !== 0) {
    const tail = `${run.stdout}${run.stderr}`.trim().split("\n").slice(-40).join("\n");
    process.stderr.write(`npm run ${script} failed (exit ${run.status}). Fix before finishing:\n${tail}\n`);
    process.exit(2);
  }
}
