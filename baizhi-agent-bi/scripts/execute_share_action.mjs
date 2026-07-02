#!/usr/bin/env node
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";
import { createAndExecuteShareAction, runShareAction } from "./lib/operations.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();

try {
  const result = args.shareId || args["share-id"]
    ? await runShareAction({ shareId: args.shareId || args["share-id"] }, workspacePath)
    : await createAndExecuteShareAction({
        shareType: args.type || args.shareType || "dataset",
        sessionId: args.sessionId || args["session-id"],
        metricId: args.metricId || args["metric-id"],
        targetId: args.targetId || args["target-id"],
        dataScope: args.dataScope || args["data-scope"] || "aggregate",
        sensitiveFieldsConfirmed: args.sensitiveFieldsConfirmed || args["sensitive-fields-confirmed"],
        rawDetailConfirmed: args.rawDetailConfirmed || args["raw-detail-confirmed"],
        confirmedBy: args.confirmedBy || args["confirmed-by"] || "cli"
      }, workspacePath);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
