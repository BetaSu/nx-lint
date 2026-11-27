import * as path from "node:path";
import * as devkit from "@nx/devkit";
import { readNxJson } from "nx/src/config/nx-json";
import { readFileMapCache } from "nx/src/project-graph/nx-deps-cache";
import { flushChanges } from "nx/src/generators/tree";
import {
  ReadOnlyConformanceTree,
  convertToWritable,
} from "../../conformance-tree";
import { resolveRule } from "../../resolve-rule";
import { conformanceRulesRunner } from "../../rules-runner";
import { terminalReporter } from "../../terminal-reporter";
import type {
  ConformanceReporter,
  NxJsonConformanceConfiguration,
  ConformanceRuleResultWithRuleAndRunnerData,
  RuleStatus,
} from "../../types";

export interface ConformanceArgs {
  verbose?: boolean;
  printConfig?: boolean;
  reporters?: ConformanceReporter[];
}
export interface ConformanceCloudAdapter {
  validateConfiguration: (config?: NxJsonConformanceConfiguration) => void;
  preRuleResolutionHook: (
    config: NxJsonConformanceConfiguration,
  ) => Promise<NxJsonConformanceConfiguration>;
  ruleResolver: (rule: string) => ReturnType<typeof resolveRule>;
  postRuleResolutionHook: () => Promise<void>;
  postResultHook: (result: {
    ruleResults: ConformanceRuleResultWithRuleAndRunnerData[];
  }) => Promise<void>;
}

function validateConfiguration(
  config?: NxJsonConformanceConfiguration,
): asserts config is NxJsonConformanceConfiguration {
  if (!config)
    throw new Error('No "conformance" configuration found in nx.json');
  if (!Array.isArray(config.rules) || !config.rules.length)
    throw new Error("conformance.rules must be a non-empty array");
  for (const rule of config.rules) {
    if (
      rule.projects &&
      (!Array.isArray(rule.projects) ||
        !rule.projects.length ||
        !rule.projects.every(
          (item) =>
            typeof item === "string" ||
            (typeof item?.matcher === "string" &&
              item.matcher.length &&
              typeof item.explanation === "string" &&
              item.explanation.length),
        ))
    )
      throw new Error(
        "rule.projects must contain matcher strings or {matcher, explanation} objects",
      );
    if (
      rule.status &&
      !(["enforced", "evaluated", "disabled"] as RuleStatus[]).includes(
        rule.status,
      )
    )
      throw new Error("rule.status must be enforced, evaluated or disabled");
  }
}
const localAdapter: ConformanceCloudAdapter = {
  validateConfiguration,
  preRuleResolutionHook: async (config) => config,
  ruleResolver: async (rule) => ({
    error: new Error(
      "Cloud rule " +
        rule +
        " requires a Cloud adapter; no Cloud connection is implemented.",
    ),
    data: null,
  }),
  postRuleResolutionHook: async () => {},
  postResultHook: async () => {},
};
function conformanceHandler(
  args: ConformanceArgs,
  runFixGenerators: boolean | "silent",
  cloudAdapter?: ConformanceCloudAdapter,
): Promise<number>;
async function conformanceHandler(
  args: ConformanceArgs = {},
  runFixGenerators: boolean | "silent" = false,
  cloudAdapter: ConformanceCloudAdapter = localAdapter,
): Promise<number> {
  try {
    const projectGraph = await devkit.createProjectGraphAsync();
    const fileMapCache = readFileMapCache();
    if (!fileMapCache)
      throw new Error(
        "Nx file-map cache is unavailable. Rebuild the project graph.",
      );
    const config = (
      readNxJson() as { conformance?: NxJsonConformanceConfiguration } | null
    )?.conformance;
    cloudAdapter.validateConfiguration(config);
    const resolvedConfig = await cloudAdapter.preRuleResolutionHook(config!);
    const resolutions = await Promise.all(
      resolvedConfig.rules.map(({ rule, options, projects, status }) =>
        rule.startsWith("nx-cloud:")
          ? cloudAdapter.ruleResolver(rule)
          : resolveRule({ rule, options, projects, status }),
      ),
    );
    const loadedRules = resolutions.map((resolution) => {
      if (resolution.error) throw resolution.error;
      return resolution.data!;
    });
    if (args.printConfig) {
      console.log(JSON.stringify(resolvedConfig, null, 2));
      return 0;
    }
    await cloudAdapter.postRuleResolutionHook();
    const tree = new ReadOnlyConformanceTree(
      devkit.workspaceRoot,
      !!args.verbose,
    );
    const params = { tree, projectGraph, fileMapCache, loadedRules };
    const result = await conformanceRulesRunner({
      ...params,
      applyFixGenerators: !!runFixGenerators,
    });
    const changes = convertToWritable(tree).listChanges();
    if (runFixGenerators) {
      flushChanges(devkit.workspaceRoot, changes);
      if (runFixGenerators !== "silent") {
        const after = await conformanceRulesRunner({
          ...params,
          applyFixGenerators: false,
        });
        for (const [index, next] of after.ruleResults.entries()) {
          const prior = result.ruleResults[index].runnerData;
          result.ruleResults[index] = {
            ...next,
            runnerData: {
              ...prior,
              countOfViolationsFixedByGenerator:
                prior.countOfOriginalViolations -
                prior.countOfViolationsFilteredByProjects -
                next.details.violations.length,
            },
          };
        }
      }
    }
    terminalReporter(result);
    for (const reporter of args.reporters ?? []) {
      try {
        await reporter(result);
      } catch (error) {
        console.warn("Conformance reporter failed:", error);
      }
    }
    if (resolvedConfig.outputPath !== false)
      devkit.writeJsonFile(
        path.join(
          devkit.workspaceRoot,
          resolvedConfig.outputPath || "dist/conformance-result.json",
        ),
        result,
      );
    await cloudAdapter.postResultHook(result);
    const failures = result.ruleResults.filter(
      (rule) => rule.details.violations?.length,
    );
    console.log(
      failures.length
        ? "Conformance checks require attention"
        : "Conformance checks passed successfully",
    );
    return failures.some((rule) => rule.resolvedStatus === "enforced") ? 1 : 0;
  } catch (error) {
    console.error(
      args.verbose
        ? error
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return 1;
  }
}
export { conformanceHandler, validateConfiguration };
