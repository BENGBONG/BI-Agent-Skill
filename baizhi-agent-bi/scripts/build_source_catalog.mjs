#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  logSkillRun,
  mkdirp,
  nowIso,
  readJson,
  resolveWorkspacePath,
  safeReadText,
  writeJson,
  writeText
} from "./lib/workspace.mjs";

const workspacePath = resolveWorkspacePath();
const catalogDir = path.join(workspacePath, "knowledge", "source-catalog");
const builtAt = nowIso();
const ignoredProviderPattern = /^evaluation_mcp_/;
const ignoredDomains = new Set(["evaluation"]);

function yamlScalar(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
}

function yamlList(text, key) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `${key}:`);
  if (index < 0) {
    return [];
  }
  const baseIndent = lines[index].match(/^\s*/)?.[0].length || 0;
  const values = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim()) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (indent <= baseIndent && !line.trim().startsWith("-")) {
      break;
    }
    const match = line.match(/^\s*-\s*(.+)$/);
    if (match) {
      values.push(match[1].trim().replace(/^"|"$/g, ""));
    }
  }
  return values;
}

function parseProviderBlocks() {
  const raw = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
  return raw.split(/\n\s*-\s+id:\s*/).slice(1).map((block) => {
    const lines = block.split(/\r?\n/);
    const id = lines[0].trim();
    const text = `id: ${id}\n${lines.slice(1).join("\n")}`;
    const schemaDir = path.join(workspacePath, "knowledge", "query-providers", id);
    const toolSchemaDir = path.join(schemaDir, "tools");
    const toolSchemas = fs.existsSync(toolSchemaDir)
      ? fs.readdirSync(toolSchemaDir)
          .filter((file) => file.endsWith(".input-schema.json"))
          .sort()
          .map((file) => ({
            tool: file.replace(/\.input-schema\.json$/, ""),
            schemaRef: path.relative(workspacePath, path.join(toolSchemaDir, file)),
            inputFields: Object.keys(readJson(path.join(toolSchemaDir, file), { properties: {} }).properties || {})
          }))
      : [];
    const provider = {
      id,
      type: yamlScalar(text, "type"),
      displayName: yamlScalar(text, "display_name") || id,
      status: yamlScalar(text, "status") || "unknown",
      legacyReplacedBy: yamlScalar(text, "legacy_replaced_by"),
      mcpServerHint: yamlScalar(text, "mcp_server_hint"),
      toolName: yamlScalar(text, "tool_name"),
      toolNames: yamlList(text, "tool_names"),
      skillEntrypoint: yamlScalar(text, "skill_entrypoint"),
      description: yamlScalar(text, "description"),
      routingKeywords: yamlList(text, "routing_keywords"),
      safetyPolicy: {
        readOnly: yamlScalar(text, "read_only") === "true",
        allowDetailDump: yamlScalar(text, "allow_detail_dump") === "true",
        requireConfirmation: yamlScalar(text, "require_confirmation") === "true",
        requireSourceStatement: yamlScalar(text, "require_source_statement") === "true",
        maxPreviewRows: yamlScalar(text, "max_preview_rows") || "unlimited"
      },
      inputSchemaRef: yamlScalar(text, "input_schema_ref"),
      outputSchemaRef: yamlScalar(text, "output_schema_ref"),
      toolSchemas,
      capabilities: inferProviderCapabilities(text, toolSchemas)
    };
    return { ...provider, ...providerProfile(provider) };
  }).filter((provider) => !ignoredProviderPattern.test(provider.id));
}

