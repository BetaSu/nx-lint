import * as fs from "node:fs";
import * as path from "node:path";
import { build } from "esbuild";
import { readJsonFile } from "@nx/devkit";
import type { ExecutorContext } from "@nx/devkit";
import type { BundleRulesExecutorSchema } from "./schema";
import { dependencyVersion } from "../../utils/package-versions";
function packageName(specifier: string) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}
async function executor(
  options: BundleRulesExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  try {
    const projectRoot =
      context.projectsConfigurations?.projects[context.projectName!]?.root;
    if (!projectRoot) throw new Error("Project root could not be determined");
    const directory = path.join(
      context.root,
      options.rulesDirectory ?? path.join(projectRoot, "src"),
    );
    const output = path.join(context.root, options.outputPath);
    const rules = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    if (!rules.length) throw new Error("No valid rules found");
    const discovered = rules.map((entry) => {
      const root = path.join(directory, entry.name);
      const schemaPath = path.join(root, "schema.json");
      if (
        !fs.existsSync(path.join(root, "index.ts")) ||
        !fs.existsSync(schemaPath)
      )
        throw new Error(
          "Rule " + entry.name + " needs index.ts and schema.json",
        );
      const schema = readJsonFile(schemaPath);
      if (!("$schema" in schema) || schema.type !== "object")
        throw new Error(
          "Rule " + entry.name + " needs an object JSON schema with $schema",
        );
      return { entry, root, schemaPath };
    });
    if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
    for (const { entry, root, schemaPath } of discovered) {
      const target = path.join(output, entry.name);
      const bundled = await build({
        entryPoints: [path.join(root, "index.ts")],
        bundle: true,
        minify: true,
        platform: "node",
        target: "node18",
        outfile: path.join(target, "index.js"),
        external: ["nx", "nx/package.json", "@nx/*", "nx-lint"],
        metafile: true,
      });
      const dependencies: Record<string, string> = {};
      for (const artifact of Object.values(bundled.metafile.outputs))
        for (const item of artifact.imports) {
          if (!item.external || item.path.startsWith("node:")) continue;
          const name = packageName(item.path);
          if (
            name === "nx-lint" ||
            name === "nx" ||
            name.startsWith("@nx/")
          )
            dependencies[name] = dependencyVersion(name, context.root);
        }
      fs.writeFileSync(
        path.join(target, "package.json"),
        JSON.stringify({ private: true, dependencies }, null, 2) + "\n",
      );
      fs.copyFileSync(schemaPath, path.join(target, "schema.json"));
      console.log("Bundled rule: " + entry.name);
    }
    return { success: true };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return { success: false };
  }
}
export default executor;
