#!/usr/bin/env node
import { runBenchmark } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();

try {
  const result = runBenchmark({
    casesPath: args["cases-path"]
  }, resolveWorkspacePath());
  const ok = result.passed === result.total && result.targetsPassed;
  console.log(JSON.stringify({ ok, ...result }, null, 2));
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
