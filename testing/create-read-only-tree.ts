import { workspaceRoot } from "@nx/devkit";
import {
  WritableConformanceTree,
  convertToReadOnly,
} from "../src/conformance-tree";
import { TempFs } from "./temp-fs";

export async function createReadOnlyTree(
  callback?: (tree: WritableConformanceTree) => Promise<void>,
) {
  const initialRoot = workspaceRoot;
  const initialCwd = process.env.INIT_CWD;
  const temporary = new TempFs("nx-lint-rule-");
  const cleanup = () => {
    try {
      temporary.cleanup();
    } finally {
      if (initialCwd === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = initialCwd;
    }
  };
  try {
    const tree = new WritableConformanceTree(temporary.tempDir, false);
    process.env.INIT_CWD = initialRoot;
    tree.write(".prettierrc", JSON.stringify({ singleQuote: true }));
    tree.write(
      "package.json",
      JSON.stringify({
        name: "@proj/source",
        dependencies: {},
        devDependencies: {},
      }),
    );
    tree.write(
      "nx.json",
      JSON.stringify({
        affected: { defaultBase: "main" },
        targetDefaults: { build: { cache: true }, lint: { cache: true } },
      }),
    );
    tree.write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: {} } }),
    );
    await callback?.(tree);
    return { tree: convertToReadOnly(tree), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
