#!/usr/bin/env node
import { scanBackendProject } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const repoPath = args.repo || args["repo-path"];
if (!repoPath) {
  console.error("缺少 --repo <后端 repo 路径>");
  process.exit(1);
}

try {
  const result = scanBackendProject({
    repoPath,
    domain: args.domain,
    keywords: args.keywords,
    maxFiles: args["max-files"],
    maxMatches: args["max-matches"]
  }, resolveWorkspacePath());
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
