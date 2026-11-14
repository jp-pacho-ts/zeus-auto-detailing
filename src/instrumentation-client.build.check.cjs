/* eslint-disable @typescript-eslint/no-require-imports */
// P1-82 build-output check: src/instrumentation-client.ts (Zod jitless) is in the browser bundle only, never in the server output, so the
// server keeps Zod's JIT. Run after `npm run build` in the same checkout: node --test src/instrumentation-client.build.check.cjs
// (NEXT_DIST_DIR overrides the default .next). Not part of npm test, which runs without a build.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(process.env.NEXT_DIST_DIR || '.next');
const CALL = /jitless:\s*(?:!0|true)/; // the minified or plain object literal of config({ jitless: true })

function filesWith(dir) {
  const hits = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(?:js|mjs|cjs|html|rsc)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    if (CALL.test(fs.readFileSync(file, 'utf8'))) hits.push(path.relative(dist, file));
  }
  return hits;
}

test('the Zod jitless setting is in the client bundle and nowhere in the server output', () => {
  assert.ok(fs.existsSync(path.join(dist, 'BUILD_ID')), 'run npm run build first: ' + dist);
  assert.deepEqual(filesWith(path.join(dist, 'server')), [], 'server output carries no jitless setting');
  assert.equal(filesWith(path.join(dist, 'static')).length, 1, 'exactly one client chunk sets jitless');
});
