import type { Argv, CommandModule } from "yargs";
function builder(yargs: Argv) {
  return yargs
    .option("verbose", {
      type: "boolean",
      description: "Include error details",
    })
    .option("printConfig", {
      type: "boolean",
      description: "Print the resolved rule configuration",
    })
    .middleware((args) => {
      args.verbose ??= process.env.NX_VERBOSE_LOGGING === "true";
      process.env.NX_VERBOSE_LOGGING = String(args.verbose);
    });
}
function command(name: string, fix: boolean): CommandModule {
  return {
    command: name,
    describe: fix
      ? "Evaluate rules and apply their fix generators"
      : "Evaluate rules without changing files",
    builder,
    handler: async (args) => {
      const code = await require("./lint").conformanceHandler(args, fix);
      process.exit(code ?? 0);
    },
  };
}
export const yargsConformanceCommand = command("conformance", true);
export const yargsConformanceCheckCommand = command("conformance:check", false);
