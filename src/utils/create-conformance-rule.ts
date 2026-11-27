import type { ConformanceRule } from "../types";

export function createConformanceRule<Options = undefined>(
  rule: ConformanceRule<Options>,
): ConformanceRule<Options> {
  return rule;
}
