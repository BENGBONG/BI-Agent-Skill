#!/usr/bin/env node
import { importProviderArtifacts } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.session;
if (!sessionId) {
  console.error("缺少 --session-id <session-id>");
  process.exit(1);
}

try {
  const result = importProviderArtifacts({
    sessionId,
    aggregatePath: args["aggregate-path"],
    previewPath: args["preview-path"],
    chartSpecPath: args["chart-spec-path"],
    queryPlanPath: args["query-plan-path"],
    queryPlanType: args["query-plan-type"],
    auditPath: args["audit-path"],
    fullResultPath: args["full-result-path"],
    allowFullResult: Boolean(args["allow-full-result"])
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
