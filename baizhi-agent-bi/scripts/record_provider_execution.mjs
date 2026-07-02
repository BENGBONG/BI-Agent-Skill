#!/usr/bin/env node
import { recordProviderExecution } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.sessionId;

if (!sessionId) {
  console.error("缺少 --session-id <session_id>");
  process.exit(1);
}

try {
  const result = recordProviderExecution({
    sessionId,
    providerId: args["provider-id"] || args.providerId,
    status: args.status,
    sourceStatement: args["source-statement"] || args.sourceStatement,
    databaseId: args["database-id"] || args.databaseId,
    schema: args.schema,
    toolName: args["tool-name"] || args.toolName,
    artifactDir: args["artifact-dir"] || args.artifactDir,
    error: args.error,
    note: args.note
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
