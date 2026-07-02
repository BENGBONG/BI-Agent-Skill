#!/usr/bin/env node
import { runQualityGate } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();

try {
  const result = runQualityGate({
    providerId: args.id || args.provider || args["provider-id"],
    metricPlanFile: args["metric-plan-file"],
    metricPlanText: args["metric-plan-text"],
    queryPlanFile: args["query-plan-file"],
    queryPlanText: args["query-plan-text"]
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: result.passed, ...result }, null, 2));
  process.exit(result.passed ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
