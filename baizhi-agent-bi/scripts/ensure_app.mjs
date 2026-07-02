#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  logSkillRun,
  parseArgs,
  readJson,
  resolveWorkspacePath,
  writeJson
} from "./lib/workspace.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();
const appDir = path.join(workspacePath, "app");
const packagePath = path.join(appDir, "package.json");
const packageJson = readJson(packagePath, null);
const errors = [];
const actions = [];

if (!packageJson) {
  errors.push("缺少或无法读取 app/package.json，请先运行 scripts/ensure_workspace.mjs。");
}

if (!fs.existsSync(path.join(appDir, "index.mjs"))) {
  errors.push("缺少 app/index.mjs，请先运行 scripts/ensure_workspace.mjs 更新 App 入口。");
}

if (!fs.existsSync(path.join(appDir, "resources", "bi-dashboard", "widget.tsx"))) {
  errors.push("缺少 app/resources/bi-dashboard/widget.tsx。");
}

const dependencies = packageJson?.dependencies || {};
const dependencyNames = Object.keys(dependencies);
const nodeModulesPath = path.join(appDir, "node_modules");

if (dependencyNames.length > 0 && !fs.existsSync(nodeModulesPath)) {
  if (args.install) {
    const install = spawnSync("npm", ["install"], {
      cwd: appDir,
      stdio: "inherit"
    });
    actions.push({ action: "npm install", status: install.status });
    if (install.status !== 0) {
      errors.push("app 依赖安装失败。");
    }
  } else {
    errors.push("app 依赖未安装；如确认需要联网安装，请在 app 目录运行 npm install，或执行本脚本时传入 --install。");
  }
}

if (packageJson) {
  const scripts = packageJson.scripts || {};
  if (scripts.start !== "node index.mjs") {
    packageJson.scripts = { ...scripts, start: "node index.mjs", check: "node index.mjs --check" };
    writeJson(packagePath, packageJson);
    actions.push({ action: "更新 app/package.json scripts" });
  }
}

let entrypointCheck = null;
if (!errors.length) {
  const result = spawnSync(process.execPath, ["index.mjs", "--check"], {
    cwd: appDir,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BI_WORKSPACE: workspacePath,
      BAIZHI_BI_WORKSPACE: workspacePath
    }
  });
  entrypointCheck = {
    status: result.status,
    stdout: result.stdout ? result.stdout.trim() : "",
    stderr: result.stderr ? result.stderr.trim() : ""
  };
  if (result.status !== 0) {
    errors.push("app/index.mjs 自检失败。");
  }
}

const ok = errors.length === 0;
const logPath = logSkillRun(workspacePath, "app.ensured", {
  ok,
  dependencyCount: dependencyNames.length,
  actions
});

console.log(JSON.stringify({
  ok,
  workspacePath,
  appDir,
  dependencyCount: dependencyNames.length,
  dependencies: dependencyNames,
  actions,
  entrypointCheck,
  errors,
  logPath
}, null, 2));

process.exit(ok ? 0 : 1);
