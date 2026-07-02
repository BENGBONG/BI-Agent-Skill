#!/usr/bin/env node
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const port = String(args.port || process.env.PORT || 3000);
const host = args.host || process.env.HOST || "127.0.0.1";
const workspacePath = resolveWorkspacePath();
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(skillDir, "assets", "dashboard", "server.mjs");
const ensurePath = path.join(skillDir, "scripts", "ensure_workspace.mjs");
const ensureAppPath = path.join(skillDir, "scripts", "ensure_app.mjs");

const ensure = spawnSync(process.execPath, [ensurePath], {
  stdio: "inherit",
  env: {
    ...process.env,
    AGENT_BI_WORKSPACE: workspacePath,
    BAIZHI_BI_WORKSPACE: workspacePath
  }
});

if (ensure.status !== 0) {
  process.exit(ensure.status || 1);
}

const ensureApp = spawnSync(process.execPath, [ensureAppPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    AGENT_BI_WORKSPACE: workspacePath,
    BAIZHI_BI_WORKSPACE: workspacePath
  }
});

if (ensureApp.status !== 0) {
  process.exit(ensureApp.status || 1);
}

const child = spawn(process.execPath, [serverPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    AGENT_BI_WORKSPACE: workspacePath,
    BAIZHI_BI_WORKSPACE: workspacePath,
    PORT: port,
    HOST: host
  }
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
