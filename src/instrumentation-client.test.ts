import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// P1-82: the browser entry turns Zod's JIT probe off. npm test runs each file in its own process, so this cannot change the server suites.
test("instrumentation-client sets Zod jitless through the shared global, and does nothing else", async () => {
  const { z } = await import("zod");
  assert.notEqual(z.config().jitless, true, "jitless is off before the file loads");
  await import("./instrumentation-client");
  assert.equal(z.config().jitless, true, "jitless after the file loads");
  // Zod reads this global in its probe (v4/core util.allowsEval); a Zod upgrade that moves it must fail here, not silently in the browser.
  assert.equal((globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless, true);
  // Security C5: one import and one call; no env reads, hooks or other imports. The core entry keeps the public home page small
  // (`import { z } from "zod"` added ~391 KB of script to /, which loads no schema; zod/v4/core adds ~15 KB).
  const code = readFileSync(join(__dirname, "instrumentation-client.ts"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  assert.deepEqual(code, ['import { config } from "zod/v4/core";', "config({ jitless: true });"]);
});
