import { createConformanceRule } from "../../utils/create-conformance-rule";
const rule = createConformanceRule<object>({
  name: "ensure-owners",
  category: "consistency",
  description: "Ensure that all projects have owners defined via Nx Owners.",
  implementation: async ({ projectGraph }) => ({
    severity: "medium",
    details: {
      violations: Object.values(projectGraph.nodes)
        .filter((node) => !Object.keys(node.data.metadata?.owners ?? {}).length)
        .map((node) => ({
          sourceProject: node.name,
          message:
            "This project currently has no owners defined via Nx Owners.",
        })),
    },
  }),
});

export default rule;
