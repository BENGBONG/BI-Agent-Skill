#!/usr/bin/env node
import { resolveWorkspacePath } from "./lib/workspace.mjs";
import { summarizeMcpReadiness, writeMcpReadinessReport } from "./lib/mcp_readiness.mjs";

const workspacePath = resolveWorkspacePath();
const report = writeMcpReadinessReport(workspacePath);
console.log(JSON.stringify({
  ...report,
  summary: summarizeMcpReadiness(report)
}, null, 2));
process.exit(report.readyForDefaultMcpCapabilities ? 0 : 2);
