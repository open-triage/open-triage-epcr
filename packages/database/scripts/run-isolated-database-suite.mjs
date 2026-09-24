import { runIsolatedDatabaseSuite } from "./lib/isolated-database-suite.mjs";

function parseArguments(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error("Usage: run-isolated-database-suite.mjs --lane <lane> -- <command> [args...]");
  }
  const options = argv.slice(0, separator);
  const command = argv[separator + 1];
  const args = argv.slice(separator + 2);
  let lane;
  let reportPath;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--lane") lane = options[++index];
    else if (option === "--report") reportPath = options[++index];
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!lane) throw new Error("--lane is required");
  return { lane, reportPath, command, args };
}

const options = parseArguments(process.argv.slice(2));
await runIsolatedDatabaseSuite({
  ...options,
  reportPath: options.reportPath,
});
