#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  ensureUserConfig,
  logSkillRun,
  mkdirp,
  nowIso,
  resolveWorkspacePath,
  safeReadText,
  writeIfMissing,
  writeJson,
  writeText
} from "./lib/workspace.mjs";
import { defaultShareTargetsYaml } from "./lib/share.mjs";
import { summarizeMcpReadiness, writeMcpReadinessReport } from "./lib/mcp_readiness.mjs";

const workspacePath = resolveWorkspacePath();
const createdAt = nowIso();
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardServerPath = path.join(skillDir, "assets", "dashboard", "server.mjs");
const knowledgeSeedsDir = path.join(skillDir, "assets", "knowledge-seeds");
const internalDataProviderId = "internal_data_query";
const onlineLogsProviderId = "online_logs";
const onlineLogsMcpServer = {
  id: "alibaba_cloud_observability",
  displayName: "阿里云可观测 MCP",
  purpose: "线上日志、SLS 查询、上下文日志和 PromQL 指标只读查询入口",
  requiredTools: [
    "sls_list_projects",
    "sls_list_logstores",
    "sls_execute_sql",
    "sls_get_context_logs",
    "cms_execute_promql",
    "sls_execute_spl"
  ],
  safety: {
    readOnly: true,
    statementType: "SLS 查询、SLS SPL 或 PromQL 只读查询",
    storeSecretsInWorkspace: false
  },
  note: "这里只保存执行路径提示，不保存 AccessKey、Secret、token、Authorization 或 endpoint 凭据。"
};

const onlineLogsToolSchemas = {
  sls_list_projects: {
    description: "列出指定 region 下的 SLS project，支持按 projectName 模糊搜索。",
    inputSchema: {
      type: "object",
      required: ["regionId"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        projectName: { type: "string", description: "Project 名称模糊搜索关键词。" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50, description: "最大返回数量。" }
      }
    }
  },
  sls_list_logstores: {
    description: "列出指定 SLS project 下的 logstore 或 metric store，支持按名称模糊搜索。",
    inputSchema: {
      type: "object",
      required: ["regionId", "project"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        project: { type: "string", description: "SLS project 精确名称。" },
        logStore: { type: "string", description: "Logstore 名称模糊搜索关键词。" },
        isMetricStore: { type: "boolean", default: false, description: "是否查询 metric store。" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "最大返回数量。" }
      }
    }
  },
  sls_execute_sql: {
    description: "执行 SLS 查询语句，用于日志检索、过滤和聚合统计。",
    inputSchema: {
      type: "object",
      required: ["regionId", "project", "logStore", "query"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        project: { type: "string", description: "SLS project 名称。" },
        logStore: { type: "string", description: "SLS logstore 名称。" },
        query: { type: "string", description: "SLS 查询语句，不接受自然语言。" },
        from_time: { type: "string", description: "开始时间，Unix timestamp 或 now-5m 等相对表达式。" },
        to_time: { type: "string", description: "结束时间，Unix timestamp 或 now 等相对表达式。" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10, description: "最大返回数量。" },
        offset: { type: "integer", default: 0, description: "分页起始偏移。" },
        reverse: { type: "boolean", default: false, description: "是否按时间倒序返回。" }
      }
    }
  },
  sls_get_context_logs: {
    description: "根据 sls_execute_sql 返回的 __pack_id__ 和 __pack_meta__ 查询前后文日志。",
    inputSchema: {
      type: "object",
      required: ["regionId", "project", "logStore", "pack_id", "pack_meta"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        project: { type: "string", description: "SLS project 名称。" },
        logStore: { type: "string", description: "SLS logstore 名称。" },
        pack_id: { type: "string", description: "起始日志的 __pack_id__。" },
        pack_meta: { type: "string", description: "起始日志的 __pack_meta__。" },
        back_lines: { type: "integer", minimum: 0, maximum: 100, default: 10, description: "向前查询日志行数。" },
        forward_lines: { type: "integer", minimum: 0, maximum: 100, default: 10, description: "向后查询日志行数。" }
      }
    }
  },
  cms_execute_promql: {
    description: "执行 PromQL 指标查询，用于时序指标趋势和系统/业务监控分析。",
    inputSchema: {
      type: "object",
      required: ["regionId", "project", "metricStore", "query"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        project: { type: "string", description: "SLS project 名称。" },
        metricStore: { type: "string", description: "SLS metric store 名称。" },
        query: { type: "string", description: "PromQL 查询语句，不接受自然语言。" },
        from_time: { type: "string", description: "开始时间，Unix timestamp 或 now-5m 等相对表达式。" },
        to_time: { type: "string", description: "结束时间，Unix timestamp 或 now 等相对表达式。" }
      }
    }
  },
  sls_execute_spl: {
    description: "在 CMS workspace 执行原生 SPL 查询，用于复杂日志分析、关联和聚合。",
    inputSchema: {
      type: "object",
      required: ["regionId", "workspace", "query"],
      properties: {
        regionId: { type: "string", description: "Alibaba Cloud region ID，例如 cn-beijing。" },
        workspace: { type: "string", description: "CMS workspace 名称。" },
        query: { type: "string", description: "SPL 查询语句，不接受自然语言。" },
        from_time: { type: "string", description: "开始时间，Unix timestamp 或 now-5m 等相对表达式。" },
        to_time: { type: "string", description: "结束时间，Unix timestamp 或 now 等相对表达式。" }
      }
    }
  }
};

