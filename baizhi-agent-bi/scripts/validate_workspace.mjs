#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findSessionDir, readJson, resolveWorkspacePath, safeReadText } from "./lib/workspace.mjs";

const workspacePath = resolveWorkspacePath();
const required = [
  "README.md",
  ".gitignore",
  "config/workspace.json",
  "config/query-providers.yaml",
  "config/share-targets.yaml",
  "config/app.json",
  "app/package.json",
  "app/index.mjs",
  "app/index.ts",
  "app/resources/bi-dashboard/types.ts",
  "app/resources/bi-dashboard/widget.tsx",
  "knowledge/backend-projects.yaml",
  "knowledge/shared-metrics/index.json",
  "metrics/_index.yaml",
  "dashboards/current.json"
];

const errors = [];
for (const item of required) {
  const full = path.join(workspacePath, item);
  if (!fs.existsSync(full)) {
    errors.push(`缺少 ${item}`);
  }
}

const gitignore = safeReadText(path.join(workspacePath, ".gitignore"));
for (const rule of [
  ".env",
  "logs/",
  "tmp/",
  "app/node_modules/",
  "sessions/**/result.full.json",
  "sessions/**/raw/"
]) {
  if (!gitignore.includes(rule)) {
    errors.push(`.gitignore 缺少 ${rule}`);
  }
}

const appConfig = readJson(path.join(workspacePath, "config", "app.json"), {});
const host = appConfig.host || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  errors.push(`config/app.json host 不是本机地址：${host}`);
}

const appPackage = readJson(path.join(workspacePath, "app", "package.json"), {});
if (appPackage.scripts?.start !== "node index.mjs") {
  errors.push("app/package.json start 脚本必须为 node index.mjs");
}
if (fs.existsSync(path.join(workspacePath, "app", "index.mjs"))) {
  const appCheck = spawnSync(process.execPath, ["index.mjs", "--check"], {
    cwd: path.join(workspacePath, "app"),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BI_WORKSPACE: workspacePath,
      BAIZHI_BI_WORKSPACE: workspacePath
    }
  });
  if (appCheck.status !== 0) {
    errors.push(`app/index.mjs 自检失败：${appCheck.stderr || appCheck.stdout}`);
  }
}
const widgetText = safeReadText(path.join(workspacePath, "app", "resources", "bi-dashboard", "widget.tsx"));
if (!widgetText.includes("BiDashboardWidget") || widgetText.includes("return null")) {
  errors.push("app/resources/bi-dashboard/widget.tsx 必须提供非空 Widget 组件");
}

const providerRegistry = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
if (!/default_provider:\s*internal_data_query/.test(providerRegistry) || !/id:\s*internal_data_query/.test(providerRegistry)) {
  errors.push("query-providers.yaml 缺少默认 internal_data_query provider");
}
if (!/read_only:\s*true/.test(providerRegistry) || !/allow_detail_dump:\s*false/.test(providerRegistry)) {
  errors.push("query-providers.yaml 缺少只读或禁止明细 dump 的安全声明");
}

const secretPattern = /\b(token|password|passwd|secret|cookie|authorization|api[_-]?key)\b\s*[:=]\s*["']?[^"'\s{},]+/i;
for (const file of ["config/agents.json", "config/mcp-servers.json", "config/query-providers.yaml", "config/share-targets.yaml", "config/app.json"]) {
  const text = safeReadText(path.join(workspacePath, file));
  if (secretPattern.test(text)) {
    errors.push(`${file} 疑似包含明文敏感配置`);
  }
}

const shareTargets = safeReadText(path.join(workspacePath, "config", "share-targets.yaml"));
if (!/default_target:\s*\S+/.test(shareTargets) || !/type:\s*dingtalk_ai_table_mcp/.test(shareTargets)) {
  errors.push("share-targets.yaml 缺少默认共享目标或 dingtalk_ai_table_mcp 类型");
}
if (/enabled:\s*true/.test(shareTargets) && !/base_id:\s*["']?[A-Za-z0-9_-]+/.test(shareTargets) && !/base_name:\s*["']?[^"'\n]+/.test(shareTargets)) {
  errors.push("启用共享目标时必须配置 base_id 或 base_name");
}

const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
if (current.currentSessionId) {
  const dir = findSessionDir(workspacePath, current.currentSessionId);
  if (!dir) {
    errors.push(`未找到当前 session：${current.currentSessionId}`);
  } else {
    for (const file of [
      "request.md",
      "interpretation.md",
      "metric-plan.yaml",
      "result.aggregate.json",
      "result.preview.json",
      "chart-spec.json",
      "audit.md"
    ]) {
      if (!fs.existsSync(path.join(dir, file))) {
        errors.push(`当前 session 缺少 ${file}`);
      }
    }
    const hasSqlPlan = fs.existsSync(path.join(dir, "query-plan.sql"));
    const hasJsonPlan = fs.existsSync(path.join(dir, "query-plan.json"));
    if (!hasSqlPlan && !hasJsonPlan) {
      errors.push("当前 session 缺少 query-plan.sql 或 query-plan.json");
    }
  }
}

const ok = errors.length === 0;
console.log(JSON.stringify({ ok, workspacePath, errors }, null, 2));
process.exit(ok ? 0 : 1);