function providerProfile(provider) {
  if (provider.id === "internal_data_query" || provider.id === "bairong_data_query") {
    return {
      capabilities: ["production_sql_query"],
      queryScope: [
        "生产业务库只读 SQL / DMS 查询",
        "适合库表型业务事实、登录日志表、用户/任务/渠道/转化等结构化统计",
        "需要通过已登记 DMS MCP 或兼容数据查询 provider 执行"
      ],
      knownData: [
        "DMS database_id: 73462415（历史查询证据）",
        "schema: chronos（历史查询证据）",
        "表线索: t_user_login_logs（APP 登录活跃历史查询使用）",
        "知识库字段线索来自 chronos-agent-* / wisenote-eureka 扫描"
      ],
      routingGuide: "当问题需要生产业务库 SQL、数据库表、结构化业务字段或库表口径时选择；当问题来自线上日志、SLS、LogStore、PromQL 或 SPL 时不要走这个 provider。",
      limitations: [
        "registry 只登记了入口和安全策略，完整库表列表需要 Agent 在执行前通过 schema/DMS 或代码证据确认",
        "必须先确认指标、数据源、时间字段、去重和风险；Dashboard 不直接执行",
        "不允许导出敏感明细，默认只保存聚合和 preview"
      ]
    };
  }
  if (provider.id === "online_logs" || provider.id === "baizhi_online_logs") {
    return {
      capabilities: ["online_log_query", "metric_timeseries_query", "advanced_log_spl_query"],
      queryScope: [
        "阿里云 SLS 日志查询",
        "LogStore / 上下文日志 / PromQL / SPL",
        "适合 APP token 活跃、行为日志、错误日志和线上服务观测"
      ],
      knownData: [
        "工具: sls_list_projects",
        "工具: sls_list_logstores",
        "工具: sls_execute_sql",
        "工具: sls_get_context_logs",
        "工具: cms_execute_promql",
        "工具: sls_execute_spl"
      ],
      routingGuide: "当问题明确是线上日志、SLS、LogStore、token 使用、行为日志、错误日志、PromQL 或 SPL 时选择；需要业务库 SQL 时转向内部数据查询 provider。",
      limitations: [
        "执行前必须确认 project/logstore/workspace、时间范围和脱敏规则",
        "不能保存 raw token、Authorization、Cookie 等敏感字段"
      ]
    };
  }
  return {
    capabilities: provider.status === "draft" ? ["custom_query_draft"] : provider.capabilities,
    queryScope: provider.status === "draft" ? ["自定义查询服务草稿，未完成能力扫描"] : provider.capabilities,
    knownData: [],
    routingGuide: provider.description || "",
    limitations: []
  };
}

function inferProviderCapabilities(text, toolSchemas) {
  const lower = text.toLowerCase();
  const capabilities = [];
  if (lower.includes("executeScript".toLowerCase()) || lower.includes("dms") || lower.includes("bairong") || lower.includes("internal_data_query")) {
    capabilities.push("production_sql_query");
  }
  if (lower.includes("sls") || lower.includes("logstore") || toolSchemas.some((item) => item.tool.startsWith("sls_"))) {
    capabilities.push("online_log_query");
  }
  if (lower.includes("promql") || toolSchemas.some((item) => item.tool.includes("promql"))) {
    capabilities.push("metric_timeseries_query");
  }
  if (lower.includes("spl") || toolSchemas.some((item) => item.tool.includes("spl"))) {
    capabilities.push("advanced_log_spl_query");
  }
  return capabilities.length ? capabilities : ["custom_query"];
}

function parseBackendProjects() {
  const raw = safeReadText(path.join(workspacePath, "knowledge", "backend-projects.yaml"));
  const blocks = raw.split(/\n\s*-\s+domain:\s*/).slice(1);
  const projects = blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const domain = lines[0].trim();
    const text = `domain: ${domain}\n${lines.slice(1).join("\n")}`;
    if (ignoredDomains.has(domain)) {
      return null;
    }
    const repoPathValue = yamlScalar(text, "repo_path");
    const repoPath = repoPathValue ? path.resolve(workspacePath, repoPathValue) : "";
    const scan = latestFile(path.join(workspacePath, "knowledge", "code-scans"), `${domain}.md`);
    const mapping = latestFile(path.join(workspacePath, "knowledge", "field-mappings"), `${domain}.yaml`);
    const fields = mapping ? parseFieldMapping(mapping) : [];
    return {
      domain,
      repoUrl: yamlScalar(text, "repo_url"),
      repoPath: repoPathValue,
      repoExists: repoPath ? fs.existsSync(repoPath) : false,
      status: yamlScalar(text, "status") || "registered",
      providerId: yamlScalar(text, "provider_id") || "internal_data_query",
      keywords: yamlList(text, "keywords"),
      latestScan: scan ? path.relative(workspacePath, scan) : "",
      latestFieldMapping: mapping ? path.relative(workspacePath, mapping) : "",
      codeFacts: scan ? summarizeCodeScan(scan, { domain, fields }) : null,
      fields
    };
  }).filter(Boolean);
  const deduped = new Map();
  for (const project of projects) {
    const key = project.domain;
    const existing = deduped.get(key);
    const existingScore = (existing?.latestScan ? 10 : 0) + (existing?.fields?.length || 0);
    const projectScore = (project.latestScan ? 10 : 0) + project.fields.length;
    if (!existing || projectScore >= existingScore) {
      deduped.set(key, project);
    }
  }
  return [...deduped.values()];
}