function hasProvider(registryText, providerId) {
  return new RegExp(`^\\s*-\\s+id:\\s+${providerId}\\s*$`, "m").test(registryText);
}

function disableLegacyProvider(registryText, providerId, replacementId) {
  const pattern = new RegExp(`(\\n\\s*-\\s+id:\\s+${providerId}\\n[\\s\\S]*?)(?=\\n\\s*\\n\\s*-\\s+id:|\\n\\s*-\\s+id:|\\s*$)`);
  return registryText.replace(pattern, (block) => {
    if (/status:\s*disabled/.test(block)) {
      return block;
    }
    let next = /status:\s*\w+/.test(block)
      ? block.replace(/status:\s*\w+/, "status: disabled")
      : block.replace(/(\n\s*display_name:[^\n]*\n)/, `$1    status: disabled\n`);
    if (!/legacy_replaced_by:/.test(next)) {
      next = next.replace(/status:\s*disabled/, `status: disabled\n    legacy_replaced_by: ${replacementId}`);
    }
    return next;
  });
}

function internalDataProviderBlock() {
  return `
  - id: ${internalDataProviderId}
    type: dms_sql
    display_name: 内部数据查询
    status: enabled
    aliases:
      - bairong_data_query
    mcp_server_hint: aliyun-dms-mcp-server
    tool_name: executeScript
    description: 生产业务库只读 SQL / DMS 查询 provider。适合结构化业务表、登录日志表、用户、任务、渠道、转化等库表型统计；线上 SLS/LogStore/PromQL/SPL 应路由到 online_logs。
    routing_keywords:
      - 生产业务库
      - DMS
      - SQL
      - 业务表
      - 数据库表
      - 登录日志
      - 用户表
      - 任务表
      - 渠道转化
      - 结构化统计
    legacy_skill_entrypoint: "@bairong-data-query/natural-language-data-query"
    safety_policy:
      read_only: true
      allow_detail_dump: false
      require_confirmation: true
      require_source_statement: true
      max_preview_rows: unlimited
    output_mapping:
      aggregate_result: sessions/{session_id}/result.aggregate.json
      preview_result: sessions/{session_id}/result.preview.json
      chart_spec: sessions/{session_id}/chart-spec.json
`;
}

function onlineLogsProviderBlock() {
  return `
  - id: ${onlineLogsProviderId}
    type: mcp_tool
    display_name: 线上日志查询
    status: enabled
    aliases:
      - baizhi_online_logs
    mcp_server_hint: alibaba_cloud_observability
    tool_name: sls_execute_sql
    tool_names:
      - sls_list_projects
      - sls_list_logstores
      - sls_execute_sql
      - sls_get_context_logs
      - cms_execute_promql
      - sls_execute_spl
    description: 线上日志、SLS、上下文日志、PromQL 和 SPL 查询 MCP。Agent 必须先确认指标、数据源、计算口径和时间范围，再调用该 provider。
    input_schema_ref: knowledge/query-providers/${onlineLogsProviderId}/input-schema.json
    output_schema_ref: knowledge/query-providers/${onlineLogsProviderId}/output-schema.json
    routing_keywords:
      - 线上日志
      - 日志
      - SLS
      - LogStore
      - logstore
      - observability
      - 可观测
      - APP 活跃
      - token 活跃
      - 已登录 token
      - 行为日志
      - 错误日志
      - agent 日志
      - PromQL
      - SPL
      - agent service
      - chronos
    safety_policy:
      read_only: true
      allow_detail_dump: false
      require_confirmation: true
      require_source_statement: true
      max_preview_rows: unlimited
    output_mapping:
      rows_path: "$.data.rows"
      columns_path: "$.data.columns"
      summary_path: "$.data.summary"
      raw_text_path: "$.content[0].text"
`;
}

