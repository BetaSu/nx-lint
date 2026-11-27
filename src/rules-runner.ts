import { findMatchingProjects } from "nx/src/utils/find-matching-projects";
import { convertToReadOnly, convertToWritable } from "./conformance-tree";
import type { ConformanceTree } from "./conformance-tree";
import type { ProjectGraph } from "@nx/devkit";
import type { FileMapCache } from "nx/src/project-graph/nx-deps-cache";
import type { SuccessfulResolveRuleResultData } from "./resolve-rule";
import type {
  ConformanceRuleFixGenerator,
  ConformanceRuleResult,
  ConformanceRuleResultWithRuleAndRunnerData,
} from "./types";

type RunnerOptions = {
  tree: ConformanceTree;
  projectGraph: ProjectGraph;
  fileMapCache: FileMapCache;
  loadedRules: SuccessfulResolveRuleResultData[];
  applyFixGenerators: boolean;
};

async function evaluateRules({
  tree,
  projectGraph,
  fileMapCache,
  loadedRules,
  applyFixGenerators,
}: RunnerOptions): Promise<{
  ruleResults: ConformanceRuleResultWithRuleAndRunnerData[];
}> {
  if (!loadedRules.length) return { ruleResults: [] };
  const owners = new Map<string, string>();
  for (const [project, files] of Object.entries(
    fileMapCache.fileMap.projectFileMap,
  )) {
    for (const { file } of files)
      if (file && !owners.has(file)) owners.set(file, project);
  }
  const selections = new Map<string, Set<string>>();
  const evaluated = await Promise.all(
    loadedRules.map(async (loaded) => {
      const { ruleSpecifier, ruleModule, ruleOptions, projects } = loaded;
      const { implementation, fixGenerator, ...ruleData } = ruleModule;
      const status = loaded.status ?? "enforced";
      const scheduledStatus = loaded.scheduledStatus ?? null;
      const scheduledStatusDate = loaded.scheduledStatusDate ?? null;
      const resolvedStatus =
        scheduledStatusDate &&
        scheduledStatus &&
        new Date(scheduledStatusDate).getTime() <= Date.now()
          ? scheduledStatus
          : status;
      const runnerData: ConformanceRuleResultWithRuleAndRunnerData["runnerData"] =
        {
          status,
          scheduledStatus,
          scheduledStatusDate,
          fixGeneratorStatus:
            typeof fixGenerator === "function"
              ? "not-applied"
              : "no-fix-generator",
          countOfOriginalViolations: 0,
          countOfViolationsFixedByGenerator: 0,
          countOfViolationsFilteredByProjects: 0,
          executionTimeMs: 0,
        };
      // Disabled rules have no severity because their implementation did not run.
      let result: ConformanceRuleResult = {
        severity: null as unknown as ConformanceRuleResult["severity"],
        details: { violations: [] },
      };
      if (resolvedStatus !== "disabled") {
        const start = performance.now();
        result = await implementation({
          tree: convertToReadOnly(tree),
          projectGraph,
          fileMapCache,
          ruleOptions,
        });
        runnerData.executionTimeMs = Math.round(performance.now() - start);
        const matchers = (projects ?? []).map((item) =>
          typeof item === "string" ? item : item.matcher,
        );
        let selected: Set<string> | null | undefined = null;
        if (matchers.length) {
          const key = JSON.stringify(matchers);
          if (!selections.has(key))
            selections.set(
              key,
              new Set(
                findMatchingProjects(matchers, projectGraph.nodes),
              ),
            );
          selected = selections.get(key);
        }
        result.details.violations = (result.details.violations ?? []).filter(
          (violation, index) => {
            if (
              !violation.sourceProject &&
              !violation.file &&
              !violation.workspaceViolation
            ) {
              const error = new Error(
                "Invalid violation at index " +
                  index +
                  ' in rule "' +
                  ruleData.name +
                  "\": Violations with neither 'sourceProject' nor 'file' must have 'workspaceViolation: true'. Violation message: \"" +
                  violation.message +
                  '"',
              );
              Object.assign(error, { isValidationError: true });
              throw error;
            }
            if (
              !violation.sourceProject &&
              violation.file &&
              owners.has(violation.file)
            )
              violation.sourceProject = owners.get(violation.file);
            return (
              !selected ||
              !violation.sourceProject ||
              selected.has(violation.sourceProject)
            );
          },
        );
        if (selected && result.details.checks) {
          result.details.checks = result.details.checks.map((check) => ({
            ...check,
            units: check.units.filter(
              (unit) => unit.project === "" || selected.has(unit.project),
            ),
          }));
        }
        // The pre-fix count includes only violations in the selected scope.
        runnerData.countOfOriginalViolations = result.details.violations.length;
      }
      return {
        result: {
          ...result,
          ruleSpecifier,
          ruleData,
          resolvedStatus,
          runnerData,
        },
        fixGenerator,
        ruleOptions,
      };
    }),
  );
  if (applyFixGenerators) {
    const writableTree = convertToWritable(tree);
    for (const { result, fixGenerator, ruleOptions } of evaluated) {
      if (
        result.resolvedStatus === "disabled" ||
        typeof fixGenerator !== "function"
      )
        continue;
      const schema: Parameters<ConformanceRuleFixGenerator<unknown>>[1] = {
        violations: result.details.violations,
        ruleOptions: ruleOptions ?? {},
      };
      if (result.details.fixGeneratorData)
        schema.fixGeneratorData = result.details.fixGeneratorData;
      await fixGenerator(writableTree, schema);
      result.runnerData.fixGeneratorStatus = "applied";
    }
  }
  for (const { result } of evaluated) {
    delete result.details.fixGeneratorData;
    for (const violation of result.details.violations)
      delete violation.fixGeneratorData;
  }
  return { ruleResults: evaluated.map(({ result }) => result) };
}
async function conformanceRulesRunner(
  options: RunnerOptions,
): Promise<{ ruleResults: ConformanceRuleResultWithRuleAndRunnerData[] }> {
  try {
    return await evaluateRules(options);
  } catch (error) {
    if ((error as { isValidationError?: boolean }).isValidationError)
      throw error;
    console.error(error);
    process.exit(1);
  }
}
export { conformanceRulesRunner };
