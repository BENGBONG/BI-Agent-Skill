#!/usr/bin/env node
import { selectQueryProvider } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const args = parseArgs();

try {
  const result = selectQueryProvider({
    providerId: args.id || args.provider || args["provider-id"],
    question: args.question || "",
    metrics: splitList(args.metrics),
    keywords: splitList(args.keywords)
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  process.exit(result.status === "disabled" ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
