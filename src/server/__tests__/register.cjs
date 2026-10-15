/* eslint-disable @typescript-eslint/no-require-imports */
// Execute TypeScript tests without tsx's OS-user lookup, unavailable in this sandbox.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith("@/")) request = path.join(root, "src", request.slice(2));
  // Next.js enforces this boundary at build time; the marker has no domain behavior.
  if (request === "server-only") request = path.join(root, "node_modules/next/dist/compiled/server-only/empty.js");
  return resolve.call(this, request, parent, ...args);
};
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
}
