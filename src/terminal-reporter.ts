import type { ConformanceReporter } from "./types";
const terminalReporter: ConformanceReporter = ({ ruleResults }) => {
  for (const result of ruleResults) {
    const { ruleData, resolvedStatus, details, severity } = result;
    console.log(
      ruleData.name +
        " | " +
        ruleData.category +
        " | " +
        (severity ?? "none") +
        " | " +
        resolvedStatus,
    );
    const data = result.runnerData;
    if (data.scheduledStatus && data.scheduledStatusDate)
      console.log(
        "  Scheduled: " +
          data.scheduledStatus +
          " at " +
          new Date(data.scheduledStatusDate).toISOString(),
      );
    if (data.fixGeneratorStatus === "applied")
      console.log(
        "  Fix generator applied; fixed " +
          data.countOfViolationsFixedByGenerator +
          " violation(s)",
      );
    const groups = new Map<string | undefined, Map<string, string[]>>();
    for (const violation of details.violations ?? []) {
      const owner = violation.workspaceViolation
        ? "Workspace"
        : (violation.sourceProject ?? violation.file);
      if (!groups.has(owner)) groups.set(owner, new Map());
      const messages = groups.get(owner)!;
      if (!messages.has(violation.message)) messages.set(violation.message, []);
      if (violation.file) messages.get(violation.message)!.push(violation.file);
    }
    if (!groups.size) console.log("  No violations");
    for (const [owner, messages] of groups) {
      console.log("  " + owner);
      for (const [message, files] of messages) {
        console.log("    " + message);
        for (const file of files) console.log("      " + file);
      }
    }
  }
};
export { terminalReporter };
