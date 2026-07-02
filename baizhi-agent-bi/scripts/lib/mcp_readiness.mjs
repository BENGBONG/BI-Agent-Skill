import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  logSkillRun,
  mkdirp,
  nowIso,
  readJson,
  writeJson
} from "./workspace.mjs";

export const DEFAULT_MCP_REQUIREMENTS = [
  {
    id: "internal_data_query",
    label: "内部数据查询 DMS MCP",
    providerId: "internal_data_query",
    serverIds: ["aliyun-dms-mcp-server", "aliyun_dms"],
    requiredTools: ["executeScript"],
    purpose: "生产业务库只读 SQL / DMS 查询",
    remediation: "安装或启用 Aliyun DMS MCP，并在 Codex MCP 配置中登记 server：aliyun-dms-mcp-server，tool：executeScript。"
  },
  {
    id: "online_logs",
    label: "线上日志可观测 MCP",
    providerId: "online_logs",
    serverIds: ["alibaba_cloud_observability"],
    requiredTools: [
      "sls_list_projects",
      "sls_list_logstores",
      "sls_execute_sql",
      "sls_get_context_logs",
      "cms_execute_promql",
      "sls_execute_spl"
    ],
    purpose: "线上日志、SLS、上下文日志、PromQL 和 SPL 只读查询",
    remediation: "安装或启用 Alibaba Cloud Observability MCP，并在 Codex MCP 配置中登记 server：alibaba_cloud_observability。"
  }
];

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function sanitizeCommand(command) {
  if (!command) {
    return { commandName: "", commandExists: null };
  }
  const expanded = expandHome(command);
  const isPath = expanded.includes(path.sep);
  return {
    commandName: path.basename(expanded),
    commandExists: isPath ? fs.existsSync(expanded) : null
  };
}

function parseCodexTomlMcpServers(configPath) {
  const text = safeReadText(configPath);
  if (!text) {
    return [];
  }

  const servers = [];
  const sectionRegex = /^\[mcp_servers\.([^\].]+)\]\s*$/gm;
  const matches = [...text.matchAll(sectionRegex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const rawId = match[1].replace(/^"|"$/g, "");
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(start, end);
    const command = block.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1] || "";
    const sanitized = sanitizeCommand(command);
    servers.push({
      id: rawId,
      source: "codex_config",
      configPath,
      transport: /^\s*url\s*=/m.test(block) ? "sse_or_http" : command ? "stdio" : "unknown",
      hasUrl: /^\s*url\s*=/m.test(block),
      hasCommand: Boolean(command),
      hasHeaders: /^\s*\[mcp_servers\.[^\]]+\.http_headers\]/m.test(block),
      ...sanitized
    });
  }
  return servers;
}

function parseJsonMcpServers(configPath, source) {
  const payload = readJson(configPath, null);
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const rawServers = [];
  if (Array.isArray(payload.servers)) {
    for (const server of payload.servers) {
      rawServers.push(server);
    }
  }
  if (payload.mcpServers && typeof payload.mcpServers === "object") {
    for (const [id, server] of Object.entries(payload.mcpServers)) {
      rawServers.push({ id, ...(server || {}) });
    }
  }

  return rawServers
    .filter((server) => server && server.id)
    .map((server) => {
      const sanitized = sanitizeCommand(server.command);
      return {
        id: String(server.id),
        source,
        configPath,
        transport: server.url || server.endpoint ? "sse_or_http" : server.command ? "stdio" : "unknown",
        hasUrl: Boolean(server.url || server.endpoint),
        hasCommand: Boolean(server.command),
        hasHeaders: Boolean(server.headers || server.http_headers),
        toolHints: Array.isArray(server.requiredTools)
          ? server.requiredTools
          : Array.isArray(server.tools)
            ? server.tools
            : server.requiredTool
              ? [server.requiredTool]
              : [],
        ...sanitized
      };
    });
}

export function discoverLocalMcpServers(workspacePath) {
  const candidates = [
    {
      path: path.join(codexHome(), "config.toml"),
      parser: (filePath) => parseCodexTomlMcpServers(filePath)
    },
    {
      path: process.env.AGENT_BI_MCP_CONFIG,
      parser: (filePath) => parseJsonMcpServers(filePath, "agent_bi_mcp_config")
    },
    {
      path: path.join(os.homedir(), ".agent-bi", "mcp-servers.json"),
      parser: (filePath) => parseJsonMcpServers(filePath, "agent_bi_user_config")
    },
    {
      path: workspacePath ? path.join(workspacePath, "config", "mcp-servers.json") : "",
      parser: (filePath) => parseJsonMcpServers(filePath, "agent_bi_workspace_hint")
    }
  ];

  const servers = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const configPath = candidate.path ? path.resolve(expandHome(candidate.path)) : "";
    if (!configPath || !fs.existsSync(configPath)) {
      continue;
    }
    for (const server of candidate.parser(configPath)) {
      const key = `${server.source}:${server.id}:${server.configPath}`;
      if (!seen.has(key)) {
        seen.add(key);
        servers.push(server);
      }
    }
  }
  return servers;
}

