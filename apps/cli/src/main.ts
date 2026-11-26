#!/usr/bin/env -S node --experimental-strip-types
// Long Con command line. Phase 1 runs the evals from here; chat comes once the core exists.

const usage = `Usage: long-con <command>

Commands:
  help    Show this message
  eval    Run the evals: recall, estimate or run (see evals/README.md)`;

const command = process.argv[2] ?? "help";

switch (command) {
  case "help":
    console.log(usage);
    break;
  case "eval": {
    const { main } = await import("@long-con/evals/cli");
    process.exitCode = await main(process.argv.slice(3));
    break;
  }
  default:
    console.error(`Unknown command: ${command}\n\n${usage}`);
    process.exitCode = 1;
}
