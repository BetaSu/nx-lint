import { formatFiles, joinPathFragments } from "@nx/devkit";
import type { Tree } from "@nx/devkit";
import type { ConformanceRuleCategory } from "../../types";
interface RuleGeneratorOptions {
  name: string;
  directory: string;
  category: ConformanceRuleCategory;
  description?: string;
}
async function createRuleGenerator(
  tree: Tree,
  options: RuleGeneratorOptions,
  importSpecifier = "nx-lint",
): Promise<void> {
  const root = joinPathFragments(options.directory, options.name);
  const definition = [
    "import { createConformanceRule, type ConformanceViolation } from '" +
      importSpecifier +
      "';",
    "",
    "export default createConformanceRule({",
    "  name: " + JSON.stringify(options.name) + ",",
    "  category: " + JSON.stringify(options.category) + ",",
    "  description: " + JSON.stringify(options.description ?? "") + ",",
    "  implementation: async (context) => {",
    "    const violations: ConformanceViolation[] = [];",
    "    return { severity: 'low', details: { violations } };",
    "  },",
    "});",
    "",
  ].join("\n");
  tree.write(joinPathFragments(root, "index.ts"), definition);
  tree.write(
    joinPathFragments(root, "schema.json"),
    JSON.stringify(
      {
        $schema: "http://json-schema.org/schema",
        $id: options.name,
        title: options.name + " rule configuration",
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      null,
      2,
    ) + "\n",
  );
  await formatFiles(tree, { sortRootTsconfigPaths: false });
}
export { createRuleGenerator };
export default createRuleGenerator;
