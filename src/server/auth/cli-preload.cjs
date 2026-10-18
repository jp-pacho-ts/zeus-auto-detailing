/* eslint-disable @typescript-eslint/no-require-imports */
// Operator CLIs run outside Next.js. Next enforces the server-only marker at build time;
// here it maps to Next's empty module, as the test loader does. No other behavior changes.
const Module = require("node:module");
const empty = require.resolve("next/dist/compiled/server-only/empty.js");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request === "server-only" ? empty : request, ...args);
};
