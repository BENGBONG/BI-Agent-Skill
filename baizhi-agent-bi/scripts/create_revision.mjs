#!/usr/bin/env node
import fs from "node:fs";
import { createRevision } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.session;
if (!sessionId) {
  console.error("Missing --session-id <id>");
  process.exit(1);
}

const metricPlan = args["metric-plan-file"] ? fs.readFileSync(args["metric-plan-file"], "utf8") : null;
const queryPlan = args["query-plan-file"] ? fs.readFileSync(args["query-plan-file"], "utf8") : null;

try {
  const result = createRevision({
    sessionId,
    revisionId: args["revision-id"],
    reason: args.reason,
    metricPlan,
    queryPlan,
    queryPlanType: args["query-plan-type"] || "sql",
    auditNote: args["audit-note"]
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
