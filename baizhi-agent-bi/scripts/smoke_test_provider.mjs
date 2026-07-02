#!/usr/bin/env node
import { smokeTestProvider } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const providerId = args.id || args.provider || args["provider-id"];
if (!providerId) {
  console.error("缺少 --id <provider id>");
  process.exit(1);
}

try {
  const result = smokeTestProvider({ providerId }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