function seedKnowledgeFiles() {
  const seedRoot = path.join(knowledgeSeedsDir, "field-meanings");
  if (!fs.existsSync(seedRoot)) {
    return [];
  }
  const seeded = [];
  for (const fileName of fs.readdirSync(seedRoot).filter((file) => file.endsWith(".json")).sort()) {
    const sourcePath = path.join(seedRoot, fileName);
    const targetPath = path.join(workspacePath, "knowledge", "field-meanings", fileName);
    if (fs.existsSync(targetPath)) {
      continue;
    }
    writeIfMissing(targetPath, safeReadText(sourcePath));
    seeded.push(path.relative(workspacePath, targetPath));
  }
  return seeded;
}

const directories = [
  "config",
  "app/resources/bi-dashboard",
  "app/public",
  "knowledge/query-providers",
  "knowledge/field-mappings",
  "knowledge/field-meanings",
  "knowledge/code-scans",
  "knowledge/backend-repos",
  "knowledge/source-catalog",
  "knowledge/shared-metrics",
  "metrics",
  "metrics/_shares",
  "metrics/_share-actions",
  "sessions",
  "dashboards/saved",
  "provider-output",
  "bairong-data-output",
  "logs",
  "tmp"
];

mkdirp(workspacePath);
for (const dir of directories) {
  mkdirp(path.join(workspacePath, dir));
}

const seededKnowledgeFiles = seedKnowledgeFiles();

writeIfMissing(
  path.join(workspacePath, "README.md"),
  `# Agent BI 工作区

本工作区保存 Agent BI Skill 生成的本地 BI 分析资产。

默认保存：

- 指标口径
- 查询计划
- 聚合结果
- 受 provider 策略限制的 preview 数据
- 图表配置
- 审计说明

不要在这里保存密钥、token、数据库密码或未限制范围的生产明细原始数据。
`
);

writeIfMissing(
  path.join(workspacePath, ".gitignore"),
  `.env
logs/
tmp/
app/node_modules/
sessions/**/result.full.json
sessions/**/raw/
provider-output/
knowledge/backend-repos/
`
);

writeJson(path.join(workspacePath, "config", "workspace.json"), {
  version: VERSION,
  workspacePath,
  createdAt,
  lastUsedAt: createdAt
});

writeIfMissing(
  path.join(workspacePath, "config", "agents.json"),
  `${JSON.stringify({ agents: [] }, null, 2)}\n`
);

writeIfMissing(
  path.join(workspacePath, "config", "mcp-servers.json"),
  `${JSON.stringify({
    servers: [
      {
        id: "aliyun-dms-mcp-server",
        displayName: "阿里云 DMS MCP",
        purpose: "生产数据只读查询执行入口",
        requiredTool: "executeScript",
        requiredArguments: ["database_id", "script"],
        safety: {
          readOnly: true,
          statementType: "SELECT 或 WITH ... SELECT",
          storeSecretsInWorkspace: false
        },
        note: "这里只保存执行路径提示，不保存 SSE URL、Authorization、token 或密码。"
      }
    ]
  }, null, 2)}\n`
);

const mcpServersPath = path.join(workspacePath, "config", "mcp-servers.json");
try {
  const mcpServersConfig = JSON.parse(safeReadText(mcpServersPath, "{}"));
  const servers = Array.isArray(mcpServersConfig.servers) ? mcpServersConfig.servers : [];
  let mcpServersChanged = false;
  for (const server of servers) {
    if (server.purpose === "百智生产数据只读查询执行入口") {
      server.purpose = "生产数据只读查询执行入口";
      mcpServersChanged = true;
    }
    if (server.purpose === "百智线上日志、SLS 查询、上下文日志和 PromQL 指标只读查询入口") {
      server.purpose = "线上日志、SLS 查询、上下文日志和 PromQL 指标只读查询入口";
      mcpServersChanged = true;
    }
  }
  if (!servers.some((server) => server.id === "aliyun-dms-mcp-server")) {
    servers.push({
      id: "aliyun-dms-mcp-server",
      displayName: "阿里云 DMS MCP",
      purpose: "生产数据只读查询执行入口",
      requiredTool: "executeScript",
      requiredArguments: ["database_id", "script"],
      safety: {
        readOnly: true,
        statementType: "SELECT 或 WITH ... SELECT",
        storeSecretsInWorkspace: false
      },
      note: "这里只保存执行路径提示，不保存 SSE URL、Authorization、token 或密码。"
    });
    mcpServersChanged = true;
  }
  if (!servers.some((server) => server.id === onlineLogsMcpServer.id)) {
    servers.push(onlineLogsMcpServer);
    mcpServersChanged = true;
  }
  if (mcpServersChanged) {
    writeText(mcpServersPath, `${JSON.stringify({ ...mcpServersConfig, servers }, null, 2)}\n`);
  }
} catch {
  // validate_workspace will report malformed mcp-servers.json if this ever happens.
}

writeIfMissing(
  path.join(workspacePath, "config", "app.json"),
  `${JSON.stringify({ host: "127.0.0.1", defaultPort: 3000, language: "zh-CN" }, null, 2)}\n`
);

