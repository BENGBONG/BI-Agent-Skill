#!/usr/bin/env node
import { getMetricHistory } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const id = args.id || args.metric;
if (!id) {
  console.error("缺少 --id <指标 id>");
  process.exit(1);
}

try {
  const result = getMetricHistory(id, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
