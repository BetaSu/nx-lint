import * as path from "node:path";
import * as fs from "node:fs";
import * as devkit from "@nx/devkit";
import Ajv from "ajv";
import type { ConformanceRule, RuleProjectsConfig, RuleStatus } from "./types";

export type SuccessfulResolveRuleResultData = {
  ruleSpecifier: string;
  ruleModule: ConformanceRule<unknown>;
  ruleOptions?: Record<string, unknown>;
  projects?: RuleProjectsConfig;
  status?: RuleStatus;
  scheduledStatus?: RuleStatus | null;
  scheduledStatusDate?: number | null;
};
type ResolveOptions = {
  rule: string;
  options?: Record<string, unknown>;
  projects?: RuleProjectsConfig;
  status?: RuleStatus;
  scheduledStatus?: RuleStatus;
  scheduledStatusDate?: number;
};
type ResolveResult =
  | { error: Error; data: null }
  | { error: null; data: SuccessfulResolveRuleResultData };

async function resolveRule({
  rule,
  options,
  projects,
  status,
  scheduledStatus,
  scheduledStatusDate,
}: ResolveOptions): Promise<ResolveResult> {
  let unregister: (() => void) | undefined;
  try {
    const { getRootTsConfigPath } =
      require("@nx/js") as typeof import("@nx/js");
    let registerTsProject;
    try {
      ({ registerTsProject } = require("@nx/js/internal"));
    } catch {
      ({ registerTsProject } = require("@nx/js/src/internal"));
    }
    const config = getRootTsConfigPath();
    if (config) unregister = registerTsProject(config);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      error: new Error(
        'Failed to set up the TypeScript project for conformance rule "' +
          rule +
          '": ' +
          message +
          "\nInstall the missing dependency, then re-run the command.",
        { cause },
      ),
      data: null,
    };
  }
  try {
    const filename = require.resolve(rule, { paths: [devkit.workspaceRoot] });
    let ruleModule = require(filename);
    if (ruleModule.default) ruleModule = ruleModule.default;
    if (ruleModule.default) ruleModule = ruleModule.default;
    const schemaPath = path.join(path.dirname(filename), "schema.json");
    if (!fs.existsSync(schemaPath))
      return {
        error: new Error(
          'No schema.json file found alongside rule "' +
            rule +
            '", it is therefore invalid.',
        ),
        data: null,
      };
    try {
      const ajv = new Ajv();
      const validate = ajv.compile(devkit.readJsonFile(schemaPath));
      if (!validate(options ?? {}))
        return {
          error: new Error(
            'The options given to rule "' +
              rule +
              '" could not be validated against its schema.\n- Given options: ' +
              JSON.stringify(options) +
              "\n- Validation Error(s): " +
              ajv.errorsText(validate.errors) +
              "\n- Schema file path: " +
              path.relative(devkit.workspaceRoot, schemaPath) +
              "\n",
          ),
          data: null,
        };
    } catch {
      return {
        error: new Error(
          'Failed to read schema.json file for rule "' + rule + '"',
        ),
        data: null,
      };
    }
    return {
      error: null,
      data: {
        ruleSpecifier: rule,
        ruleModule,
        ruleOptions: options,
        projects,
        status,
        scheduledStatus,
        scheduledStatusDate,
      },
    };
  } catch (cause) {
    return {
      error: new Error(
        'Failed to resolve rule specifier: "' +
          rule +
          '". Make sure the specifier is correct and the path/package is installed and available.',
        { cause },
      ),
      data: null,
    };
  } finally {
    if (typeof unregister === "function") unregister();
  }
}
export { resolveRule };