writeIfMissing(
  path.join(workspacePath, "config", "share-targets.yaml"),
  defaultShareTargetsYaml()
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "shared-metrics", "index.json"),
  `${JSON.stringify({
    version: 1,
    targetId: "team_ai_table",
    baseId: "",
    tableName: "共享指标库",
    syncedAt: "",
    status: "not_synced",
    records: [],
    error: ""
  }, null, 2)}\n`
);

writeIfMissing(
  path.join(workspacePath, "config", "query-providers.yaml"),
  `version: 1
default_provider: internal_data_query
providers:
  - id: internal_data_query
    type: dms_sql
    display_name: 内部数据查询
    status: enabled
    aliases:
      - bairong_data_query
    mcp_server_hint: aliyun-dms-mcp-server
    tool_name: executeScript
    description: 生产业务库只读 SQL / DMS 查询 provider。适合结构化业务表、登录日志表、用户、任务、渠道、转化等库表型统计；线上 SLS/LogStore/PromQL/SPL 应路由到 online_logs。
    routing_keywords:
      - 生产业务库
      - DMS
      - SQL
      - 业务表
      - 数据库表
      - 登录日志
      - 用户表
      - 任务表
      - 渠道转化
      - 结构化统计
    legacy_skill_entrypoint: "@bairong-data-query/natural-language-data-query"
    safety_policy:
      read_only: true
      allow_detail_dump: false
      require_source_statement: true
      max_preview_rows: unlimited
    output_mapping:
      aggregate_result: sessions/{session_id}/result.aggregate.json
      preview_result: sessions/{session_id}/result.preview.json
      chart_spec: sessions/{session_id}/chart-spec.json

  - id: custom_mcp_query_service
    type: mcp_tool
    display_name: 自定义 MCP 查询服务
    status: draft
    mcp_server_hint: custom-query-mcp
    tool_name: query
    description: 后续 MCP 查询服务登记模板。
    input_schema_ref: knowledge/query-providers/custom_mcp_query_service/input-schema.json
    output_schema_ref: knowledge/query-providers/custom_mcp_query_service/output-schema.json
    routing_keywords:
      - 自定义查询
      - 新 MCP 服务
      - custom query
      - mcp query
    safety_policy:
      read_only: true
      allow_detail_dump: false
      max_preview_rows: unlimited
    output_mapping:
      rows_path: "$.rows"
      columns_path: "$.columns"
      summary_path: "$.summary"

  - id: online_logs
    type: mcp_tool
    display_name: 线上日志查询
    status: enabled
    aliases:
      - baizhi_online_logs
    mcp_server_hint: alibaba_cloud_observability
    tool_name: sls_execute_sql
    tool_names:
      - sls_list_projects
      - sls_list_logstores
      - sls_execute_sql
      - sls_get_context_logs
      - cms_execute_promql
      - sls_execute_spl
    description: 线上日志、SLS、上下文日志、PromQL 和 SPL 查询 MCP。Agent 必须先确认指标、数据源、计算口径和时间范围，再调用该 provider。
    input_schema_ref: knowledge/query-providers/online_logs/input-schema.json
    output_schema_ref: knowledge/query-providers/online_logs/output-schema.json
    routing_keywords:
      - 线上日志
      - 日志
      - SLS
      - LogStore
      - logstore
      - observability
      - 可观测
      - APP 活跃
      - token 活跃
      - 已登录 token
      - 行为日志
      - 错误日志
      - agent 日志
      - PromQL
      - SPL
      - agent service
      - chronos
    safety_policy:
      read_only: true
      allow_detail_dump: false
      require_confirmation: true
      require_source_statement: true
      max_preview_rows: unlimited
    output_mapping:
      rows_path: "$.data.rows"
      columns_path: "$.data.columns"
      summary_path: "$.data.summary"
      raw_text_path: "$.content[0].text"
`
);

const providerRegistryPath = path.join(workspacePath, "config", "query-providers.yaml");
let providerRegistryText = safeReadText(providerRegistryPath);
let migratedProviderRegistryText = providerRegistryText
  .replace("display_name: Baizhi internal data query", "display_name: 内部数据查询")
  .replace("display_name: 百智内部数据查询", "display_name: 内部数据查询")
  .replace("display_name: 百智线上日志查询", "display_name: 线上日志查询")
  .replace("description: 百智生产业务库只读 SQL / DMS 查询 provider。", "description: 生产业务库只读 SQL / DMS 查询 provider。")
  .replace("description: 百智线上日志、SLS、上下文日志、PromQL 和 SPL 查询 MCP。", "description: 线上日志、SLS、上下文日志、PromQL 和 SPL 查询 MCP。")
  .replace("display_name: Custom MCP query service", "display_name: 自定义 MCP 查询服务")
  .replace("description: Template for registering a future MCP query service.", "description: 后续 MCP 查询服务登记模板。");