function latestFile(dir, suffix) {
  if (!fs.existsSync(dir)) {
    return "";
  }
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(suffix)).sort().reverse();
  return files[0] ? path.join(dir, files[0]) : "";
}

function summarizeCodeScan(filePath, context = {}) {
  const text = safeReadText(filePath);
  const hitFiles = Number(text.match(/命中文件数：(\d+)/)?.[1] || 0);
  const hitSnippets = Number(text.match(/命中片段数：(\d+)/)?.[1] || 0);
  const files = [...text.matchAll(/^###\s+(.+?):(\d+)/gm)].slice(0, 20).map((match) => ({
    file: match[1],
    line: Number(match[2])
  }));
  const keyFiles = [...text.matchAll(/^- (.+)$/gm)]
    .map((match) => match[1])
    .filter((file) => !/^(扫描时间|Repo|关键词|命中文件数|命中片段数)：/.test(file))
    .slice(0, 20);
  const fieldNames = (context.fields || []).slice(0, 12).map((field) => field.field);
  const tableFiles = keyFiles.filter((file) => /\.(sql|xml)$/i.test(file) || /migration|migrate|mapper|repository|dao/i.test(file)).slice(0, 8);
  const serviceFiles = keyFiles.filter((file) => /\.(java|kt|groovy)$/i.test(file) && /service|controller|client|entity|dto/i.test(file)).slice(0, 8);
  const summaryParts = [
    `${context.domain || "该知识库"} 已完成本地扫描`,
    hitFiles ? `命中 ${hitFiles} 个文件` : "",
    hitSnippets ? `${hitSnippets} 个片段` : "",
    fieldNames.length ? `抽取字段线索 ${fieldNames.length} 个：${fieldNames.join(" / ")}` : "暂未抽取字段线索"
  ].filter(Boolean);
  return {
    scanRef: path.relative(workspacePath, filePath),
    summary: `${summaryParts.join("，")}。这些信息用于指标匹配、字段定位和口径风险提示，执行查询前仍需 Agent 在对话中确认。`,
    keyFiles,
    tableFiles,
    serviceFiles,
    evidence: files
  };
}

function parseFieldMapping(filePath) {
  const text = safeReadText(filePath);
  const fields = [];
  let current = null;
  let listKey = "";
  for (const line of text.split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*-\s+field:\s*(.+)$/);
    if (fieldMatch) {
      if (current) {
        fields.push(current);
      }
      current = {
        field: fieldMatch[1].trim().replace(/^"|"$/g, ""),
        mappingRef: path.relative(workspacePath, filePath),
        meaning: "待根据代码证据确认",
        sourceKinds: [],
        owners: [],
        dataTypes: [],
        evidence: [],
        queryable: "unknown"
      };
      listKey = "";
      if (fields.length >= 240) {
        break;
      }
      continue;
    }
    if (!current) {
      continue;
    }
    const meaningMatch = line.match(/^\s*meaning:\s*(.+)$/);
    if (meaningMatch) {
      current.meaning = meaningMatch[1].trim().replace(/^"|"$/g, "");
      listKey = "";
      continue;
    }
    const listMatch = line.match(/^\s*(source_kinds|owners|data_types|evidence):\s*$/);
    if (listMatch) {
      listKey = listMatch[1];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch && listKey) {
      const value = itemMatch[1].trim().replace(/^"|"$/g, "");
      if (listKey === "source_kinds") current.sourceKinds.push(value);
      if (listKey === "owners") current.owners.push(value);
      if (listKey === "data_types") current.dataTypes.push(value);
      if (listKey === "evidence") current.evidence.push(value);
    }
  }
  if (current && fields.length < 240) {
    fields.push(current);
  }
  return fields;
}

