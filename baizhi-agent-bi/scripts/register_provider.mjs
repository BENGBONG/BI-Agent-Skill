#!/usr/bin/env node
import fs from "node:fs";
import { registerProvider } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const id = args.id;
if (!id) {
  console.error("Missing --id <provider_id>");
  process.exit(1);
}

function readSchema(filePath) {
  if (!filePath) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

try {
  const result = registerProvider({
    id,
    type: args.type || "mcp_tool",
    displayName: args.name || id,
    status: args.status || "draft",
    mcpServerHint: args["mcp-server"] || args["mcp-server-hint"],
    toolName: args.tool || args["tool-name"],
    description: args.description,
    routingKeywords: args.keywords ? args.keywords.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    inputSchema: readSchema(args["input-schema"]),
    outputSchema: readSchema(args["output-schema"]),
    safety_policy: {
      read_only: args["read-only"] !== "false",
      allow_detail_dump: args["allow-detail-dump"] === "true",
      max_preview_rows: args["max-preview-rows"] || "unlimited"
    }
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