migratedProviderRegistryText = migratedProviderRegistryText.replaceAll("max_preview_rows: 100", "max_preview_rows: unlimited");
if (migratedProviderRegistryText.includes("id: custom_mcp_query_service") && !migratedProviderRegistryText.includes("自定义查询")) {
  migratedProviderRegistryText = migratedProviderRegistryText.replace(
    "routing_keywords:\n      - custom query",
    "routing_keywords:\n      - 自定义查询\n      - 新 MCP 服务\n      - custom query"
  );
}
if (migratedProviderRegistryText.includes("id: bairong_data_query") && !migratedProviderRegistryText.includes("mcp_server_hint: aliyun-dms-mcp-server")) {
  migratedProviderRegistryText = migratedProviderRegistryText.replace(
    "status: enabled\n    routing_keywords:",
    "status: enabled\n    mcp_server_hint: aliyun-dms-mcp-server\n    tool_name: executeScript\n    routing_keywords:"
  );
}
if (/^default_provider:\s*bairong_data_query\s*$/m.test(migratedProviderRegistryText)) {
  migratedProviderRegistryText = migratedProviderRegistryText.replace(/^default_provider:\s*bairong_data_query\s*$/m, "default_provider: internal_data_query");
}
if (!hasProvider(migratedProviderRegistryText, internalDataProviderId)) {
  migratedProviderRegistryText = `${migratedProviderRegistryText.trimEnd()}\n${internalDataProviderBlock()}`;
}
if (!hasProvider(migratedProviderRegistryText, onlineLogsProviderId)) {
  migratedProviderRegistryText = `${migratedProviderRegistryText.trimEnd()}\n${onlineLogsProviderBlock()}`;
}
if (hasProvider(migratedProviderRegistryText, internalDataProviderId)) {
  migratedProviderRegistryText = disableLegacyProvider(migratedProviderRegistryText, "bairong_data_query", internalDataProviderId);
}
if (hasProvider(migratedProviderRegistryText, onlineLogsProviderId)) {
  migratedProviderRegistryText = disableLegacyProvider(migratedProviderRegistryText, "baizhi_online_logs", onlineLogsProviderId);
}
if (migratedProviderRegistryText !== providerRegistryText) {
  writeText(providerRegistryPath, migratedProviderRegistryText);
}

writeIfMissing(
  path.join(workspacePath, "knowledge", "backend-projects.yaml"),
  `version: 1
projects:
  - domain: wisenote-eureka
    repo_url: git@git.100credit.cn:ai2c/backend/wisenote/wisenote-eureka.git
    repo_path: knowledge/backend-repos/wisenote-eureka
    source_type: git
    status: registered
    provider_alignment:
      provider_id: internal_data_query
      mapping_status: pending_scan
      note: 克隆并扫描后，将代码字段、状态枚举和表映射补入 field-mappings。
    keywords:
      - wise
      - note
      - status
      - table
      - mapper
  - domain: chronos-agent-hub
    repo_url: git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-hub.git
    repo_path: knowledge/backend-repos/chronos-agent-hub
    source_type: git
    status: registered
    provider_alignment:
      provider_id: internal_data_query
      mapping_status: pending_scan
      note: 克隆并扫描后，将代码字段、状态枚举和表映射补入 field-mappings。
    keywords:
      - agent
      - task
      - status
      - table
      - mapper
  - domain: chronos-agent-facade
    repo_url: git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-facade.git
    repo_path: knowledge/backend-repos/chronos-agent-facade
    source_type: git
    status: registered
    provider_alignment:
      provider_id: internal_data_query
      mapping_status: pending_scan
      note: 克隆并扫描后，将代码字段、状态枚举和表映射补入 field-mappings。
    keywords:
      - agent
      - facade
      - status
      - table
      - mapper
  - domain: chronos-agent-data
    repo_url: git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-data.git
    repo_path: knowledge/backend-repos/chronos-agent-data
    source_type: git
    status: registered
    provider_alignment:
      provider_id: internal_data_query
      mapping_status: pending_scan
      note: 克隆并扫描后，将代码字段、状态枚举和表映射补入 field-mappings。
    keywords:
      - agent
      - data
      - status
      - table
      - mapper
`
);