function parseFieldMeaningOverlays() {
  const dir = path.join(workspacePath, "knowledge", "field-meanings");
  if (!fs.existsSync(dir)) {
    return new Map();
  }
  const overlays = new Map();
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  for (const file of files) {
    const filePath = path.join(dir, file);
    const payload = readJson(filePath, null);
    const updates = Array.isArray(payload?.updates) ? payload.updates : [];
    for (const update of updates) {
      const field = String(update.field || "").trim();
      if (!field) {
        continue;
      }
      const items = overlays.get(field) || [];
      items.push({
        ...update,
        overlayRef: path.relative(workspacePath, filePath),
        createdAt: payload.createdAt || "",
        sessionId: payload.sessionId || "",
        providerId: payload.source?.providerId || "",
        metrics: payload.source?.metrics || [],
        sourceTables: update.sourceTables || payload.source?.sourceTables || [],
        question: payload.source?.question || ""
      });
      overlays.set(field, items);
    }
  }
  return overlays;
}

function buildFieldLineage(projects, providers, meaningOverlays = new Map()) {
  const byField = new Map();
  for (const project of projects) {
    for (const field of project.fields) {
      const record = byField.get(field.field) || {
        field: field.field,
        domains: [],
        providerHints: [],
        evidence: [],
        queryable: "unknown",
        sensitivity: inferSensitivity(field.field),
        meaning: field.meaning || "",
        meanings: [],
        sourceKinds: [],
        owners: [],
        dataTypes: []
      };
      record.domains.push(project.domain);
      record.providerHints.push(project.providerId);
      record.evidence.push(field.mappingRef);
      for (const sourceKind of field.sourceKinds || []) {
        record.sourceKinds.push(sourceKind);
      }
      for (const owner of field.owners || []) {
        record.owners.push(owner);
      }
      for (const dataType of field.dataTypes || []) {
        record.dataTypes.push(dataType);
      }
      for (const evidence of field.evidence || []) {
        record.evidence.push(`${project.domain}:${evidence}`);
      }
      if (!record.meaning && field.meaning) {
        record.meaning = field.meaning;
      }
      if (field.meaning && field.meaning !== "待 Agent 根据代码证据确认") {
        record.meanings.push(field.meaning);
      }
      byField.set(field.field, record);
    }
  }
  for (const provider of providers) {
    for (const tool of provider.toolSchemas) {
      for (const field of tool.inputFields) {
        const record = byField.get(field) || {
          field,
          domains: [],
          providerHints: [],
          evidence: [],
          queryable: "provider_input",
          sensitivity: inferSensitivity(field),
          meaning: "provider 输入参数",
          meanings: ["provider 输入参数"],
          sourceKinds: ["provider_input"],
          owners: [provider.id],
          dataTypes: []
        };
        record.providerHints.push(provider.id);
        record.evidence.push(tool.schemaRef);
        byField.set(field, record);
      }
    }
  }
  for (const [field, overlays] of meaningOverlays.entries()) {
    const latest = [...overlays].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).at(-1);
    const record = byField.get(field) || {
      field,
      domains: [],
      providerHints: [],
      evidence: [],
      queryable: "query_context",
      sensitivity: inferSensitivity(field),
      meaning: latest?.meaning || "",
      meanings: [],
      sourceKinds: [],
      owners: [],
      dataTypes: []
    };
    for (const overlay of overlays) {
      if (overlay.providerId) {
        record.providerHints.push(overlay.providerId);
      }
      if (overlay.meaning) {
        record.meanings.push(overlay.meaning);
      }
      if (overlay.detail && overlay.detail !== overlay.meaning) {
        record.meanings.push(overlay.detail);
      }
      if (overlay.role) {
        record.sourceKinds.push(`query_${overlay.role}`);
      }
      record.sourceKinds.push("query_knowledge_update");
      for (const owner of overlay.sourceTables || []) {
        record.owners.push(owner);
      }
      if (overlay.overlayRef) {
        record.evidence.push(overlay.overlayRef);
      }
      for (const evidence of overlay.evidence || []) {
        record.evidence.push(evidence);
      }
    }
    if (latest?.meaning) {
      record.meaning = latest.meaning;
    }
    byField.set(field, record);
  }
  return [...byField.values()].map((item) => ({
    ...item,
    domains: [...new Set(item.domains)].sort(),
    providerHints: [...new Set(item.providerHints)].sort(),
    sourceKinds: [...new Set(item.sourceKinds || [])].sort(),
    owners: [...new Set(item.owners || [])].sort(),
    dataTypes: [...new Set(item.dataTypes || [])].sort(),
    meanings: [...new Set(item.meanings || [])].sort(),
    evidence: [...new Set(item.evidence)].sort()
  })).sort((a, b) => a.field.localeCompare(b.field));
}

