import {
  ensurePackage,
  NX_VERSION,
  updateJson,
  readProjectConfiguration,
  updateProjectConfiguration,
  formatFiles,
  runTasksInSerial,
} from "@nx/devkit";
import { createRuleGenerator } from "../create-rule/create-rule";
import type { Tree, GeneratorCallback } from "@nx/devkit";

async function preset(tree: Tree): Promise<GeneratorCallback> {
  const newPlaceholders = ["apps/.gitkeep", "libs/.gitkeep"].filter(
    (file) => !tree.exists(file),
  );
  if (!tree.exists("nx.json")) tree.write("nx.json", "{}");
  updateJson(tree, "package.json", (pkg) => {
    pkg.workspaces ??= [];
    if (!pkg.workspaces.includes("packages/*"))
      pkg.workspaces.push("packages/*");
    return pkg;
  });
  ensurePackage("@nx/js", NX_VERSION);
  const { initGenerator, libraryGenerator, setupPrettierGenerator } =
    require("@nx/js") as typeof import("@nx/js");
  const tasks: GeneratorCallback[] = [];
  tasks.push(await initGenerator(tree, { addTsPlugin: true }));
  tasks.push(
    await libraryGenerator(tree, {
      name: "conformance-rules",
      directory: "packages/conformance-rules",
      config: "npm-scripts",
      useProjectJson: false,
    }),
  );
  updateJson(tree, "nx.json", (config) => {
    config.plugins = (config.plugins ?? []).filter(
      (
        plugin:
          string | { plugin: string; exclude?: string[]; include?: string[] },
      ) => {
        if (typeof plugin === "string") return true;
        if (plugin.plugin !== "@nx/js/typescript") return true;
        if (Array.isArray(plugin.exclude)) return false;
        if (Array.isArray(plugin.include)) delete plugin.include;
        return true;
      },
    );
    return config;
  });
  const packageFile = "packages/conformance-rules/package.json";
  if (tree.exists(packageFile))
    updateJson(tree, packageFile, (pkg) => ({ ...pkg, scripts: {} }));
  for (const file of newPlaceholders)
    if (tree.exists(file)) tree.delete(file);
  tasks.push(await setupPrettierGenerator(tree, {}));
  tree.delete("packages/conformance-rules/src");
  await createRuleGenerator(tree, {
    name: "example-conformance-rule",
    directory: "packages/conformance-rules/src",
    category: "consistency",
    description: "Example workspace rule",
  });
  const project = readProjectConfiguration(tree, "conformance-rules");
  updateProjectConfiguration(tree, "conformance-rules", {
    ...project,
    targets: {
      build: {
        executor: "@beta_su/nx-lint:bundle-rules",
        outputs: ["{options.outputPath}"],
        options: { outputPath: "{projectRoot}/dist" },
      },
    },
  });
  await formatFiles(tree);
  return runTasksInSerial(...tasks);
}
export default preset;
