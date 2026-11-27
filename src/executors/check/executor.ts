import type { ConformanceArgs } from "../../commands/nx-lint/lint";
async function executor(options: ConformanceArgs & { fix?: boolean }) {
  const code = await require("../../commands/nx-lint/lint").conformanceHandler(
    { verbose: options.verbose, printConfig: options.printConfig },
    options.fix ?? false,
  );
  return { success: code === 0 };
}
export default executor;