function inferSensitivity(fieldName) {
  const lower = fieldName.toLowerCase();
  if (/(token|authorization|cookie|password|secret|accesskey|refresh)/.test(lower)) {
    return "secret";
  }
  if (/(userid|user_id|uid|mobile|phone|email|idcard|device)/.test(lower)) {
    return "personal_or_identifier";
  }
  return "normal";
}

function buildMetricCandidates(fieldLineage, projects, providers) {
  const candidates = [];
  const fields = fieldLineage.map((item) => item.field.toLowerCase());
  if (fields.some((field) => /(user|uid)/.test(field))) {
    candidates.push({
      metricId: "active_user_count",
      name: "活跃用户数",
      grain: "user_day",
      requiredFields: ["resolved_user_id", "event_time", "client_type"],
      providerHints: providers.filter((provider) => provider.capabilities.includes("online_log_query")).map((provider) => provider.id),
      risks: ["需要可安全去重的用户标识字段；token/Authorization 不能直接作为结果明细保存。"]
    });
  }
  if (projects.some((project) => project.domain.includes("chronos-agent"))) {
    candidates.push({
      metricId: "agent_task_execution_count",
      name: "Agent 任务执行数",
      grain: "task_event",
      requiredFields: ["task_type", "status", "created_at"],
      providerHints: ["internal_data_query", "online_logs"],
      risks: ["需要确认任务状态枚举和去重事件 id。"]
    });
  }
  return candidates;
}

mkdirp(catalogDir);
const providers = parseProviderBlocks();
const projects = parseBackendProjects();
const mcpServers = readJson(path.join(workspacePath, "config", "mcp-servers.json"), { servers: [] });
const meaningOverlays = parseFieldMeaningOverlays();
const fieldMeaningOverlayCount = [...meaningOverlays.values()].reduce((sum, items) => sum + items.length, 0);
const fieldLineage = buildFieldLineage(projects, providers, meaningOverlays);
const metricCandidates = buildMetricCandidates(fieldLineage, projects, providers);
const index = {
  version: 1,
  builtAt,
  workspacePath,
  counts: {
    providers: providers.length,
    mcpServers: Array.isArray(mcpServers.servers) ? mcpServers.servers.length : 0,
    backendProjects: projects.length,
    fields: fieldLineage.length,
    fieldMeaningOverlays: fieldMeaningOverlayCount,
    metricCandidates: metricCandidates.length
  },
  files: {
    services: "knowledge/source-catalog/services.json",
    queryCapabilities: "knowledge/source-catalog/query-capabilities.json",
    fieldLineage: "knowledge/source-catalog/field-lineage.json",
    metricCandidates: "knowledge/source-catalog/metric-candidates.json"
  }
};

writeJson(path.join(catalogDir, "services.json"), { version: 1, builtAt, backendProjects: projects, mcpServers: mcpServers.servers || [] });
writeJson(path.join(catalogDir, "query-capabilities.json"), { version: 1, builtAt, providers });
writeJson(path.join(catalogDir, "field-lineage.json"), { version: 1, builtAt, fields: fieldLineage });
writeJson(path.join(catalogDir, "metric-candidates.json"), { version: 1, builtAt, metrics: metricCandidates });
writeJson(path.join(catalogDir, "index.json"), index);
writeText(path.join(catalogDir, "README.md"), `# 数据源能力索引

- 构建时间：${builtAt}
- Provider 数：${providers.length}
- MCP 服务数：${Array.isArray(mcpServers.servers) ? mcpServers.servers.length : 0}
- 知识库项目数：${projects.length}
- 字段线索数：${fieldLineage.length}
- 查询沉淀字段说明数：${fieldMeaningOverlayCount}

本目录由 \`node scripts/build_source_catalog.mjs\` 生成。它只整理本地 registry、schema、代码扫描和字段映射，不执行生产查询，不保存密钥。
`);
logSkillRun(workspacePath, "source_catalog.built", index.counts);
console.log(JSON.stringify({ ok: true, catalogDir, ...index }, null, 2));
