#!/usr/bin/env node
import { compareSessions } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const left = args.left || args["left-session"] || args.a;
const right = args.right || args["right-session"] || args.b;
if (!left || !right) {
  console.error("缺少 --left <session-id> 和 --right <session-id>");
  process.exit(1);
}

try {
  const result = compareSessions({ left, right }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, comparePath: result.comparePath, diff: result.diff }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