export function evaluateDefaultMcpReadiness({ workspacePath } = {}) {
  const checkedAt = nowIso();
  const discoveredServers = discoverLocalMcpServers(workspacePath);
  const installedSources = new Set(["codex_config", "agent_bi_mcp_config", "agent_bi_user_config"]);

  const requirements = DEFAULT_MCP_REQUIREMENTS.map((requirement) => {
    const matches = discoveredServers.filter((server) => requirement.serverIds.includes(server.id));
    const installedMatches = matches.filter((server) => installedSources.has(server.source));
    const hintMatches = matches.filter((server) => server.source === "agent_bi_workspace_hint");
    const installed = installedMatches.length > 0;
    const toolHints = [...new Set(matches.flatMap((server) => server.toolHints || []))];
    const missingTools = requirement.requiredTools.filter((tool) => toolHints.length && !toolHints.includes(tool));
    const toolCheck = toolHints.length
      ? { status: missingTools.length ? "missing_hints" : "matched_hints", toolHints, missingTools }
      : { status: "not_verifiable_from_local_config", toolHints: [], missingTools: [] };

    return {
      ...requirement,
      installed,
      serverFound: matches.length > 0,
      installedServerIds: [...new Set(installedMatches.map((server) => server.id))],
      hintOnlyServerIds: [...new Set(hintMatches.map((server) => server.id))],
      evidence: matches.map((server) => ({
        id: server.id,
        source: server.source,
        configPath: server.configPath,
        transport: server.transport,
        hasUrl: server.hasUrl,
        hasCommand: server.hasCommand,
        hasHeaders: server.hasHeaders,
        commandName: server.commandName,
        commandExists: server.commandExists
      })),
      toolCheck,
      ok: installed,
      warning: installed
        ? (toolCheck.status === "not_verifiable_from_local_config" ? "已发现 MCP server 配置；工具列表需在真实调用前由 Agent/MCP runtime 校验。" : "")
        : requirement.remediation
    };
  });

  const missing = requirements.filter((item) => !item.ok);
  return {
    checkedAt,
    workspacePath,
    readyForDefaultMcpCapabilities: missing.length === 0,
    missingRequiredServers: missing.map((item) => ({
      id: item.id,
      label: item.label,
      serverIds: item.serverIds,
      remediation: item.remediation
    })),
    requirements,
    discoveredServers,
    note: "本检查只读取本地 MCP 配置中的 server 名、transport 和非敏感命令元数据；不读取、不保存 URL 内容、Authorization、token、AccessKey 或密码。"
  };
}

export function writeMcpReadinessReport(workspacePath) {
  const report = evaluateDefaultMcpReadiness({ workspacePath });
  const outputDir = path.join(workspacePath, "logs", "mcp-readiness");
  mkdirp(outputDir);
  const outputPath = path.join(outputDir, `mcp-readiness-${report.checkedAt.replace(/[:.]/g, "-")}.json`);
  const latestPath = path.join(outputDir, "latest.json");
  writeJson(outputPath, report);
  writeJson(latestPath, report);
  logSkillRun(workspacePath, "mcp_readiness.checked", {
    readyForDefaultMcpCapabilities: report.readyForDefaultMcpCapabilities,
    missing: report.missingRequiredServers.map((item) => item.id),
    outputPath
  });
  return { ...report, outputPath, latestPath };
}

export function summarizeMcpReadiness(report) {
  const missing = report.missingRequiredServers || [];
  return {
    readyForDefaultMcpCapabilities: report.readyForDefaultMcpCapabilities,
    missingRequiredServers: missing,
    message: report.readyForDefaultMcpCapabilities
      ? "已发现 Agent BI 默认查询 MCP server 配置。真实执行前仍需确认 MCP runtime 可用且账号有权限。"
      : `缺少 ${missing.length} 个默认查询 MCP server 配置：${missing.map((item) => item.serverIds[0]).join(", ")}。请先安装/启用后再执行生产查询。`
  };
}
