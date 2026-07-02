#!/usr/bin/env node
import { createQueryProviderHandoff } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const sessionId = args["session-id"] || args.sessionId;

if (!sessionId) {
  console.error("缺少 --session-id <session_id>");
  process.exit(1);
}

try {
  const result = createQueryProviderHandoff({
    sessionId,
    providerId: args["provider-id"] || args.providerId
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
