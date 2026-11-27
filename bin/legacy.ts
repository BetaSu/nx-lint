import { NX_VERSION } from "@nx/devkit";
import yargs from "yargs/yargs";
import {
  yargsConformanceCommand,
  yargsConformanceCheckCommand,
} from "../src/commands/nx-lint/command-object";
const { gte } = require("semver") as {
  gte: (version: string, comparison: string) => boolean;
};

export function runLegacy(fix: boolean): void {
  const command = fix ? "conformance" : "conformance:check";
  if (gte(NX_VERSION, "19.8.0")) {
    console.error(
      'Error: This command is only intended to be used as a fallback for legacy Nx 18 and 19 versions, but you have Nx version "' +
        NX_VERSION +
        '" installed.\nPlease run `nx ' +
        command +
        "` directly instead.",
    );
    process.exit(1);
  }
  const parser = yargs(process.argv.slice(2));
  parser
    .wrap(parser.terminalWidth())
    .parserConfiguration({ "strip-dashed": true })
    .command({
      ...(fix ? yargsConformanceCommand : yargsConformanceCheckCommand),
      command: "$0",
    })
    .scriptName("nx " + command)
    .parse();
}
