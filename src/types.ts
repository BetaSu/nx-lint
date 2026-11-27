import type { Generator, ProjectGraph } from "@nx/devkit";
import type { FileMapCache } from "nx/src/project-graph/nx-deps-cache";
import type {
  ReadOnlyConformanceTree,
  WritableConformanceTree,
} from "./conformance-tree";

export type RuleStatus = "enforced" | "evaluated" | "disabled";
export type RuleProjectsConfig = Array<
  string | { matcher: string; explanation: string }
>;
export type FixGeneratorData = Record<string, unknown>;
export type ConformanceViolation = {
  message: string;
  file?: string;
  sourceProject?: string;
  workspaceViolation?: boolean;
  fixGeneratorData?: FixGeneratorData;
};
export type ConformanceRuleCategory =
  "consistency" | "maintainability" | "reliability" | "security";
export type ConformanceRuleResultSeverity = "high" | "medium" | "low";
export interface ConformanceCheckUnit {
  /** An empty string represents the whole workspace. */
  project: string;
  /** The violation count for a lint check or the measured value for a metric. */
  value: number;
  files?: string[];
}
export interface ConformanceCheckResult {
  /** The individual rule name. */
  rule: string;
  durationMs: number;
  units: ConformanceCheckUnit[];
}
export type ConformanceRuleResult = {
  severity: ConformanceRuleResultSeverity;
  details: {
    violations: ConformanceViolation[];
    fixGeneratorData?: FixGeneratorData;
    checks?: ConformanceCheckResult[];
  };
};
export interface ConformanceRuleContext<RuleOptions = undefined> {
  tree: ReadOnlyConformanceTree;
  projectGraph: ProjectGraph;
  fileMapCache: FileMapCache;
  ruleOptions: RuleOptions;
}
export type ConformanceRuleFixGenerator<RuleOptions> = (
  tree: WritableConformanceTree,
  schema: {
    violations: ConformanceViolation[];
    ruleOptions: RuleOptions;
    fixGeneratorData?: FixGeneratorData;
  },
) => ReturnType<Generator>;
export type ConformanceRule<RuleOptions = undefined> = {
  name: string;
  category: ConformanceRuleCategory;
  description: string;
  implementation: (
    context: ConformanceRuleContext<RuleOptions>,
  ) => Promise<ConformanceRuleResult>;
  fixGenerator?: ConformanceRuleFixGenerator<RuleOptions>;
};
export interface NxJsonConformanceConfiguration {
  outputPath?: string | false;
  rules: Array<{
    rule: string;
    options?: Record<string, unknown>;
    projects?: RuleProjectsConfig;
    explanation?: string;
    status?: RuleStatus;
  }>;
}
export type ConformanceRuleResultWithRuleAndRunnerData =
  ConformanceRuleResult & {
    ruleSpecifier: string;
    ruleData: Omit<ConformanceRule<any>, "implementation" | "fixGenerator">;
    resolvedStatus: RuleStatus;
    runnerData: {
      status: RuleStatus;
      scheduledStatus: RuleStatus | null;
      scheduledStatusDate: number | null;
      fixGeneratorStatus: "no-fix-generator" | "applied" | "not-applied";
      countOfOriginalViolations: number;
      countOfViolationsFixedByGenerator: number;
      countOfViolationsFilteredByProjects: number;
      executionTimeMs: number;
    };
  };
export type ConformanceReporter = (data: {
  ruleResults: ConformanceRuleResultWithRuleAndRunnerData[];
}) => void | Promise<void>;
