#!/usr/bin/env node
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";
import { syncTeamSharedMetrics } from "./lib/operations.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();

try {
  const result = await syncTeamSharedMetrics({
    targetId: args.targetId || args["target-id"]
  }, workspacePath);
  console.log(JSON.stringify({ ok: result.status !== "failed", result }, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