const backendProjectsPath = path.join(workspacePath, "knowledge", "backend-projects.yaml");
let backendProjectsText = safeReadText(backendProjectsPath);
for (const project of [
  ["wisenote-eureka", "git@git.100credit.cn:ai2c/backend/wisenote/wisenote-eureka.git", ["wise", "note", "status", "table", "mapper"]],
  ["chronos-agent-hub", "git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-hub.git", ["agent", "task", "status", "table", "mapper"]],
  ["chronos-agent-facade", "git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-facade.git", ["agent", "facade", "status", "table", "mapper"]],
  ["chronos-agent-data", "git@git.100credit.cn:ai2c/backend/100wiser/chronos-agent-data.git", ["agent", "data", "status", "table", "mapper"]]
]) {
  const [domain, repoUrl, keywords] = project;
  if (backendProjectsText.includes(`domain: ${domain}`) || backendProjectsText.includes(`repo_url: ${repoUrl}`)) {
    continue;
  }
  const block = `  - domain: ${domain}
    repo_url: ${repoUrl}
    repo_path: knowledge/backend-repos/${domain}
    source_type: git
    status: registered
    provider_alignment:
      provider_id: internal_data_query
      mapping_status: pending_scan
      note: 克隆并扫描后，将代码字段、状态枚举和表映射补入 field-mappings。
    keywords:
${keywords.map((item) => `      - ${item}`).join("\n")}
`;
  backendProjectsText = backendProjectsText.includes("projects: []")
    ? backendProjectsText.replace("projects: []", `projects:\n${block}`)
    : `${backendProjectsText.trimEnd()}\n${block}`;
}
writeText(backendProjectsPath, backendProjectsText);

writeIfMissing(
  path.join(workspacePath, "app", "package.json"),
  `${JSON.stringify({
    name: "agent-bi-local-app",
    version: VERSION,
    private: true,
    type: "module",
    scripts: {
      start: "node index.mjs",
      check: "node index.mjs --check"
    },
    dependencies: {}
  }, null, 2)}\n`
);

const appPackagePath = path.join(workspacePath, "app", "package.json");
try {
  const appPackage = JSON.parse(safeReadText(appPackagePath, "{}"));
  appPackage.scripts = {
    ...(appPackage.scripts || {}),
    start: "node index.mjs",
    check: "node index.mjs --check"
  };
  appPackage.dependencies = appPackage.dependencies || {};
  writeText(appPackagePath, `${JSON.stringify(appPackage, null, 2)}\n`);
} catch {
  // validate_workspace will report malformed package.json if this ever happens.
}

writeIfMissing(
  path.join(workspacePath, "app", "index.ts"),
  `// 本地 mcp-use App scaffold。
// 当前可运行 Dashboard 位于 Skill 的 assets/dashboard/，本目录用于保留共享工作区内的 App 契约和后续 mcp-use 适配代码。
export const appContract = {
  name: "agent-bi",
  language: "zh-CN",
  dashboardPath: "/dashboard",
  widgetPath: "/mcp-use/widgets/bi-dashboard"
};
`
);

writeText(
  path.join(workspacePath, "app", "index.mjs"),
  `#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspacePath = path.resolve(appDir, "..");
const dashboardServer = ${JSON.stringify(dashboardServerPath)};
const args = new Set(process.argv.slice(2));

if (!fs.existsSync(dashboardServer)) {
  console.error("未找到 Dashboard server：" + dashboardServer);
  process.exit(1);
}

if (args.has("--check")) {
  console.log(JSON.stringify({
    ok: true,
    workspacePath,
    dashboardServer,
    entrypoint: "app/index.mjs",
    note: "本地 App 使用共享工作区入口启动 Agent BI Dashboard。"
  }, null, 2));
  process.exit(0);
}

const child = spawn(process.execPath, [dashboardServer], {
  stdio: "inherit",
  env: {
    ...process.env,
    AGENT_BI_WORKSPACE: workspacePath,
    BAIZHI_BI_WORKSPACE: workspacePath,
    HOST: process.env.HOST || "127.0.0.1",
    PORT: process.env.PORT || "3000"
  }
});

child.on("exit", (code) => process.exit(code || 0));
`
);

writeIfMissing(
  path.join(workspacePath, "app", "resources", "bi-dashboard", "types.ts"),
  `export type BiDashboardWidgetState = {
  workspacePath: string;
  currentSessionId: string | null;
  updatedAt: string | null;
  question?: string;
  status?: string;
  providerId?: string;
  metrics?: string[];
  previewRows?: Record<string, unknown>[];
  metricPlan?: string;
  queryPlan?: string;
};
`
);

