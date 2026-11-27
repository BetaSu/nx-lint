import { createRequire } from "node:module";
import { join } from "node:path";

const compatibilityMajor = "5";
const powerpackPackages = new Set([
  "@nx/conformance",
  "@nx/powerpack-conformance",
  "@nx/owners",
  "@nx/powerpack-owners",
]);

export function dependencyVersion(name: string, workspaceRoot: string): string {
  const fromWorkspace = createRequire(join(workspaceRoot, "package.json"));
  if (name === "@beta_su/nx-lint")
    return (
      "^" +
      (
        require("@beta_su/nx-lint/package.json") as { version: string }
      ).version.split(".")[0]
    );
  if (powerpackPackages.has(name)) {
    try {
      return (
        "^" +
        (
          fromWorkspace(name + "/package.json") as { version: string }
        ).version.split(".")[0]
      );
    } catch {
      return "^" + compatibilityMajor;
    }
  }
  return (
    "^" +
    (require("nx/package.json") as { version: string }).version.split(".")[0]
  );
}
