"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
fs.rmSync(output, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  { cwd: root, stdio: "inherit" },
);

function copyAssets(directory) {
  for (const item of fs.readdirSync(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = path.join(directory, item.name);
    if (item.isDirectory()) copyAssets(relative);
    else if (item.name.endsWith(".json") || item.name.endsWith("__tmpl__")) {
      const target = path.join(output, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, relative), target);
    }
  }
}
copyAssets("src");

// Preserve the existing native CommonJS call convention while TS owns declarations.
function callableEntry(directory, implementation) {
  fs.writeFileSync(
    path.join(output, directory, "entry.cjs"),
    "const implementation = require('./" +
      implementation +
      ".js');\nconst entry = implementation.default;\nObject.assign(entry, implementation);\nmodule.exports = entry;\n",
  );
}
for (const name of ["ensure-owners", "enforce-project-boundaries"]) {
  const directory = "src/rules/" + name;
  // Expose the rule directly and as a default export through the same entry.
  fs.writeFileSync(
    path.join(output, directory, "entry.cjs"),
    "const rule = require('./index.js').default;\nObject.defineProperty(rule, 'default', { value: rule });\nmodule.exports = rule;\n",
  );
}
callableEntry("src/generators/create-rule", "create-rule");
callableEntry("src/executors/bundle-rules", "executor");
for (const name of ["nx-lint", "conformance", "conformance-check"])
  fs.chmodSync(path.join(output, "bin", name + ".js"), 0o755);
console.log(
  "Built TypeScript modules, declarations, Nx assets and compatibility entries.",
);