const widgetPath = path.join(workspacePath, "app", "resources", "bi-dashboard", "widget.tsx");
const widgetTemplate = `import type { BiDashboardWidgetState } from "./types";

type Props = {
  state: BiDashboardWidgetState;
};

export function BiDashboardWidget({ state }: Props) {
  const rows = state.previewRows || [];
  const columns = rows.length ? Object.keys(rows[0] || {}).slice(0, 6) : [];
  return (
    <section style={{ fontFamily: "system-ui, sans-serif", color: "#202426", padding: 12 }}>
      <div style={{ fontSize: 12, color: "#287271", fontWeight: 700 }}>Agent BI 组件</div>
      <h1 style={{ fontSize: 18, margin: "4px 0 8px" }}>{state.question || state.currentSessionId || "当前分析"}</h1>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "#687074" }}>
        查询记录：{state.currentSessionId || "无"} · 状态：{state.status || "未知"} · 查询源：{state.providerId || "未知"}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {(state.metrics || []).map((metric) => (
          <span key={metric} style={{ border: "1px solid #d8d3c9", borderRadius: 6, padding: "3px 7px", fontSize: 12 }}>
            {metric}
          </span>
        ))}
      </div>
      <h2 style={{ fontSize: 13, margin: "10px 0 6px" }}>数据预览</h2>
      <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid #d8d3c9", borderRadius: 7 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>{columns.map((column) => <th key={column} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #d8d3c9" }}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row, index) => (
              <tr key={index}>{columns.map((column) => <td key={column} style={{ padding: 6, borderBottom: "1px solid #eee" }}>{String(row[column] ?? "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <div style={{ padding: 10, color: "#687074" }}>暂无预览数据</div> : null}
      </div>
      <h2 style={{ fontSize: 13, margin: "10px 0 6px" }}>指标计划</h2>
      <pre style={{ maxHeight: 110, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>{state.metricPlan || "暂无"}</pre>
      <h2 style={{ fontSize: 13, margin: "10px 0 6px" }}>查询计划</h2>
      <pre style={{ maxHeight: 110, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>{state.queryPlan || "暂无"}</pre>
    </section>
  );
}
`;

const existingWidget = safeReadText(widgetPath);
if (!existingWidget || existingWidget.includes("return null")) {
  writeText(widgetPath, widgetTemplate);
}

const typesPath = path.join(workspacePath, "app", "resources", "bi-dashboard", "types.ts");
const existingTypes = safeReadText(typesPath);
if (existingTypes && !existingTypes.includes("previewRows")) {
  writeText(typesPath, `export type BiDashboardWidgetState = {
  workspacePath: string;
  currentSessionId: string | null;
  updatedAt: string | null;
  question?: string;
  status?: string;
  providerId?: string;
  metrics?: string[];
  previewRows?: Record<string, unknown>[];
  metricPlan?: string;
  queryPlan?: string;
};
`);
}

writeIfMissing(
  widgetPath,
  widgetTemplate
);

writeIfMissing(
  path.join(workspacePath, "app", "public", "README.md"),
  "# 本地 App 静态资源\n\nDashboard MVP 当前由 Skill 内置 server 提供；此目录预留给共享工作区内的 mcp-use App 静态资源。\n"
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "backend-projects.yaml"),
  `version: 1
projects: []
`
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "query-providers", "custom_mcp_query_service", "input-schema.json"),
  `${JSON.stringify({
    type: "object",
    properties: {
      question: { type: "string" },
      metric_plan: { type: "object" },
      query_plan: { type: "object" }
    },
    required: ["question"],
    additionalProperties: true
  }, null, 2)}\n`
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "query-providers", "custom_mcp_query_service", "output-schema.json"),
  `${JSON.stringify({
    type: "object",
    properties: {
      columns: { type: "array", items: { type: "string" } },
      rows: { type: "array", items: { type: "object" } },
      summary: { type: "object" },
      chart_spec: { type: "object" }
    },
    required: ["columns", "rows"],
    additionalProperties: true
  }, null, 2)}\n`
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "query-providers", "custom_mcp_query_service", "usage.md"),
  "# 自定义 MCP 查询服务\n\n这是普通 MCP provider 的登记模板。启用前请补充真实 server、tool、输入输出 schema 和安全策略。\n"
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "query-providers", "custom_mcp_query_service", "safety.md"),
  "# 安全策略\n\n- read_only: true\n- allow_detail_dump: false\n- max_preview_rows: unlimited\n- draft provider 执行前必须用户确认。\n"
);

