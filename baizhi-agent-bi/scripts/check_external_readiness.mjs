#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  logSkillRun,
  nowIso,
  readJson,
  resolveWorkspacePath,
  safeReadText,
  writeJson,
  mkdirp
} from "./lib/workspace.mjs";
import { evaluateDefaultMcpReadiness } from "./lib/mcp_readiness.mjs";

const workspacePath = resolveWorkspacePath();
const checkedAt = nowIso();

function check(id, label, ok, evidence = {}, remediation = "") {
  return { id, label, ok, evidence, remediation };
}

function findBairongSkill() {
  const explicit = process.env.BAIRONG_DATA_QUERY_SKILL_PATH;
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
  }
  candidates.push(path.join(os.homedir(), ".codex", "skills", "bairong-data-query", "SKILL.md"));
  candidates.push(path.join(os.homedir(), ".codex", "skills", "natural-language-data-query", "SKILL.md"));

  const marketplaceRoot = path.join(os.homedir(), ".codex", "plugins", "cache", "local-marketplace", "bairong-data-query");
  if (fs.existsSync(marketplaceRoot)) {
    const stack = [marketplaceRoot];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name === "SKILL.md" && full.includes(`${path.sep}natural-language-data-query${path.sep}`)) {
          candidates.push(full);
        }
      }
    }
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found || null;
}

function findSibling(filePath, relativeParts) {
  if (!filePath) {
    return null;
  }
  let cursor = path.dirname(filePath);
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.join(cursor, ...relativeParts);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    cursor = path.dirname(cursor);
  }
  return null;
}

const registryPath = path.join(workspacePath, "config", "query-providers.yaml");
const registry = safeReadText(registryPath);
const bairongSkill = findBairongSkill();
const productionDatabases = findSibling(bairongSkill, ["config", "production-databases.yaml"]);
const dataDomains = findSibling(bairongSkill, ["config", "data-domains.yaml"]);
const dmsFallback = findSibling(bairongSkill, ["scripts", "dms_execute_script.mjs"]);
const mcpServers = readJson(path.join(workspacePath, "config", "mcp-servers.json"), { servers: [] });
const mcpServersText = JSON.stringify(mcpServers);
const localMcpReadiness = evaluateDefaultMcpReadiness({ workspacePath });
const internalDataMcp = localMcpReadiness.requirements.find((item) => item.id === "internal_data_query");
const onlineLogsMcp = localMcpReadiness.requirements.find((item) => item.id === "online_logs");

const checks = [
  check(
    "provider.registry_internal_data",
    "BI 工作区已登记 internal_data_query provider",
    /id:\s*internal_data_query/.test(registry) && /mcp_server_hint:\s*aliyun-dms-mcp-server/.test(registry),
    { registryPath },
    "运行 scripts/ensure_workspace.mjs 重新生成默认 provider registry。"
  ),
  check(
    "provider.compat_skill_available",
    "兼容 DMS 查询执行脚本可在本机发现",
    Boolean(bairongSkill),
    { skillPath: bairongSkill },
    "安装或启用一个兼容 executeScript 的 DMS 查询执行器。"
  ),
  check(
    "skill.production_database_registry",
    "生产库 registry 可发现",
    Boolean(productionDatabases),
    { productionDatabases },
    "确认已配置生产库 registry。"
  ),
  check(
    "skill.domain_registry",
    "业务域 registry 可发现",
    Boolean(dataDomains),
    { dataDomains },
    "确认已配置业务域 registry。"
  ),
  check(
    "dms.server_hint",
    "工作区记录 aliyun-dms-mcp-server 提示",
    /aliyun-dms-mcp-server|executeScript|database_id|dms/i.test(mcpServersText) || /aliyun-dms-mcp-server/.test(registry),
    { mcpServersPath: path.join(workspacePath, "config", "mcp-servers.json") },
    "在 config/mcp-servers.json 记录 DMS MCP server 名称、executeScript tool 和只读约束；不要写入 token。"
  ),
  check(
    "local_mcp.internal_data_query",
    "本地 Codex MCP 配置可发现内部数据查询 MCP",
    Boolean(internalDataMcp?.ok),
    { requirement: internalDataMcp },
    internalDataMcp?.remediation || "安装或启用 aliyun-dms-mcp-server。"
  ),
  check(
    "local_mcp.online_logs",
    "本地 Codex MCP 配置可发现线上日志 MCP",
    Boolean(onlineLogsMcp?.ok),
    { requirement: onlineLogsMcp },
    onlineLogsMcp?.remediation || "安装或启用 alibaba_cloud_observability。"
  ),
  check(
    "dms.fallback_script",
    "Codex-only DMS fallback 脚本可发现",
    Boolean(dmsFallback),
    { dmsFallback },
    "如需 fallback，确认兼容 DMS executeScript 的本地脚本存在且仍使用同一 DMS SSE URL 与 Authorization。"
  )
];

const passed = checks.filter((item) => item.ok).length;
const readyForLiveQuery = checks.every((item) => item.ok);
const output = {
  checkedAt,
  workspacePath,
  readyForLiveQuery,
  passed,
  total: checks.length,
  checks,
  localMcpReadiness,
  note: "本脚本只做只读 readiness 检查，不执行生产 DMS 查询。真实查询仍必须由 Agent 通过已登记 DMS/MCP provider 执行。"
};

const outputDir = path.join(workspacePath, "logs", "external-readiness");
mkdirp(outputDir);
const outputPath = path.join(outputDir, `external-readiness-${checkedAt.replace(/[:.]/g, "-")}.json`);
writeJson(outputPath, output);
logSkillRun(workspacePath, "external_readiness.checked", { readyForLiveQuery, passed, total: checks.length, outputPath });

console.log(JSON.stringify({ ...output, outputPath }, null, 2));
process.exit(readyForLiveQuery ? 0 : 2);
