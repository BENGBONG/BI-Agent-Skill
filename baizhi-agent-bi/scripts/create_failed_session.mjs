#!/usr/bin/env node
import { createFailedSession } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();

try {
  const result = createFailedSession({
    sessionId: args["session-id"],
    question: args.question,
    providerId: args.provider || args["provider-id"],
    toolName: args.tool || args["tool-name"],
    error: args.error,
    input: args.input ? JSON.parse(args.input) : {}
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