const onlineLogsProviderDir = path.join(workspacePath, "knowledge", "query-providers", onlineLogsProviderId);
mkdirp(path.join(onlineLogsProviderDir, "tools"));
for (const [toolName, tool] of Object.entries(onlineLogsToolSchemas)) {
  writeJson(path.join(onlineLogsProviderDir, "tools", `${toolName}.input-schema.json`), tool.inputSchema);
}
writeJson(path.join(onlineLogsProviderDir, "input-schema.json"), {
  type: "object",
  required: ["tool", "arguments"],
  properties: {
    tool: {
      type: "string",
      enum: Object.keys(onlineLogsToolSchemas),
      description: "要调用的 alibaba_cloud_observability MCP 工具名。"
    },
    arguments: {
      type: "object",
      description: "对应工具的参数。具体 schema 见 tools/*.input-schema.json。"
    },
    metric_context: {
      type: "object",
      description: "Agent 确认后的指标、数据源、时间范围、口径、假设和风险摘要。"
    }
  },
  additionalProperties: false
});
writeJson(path.join(onlineLogsProviderDir, "output-schema.json"), {
  type: "object",
  properties: {
    content: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          text: { type: "string" }
        },
        additionalProperties: true
      }
    },
    data: {
      type: "object",
      description: "解析 content[0].text 后得到的结构化返回。不同工具返回结构不同。"
    },
    error: { type: "boolean" },
    message: { type: "string" }
  },
  additionalProperties: true
});
writeText(path.join(onlineLogsProviderDir, "usage.md"), `# 线上日志查询

Provider id：${onlineLogsProviderId}
MCP server hint：alibaba_cloud_observability

## 可用工具

${Object.entries(onlineLogsToolSchemas).map(([toolName, tool]) => `- \`${toolName}\`：${tool.description}`).join("\n")}

## Agent 使用流程

1. 根据用户自然语言需求生成解释、指标计划、查询计划和确认单草稿。
2. 和用户确认指标、线上日志数据源、project/logstore/metric store/workspace、时间范围、计算口径、过滤、去重、风险。
3. 用户确认后才允许调用本 provider。
4. 查询完成后解析 MCP 返回的 \`content[0].text\` JSON 字符串，导入标准 \`result.aggregate.json\`、\`result.preview.json\` 和 \`chart-spec.json\`。
5. 在 \`provider-execution.json\` 和 \`audit.md\` 记录真实工具、project、logstore 或 metric store、时间范围和数据源确认语句。

## 默认路由

- 查询线上日志、行为日志、错误日志、SLS、LogStore、APP token 活跃、已登录 token 使用、PromQL 或 SPL 时优先选择本 provider。
- 需要库表事实或业务库 SQL 时使用 \`${internalDataProviderId}\` / \`aliyun-dms-mcp-server\`，不要混用。
`);
writeText(path.join(onlineLogsProviderDir, "safety.md"), `# 安全策略

- read_only: true
- allow_detail_dump: false
- require_confirmation: true
- require_source_statement: true
- max_preview_rows: unlimited
- Dashboard 只展示 provider 和结果，不得调用本 MCP。
- 不在工作区保存 AccessKey、Secret、Authorization、token、endpoint 凭据或未裁剪的生产明细原始日志。
- \`sls_execute_sql\`、\`cms_execute_promql\`、\`sls_execute_spl\` 必须使用明确时间范围，默认导入 provider 返回的完整聚合和 preview 结果；保存未聚合原始明细必须由用户明确要求。
`);
writeText(path.join(onlineLogsProviderDir, "examples.md"), `# 示例

## 查询 logstore 列表

\`\`\`json
{
  "tool": "sls_list_logstores",
  "arguments": {
    "regionId": "cn-beijing",
    "project": "example-agent-logs",
    "limit": 20
  }
}
\`\`\`

## 查询近 2 天 APP token 活跃相关日志

实际 query 必须在 Agent 和用户确认 project、logstore、字段名、去重口径后填写。

\`\`\`json
{
  "tool": "sls_execute_sql",
  "arguments": {
    "regionId": "cn-beijing",
    "project": "example-agent-logs",
    "logStore": "agent-service",
    "from_time": "now-2d",
    "to_time": "now",
    "query": "* | select date_format(__time__, '%Y-%m-%d') as dt, count(distinct user_id) as active_users group by dt order by dt",
    "limit": 100
  }
}
\`\`\`
`);

writeIfMissing(
  path.join(workspacePath, "knowledge", "table-catalog.md"),
  "# 表目录\n\n记录分析过程中发现的表、字段和口径事实。\n"
);

writeIfMissing(
  path.join(workspacePath, "knowledge", "business-context.md"),
  "# 业务上下文\n\n记录可复用的业务逻辑、状态枚举、字段含义和领域假设。\n"
);

writeIfMissing(
  path.join(workspacePath, "metrics", "_index.yaml"),
  `version: 1
metrics: []
`
);

writeIfMissing(
  path.join(workspacePath, "dashboards", "current.json"),
  `${JSON.stringify({ currentSessionId: null, updatedAt: createdAt }, null, 2)}\n`
);

const userConfig = ensureUserConfig(workspacePath);
const mcpReadiness = writeMcpReadinessReport(workspacePath);
const runLogPath = logSkillRun(workspacePath, "workspace.ensured", { version: VERSION, seededKnowledgeFiles });

console.log(JSON.stringify({
  ok: true,
  workspacePath,
  userConfig,
  runLogPath,
  seededKnowledgeFiles,
  mcpReadiness: {
    ...summarizeMcpReadiness(mcpReadiness),
    reportPath: mcpReadiness.outputPath
  }
}, null, 2));
