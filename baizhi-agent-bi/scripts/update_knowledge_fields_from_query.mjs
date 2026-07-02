#!/usr/bin/env node
import { updateKnowledgeFieldsFromQuery } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.sessionId || args.session;

if (!sessionId) {
  console.error("缺少 --session-id <session_id>");
  process.exit(1);
}

try {
  const result = updateKnowledgeFieldsFromQuery({
    sessionId,
    confirmUpdateKnowledge: Boolean(args["confirm-update-knowledge"] || args.confirmUpdateKnowledge),
    confirmedBy: args["confirmed-by"] || args.confirmedBy,
    updatesJson: args["updates-json"] || args.updatesJson,
    field: args.field,
    meaning: args.meaning,
    detail: args.detail,
    role: args.role,
    sourceTables: args["source-tables"] || args.sourceTables,
    calculationUsage: args["calculation-usage"] || args.calculationUsage,
    evidence: args.evidence,
    confidence: args.confidence
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
