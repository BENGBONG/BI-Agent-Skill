#!/usr/bin/env node
import { setCurrentDashboard } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.session;
if (!sessionId) {
  console.error("Missing --session-id <id>");
  process.exit(1);
}

try {
  const result = setCurrentDashboard(sessionId, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
