import { createConformanceRule, ReadOnlyConformanceTree, type ConformanceRuleContext, type ConformanceReporter } from '@beta_su/nx-lint';
import { resolveRule, type SuccessfulResolveRuleResultData } from '@beta_su/nx-lint/resolve-rule';
import { conformanceRulesRunner } from '@beta_su/nx-lint/rules-runner';
import { conformanceHandler } from '@beta_su/nx-lint/conformance-handler';
import { createReadOnlyTree, createStubbedProjectGraphAndFileMapCache, applyProjectNodesAndFiles, convertToWritable } from '@beta_su/nx-lint/testing';
import { createRuleGenerator } from '@beta_su/nx-lint/src/generators/create-rule/create-rule';
import bundle from '@beta_su/nx-lint/src/executors/bundle-rules/executor';
import type { BundleRulesExecutorSchema } from '@beta_su/nx-lint/src/executors/bundle-rules/schema.json';
import type { ConformanceCheckResult, ConformanceCheckUnit } from '@beta_su/nx-lint/conformance';
import boundaries from '@beta_su/nx-lint/enforce-project-boundaries';
import owners from '@beta_su/nx-lint/ensure-owners';
const rule = createConformanceRule<{ required: string }>({
  name: 'typed', category: 'security', description: 'Typed rule contract',
  implementation: async ({ tree, ruleOptions }) => ({ severity: 'high', details: { violations: tree.exists(ruleOptions.required) ? [] : [{ workspaceViolation: true, message: 'missing' }] } }),
  fixGenerator: async (tree, schema) => { tree.write(schema.ruleOptions.required, 'fixed'); },
});
const reporter: ConformanceReporter = async ({ ruleResults }) => {
  const check: ConformanceCheckResult | undefined = ruleResults[0]?.details.checks?.[0];
  const unit: ConformanceCheckUnit | undefined = check?.units[0];
  unit?.value.toFixed();
};
const runWithReporter = () => conformanceHandler({ reporters: [reporter] }, false);
void [rule, runWithReporter, resolveRule, conformanceRulesRunner, createReadOnlyTree, createStubbedProjectGraphAndFileMapCache, applyProjectNodesAndFiles, convertToWritable, createRuleGenerator, bundle, boundaries, owners];
