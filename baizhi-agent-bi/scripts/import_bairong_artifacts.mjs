#!/usr/bin/env node
import { importBairongArtifacts } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.session;
if (!sessionId) {
  console.error("缺少 --session-id <session-id>");
  process.exit(1);
}

try {
  const result = importBairongArtifacts({
    sessionId,
    sourceDir: args["source-dir"],
    note: args.note,
    maxFiles: args["max-files"]
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
