import * as path from "node:path";
import { readJsonFile } from "@nx/devkit";
import type { CreateNodesV2 } from "@nx/devkit";
interface LintPluginOptions {
  projectName?: string;
  targetName?: string;
  fixTargetName?: string;
}
const createNodesV2: CreateNodesV2<LintPluginOptions> = [
  "nx.json",
  async (files, options = {}, context) => {
    const config = readJsonFile<{ conformance?: unknown }>(
      path.join(context.workspaceRoot, "nx.json"),
    );
    if (!config.conformance) return files.map((file) => [file, {}]);
    const projectName =
      options.projectName ??
      readJsonFile<{ name: string }>(
        path.join(context.workspaceRoot, "package.json"),
      ).name;
    const targetName = options.targetName ?? "conformance-check";
    return files.map((file) => [
      file,
      {
        projects: {
          ".": {
            name: projectName,
            root: ".",
            targets: {
              [targetName]: {
                executor: "@beta_su/nx-lint:check",
                cache: false,
                options: { fix: false },
                metadata: {
                  description: "Check workspace conformance policies",
                },
              },
              [options.fixTargetName ?? "conformance-fix"]: {
                executor: "@beta_su/nx-lint:check",
                cache: false,
                options: { fix: true },
              },
            },
          },
        },
      },
    ]);
  },
];
export { createNodesV2 };
