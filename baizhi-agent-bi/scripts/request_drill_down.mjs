#!/usr/bin/env node
import { requestDrillDown } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.session;
if (!sessionId) {
  console.error("Missing --session-id <id>");
  process.exit(1);
}

let filters = {};
if (args.filters) {
  try {
    filters = JSON.parse(args.filters);
  } catch {
    console.error("--filters must be JSON");
    process.exit(1);
  }
}

try {
  const result = requestDrillDown({
    sessionId,
    chartId: args["chart-id"],
    dimension: args.dimension,
    value: args.value,
    filters,
    reason: args.reason
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
