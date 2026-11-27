#!/usr/bin/env node
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import {
  yargsConformanceCommand,
  yargsConformanceCheckCommand,
} from "../src/commands/nx-lint/command-object";

yargs(hideBin(process.argv))
  .scriptName("nx-lint")
  .command(yargsConformanceCommand)
  .command(yargsConformanceCheckCommand)
  .demandCommand(1)
  .strict()
  .help()
  .parse();
