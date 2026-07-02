#!/usr/bin/env node
import { cloneSession } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sourceSessionId = args.source || args["source-session"] || args["session-id"] || args.session;
if (!sourceSessionId) {
  console.error("缺少 --source <session-id>");
  process.exit(1);
}

try {
  const result = cloneSession({
    sourceSessionId,
    targetSessionId: args.target || args["target-session"],
    question: args.question,
    reason: args.reason
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
