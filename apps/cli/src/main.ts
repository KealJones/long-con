#!/usr/bin/env -S node --experimental-strip-types
// Long Con command line. Phase 1 runs the evals from here; chat comes once the core exists.

const usage = `Usage: long-con <command>

Commands:
  help    Show this message
  eval    Replay chats through the eval arms (not built yet, see evals/README.md)`;

const command = process.argv[2] ?? "help";

switch (command) {
  case "help":
    console.log(usage);
    break;
  case "eval":
    console.error("The eval harness is phase 1 and isn't built yet. See evals/README.md.");
    process.exitCode = 1;
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${usage}`);
    process.exitCode = 1;
}
