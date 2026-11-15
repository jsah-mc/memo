import React from "react";
import { render } from "ink";
import App from "./App";
import { SLASH_COMMANDS } from "./completions";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const width = Math.max(
    ...SLASH_COMMANDS.map((command) => command.name.length + (command.args?.length ?? 0)),
  );
  console.log("memo — terminal client for the memo gateway\n");
  console.log("usage: memo [--help] [--gateway | --tui]");
  console.log("\ncommands:");
  for (const command of SLASH_COMMANDS) {
    const name = command.args ? `${command.name} ${command.args}` : command.name;
    console.log(`  ${name.padEnd(width + 2)}${command.description}`);
  }
  console.log(
    "\nkeys: tab switches between chat and the bot sidebar · " +
      "type / for commands or @ for files · enter sends",
  );
  process.exit(0);
}

render(<App />);
