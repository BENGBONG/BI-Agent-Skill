import fs from "node:fs";
import path from "node:path";
import {
  appendJsonl,
  appendText,
  findSessionDir,
  listSessionIds,
  mkdirp,
  nowIso,
  readJson,
  safeName,
  safeReadText,
  writeJson,
  writeText
} from "./workspace.mjs";

const defaultTargetId = "team_ai_table";
const managementTables = {
  metrics: "共享指标库",
  datasets: "共享数据集目录",
  audit: "共享记录审计"
};

const managementFields = {
  metrics: [
    ["metric_id", "text"],
    ["name", "text"],
    ["status", "singleSelect"],
    ["version", "number"],
    ["definition", "richText"],
    ["grain", "text"],
    ["time_field", "text"],
    ["dimensions", "richText"],
    ["source_tables", "richText"],
    ["field_meanings", "richText"],
    ["related_sessions", "richText"],
    ["actual_sql", "richText"],
    ["shared_by", "text"],
    ["shared_at", "date"],
    ["local_metric_path", "text"],
    ["source_workspace", "text"],
    ["source_agent", "text"],
    ["share_status", "singleSelect"],
    ["last_updated_at", "date"]
  ],
  datasets: [
    ["dataset_id", "text"],
    ["session_id", "text"],
    ["title", "text"],
    ["metric_definition", "richText"],
    ["data_scope", "singleSelect"],
    ["row_count", "number"],
    ["columns", "richText"],
    ["target_table_name", "text"],
    ["target_table_id", "text"],
    ["source_statement", "richText"],
    ["actual_sql", "richText"],
    ["sensitivity_level", "singleSelect"],
    ["shared_by", "text"],
    ["shared_at", "date"],
    ["local_session_path", "text"]
  ],
  audit: [
    ["share_id", "text"],
    ["share_type", "singleSelect"],
    ["target_id", "text"],
    ["target_base_id", "text"],
    ["target_table", "text"],
    ["status", "singleSelect"],
    ["row_count", "number"],
    ["mcp_server", "text"],
    ["mcp_tools", "richText"],
    ["error_message", "richText"],
    ["created_at", "date"],
    ["completed_at", "date"]
  ]
};

const fieldLabels = {
  metric_id: "指标ID",
  name: "指标名称",
  status: "状态",
  version: "版本",
  definition: "计算口径",
  grain: "统计粒度",
  time_field: "时间字段",
  dimensions: "维度",
  source_tables: "来源表/产物",
  field_meanings: "字段含义",
  related_sessions: "关联查询会话",
  actual_sql: "实际执行SQL",
  shared_by: "共享人",
  shared_at: "共享时间",
  local_metric_path: "本地指标路径",
  source_workspace: "来源工作区",
  source_agent: "来源Agent",
  share_status: "共享状态",
  last_updated_at: "最后更新时间",
  dataset_id: "数据集ID",
  session_id: "查询会话ID",
  title: "标题",
  metric_definition: "指标口径",
  data_scope: "数据范围",
  columns: "字段列表",
  target_table_name: "目标数据表",
  target_table_id: "目标表ID",
  source_statement: "数据源说明",
  sensitivity_level: "敏感级别",
  local_session_path: "本地会话路径",
  share_id: "共享任务ID",
  share_type: "共享类型",
  target_id: "目标ID",
  target_base_id: "目标Base ID",
  target_table: "目标表",
  row_count: "行数",
  mcp_server: "MCP服务",
  mcp_tools: "MCP工具",
  error_message: "错误信息",
  created_at: "创建时间",
  completed_at: "完成时间"
};

const progressSteps = {
  dataset: [
    ["prepare_payload", "准备共享包"],
    ["resolve_target", "确认目标 AI 表格"],
    ["ensure_schema", "检查共享表结构"],
    ["write_records", "写入共享数据"],
    ["write_audit", "写入共享审计"]
  ],
  metric: [
    ["prepare_payload", "准备共享包"],
    ["resolve_target", "确认目标 AI 表格"],
    ["ensure_schema", "检查共享表结构"],
    ["write_records", "写入共享指标"],
    ["write_audit", "写入共享审计"]
  ],
  sync_metrics: [
    ["resolve_target", "确认目标 AI 表格"],
    ["read_schema", "读取共享指标表"],
    ["query_records", "同步共享指标"],
    ["write_cache", "写入本地缓存"]
  ]
};

function profilePath() {
  return process.env.AGENT_BI_PROFILE || path.join(process.env.HOME || "", ".agent-bi", "profile.json");
}

export function getShareProfile() {
  const profile = readJson(profilePath(), {});
  const displayName = String(profile.displayName || profile.userName || profile.name || "").trim();
  return {
    configured: Boolean(displayName),
    displayName,
    userId: String(profile.userId || "").trim(),
    profilePath: profilePath()
  };
}

export function saveShareProfile(input = {}) {
  const displayName = String(input.displayName || input.userName || input.name || "").trim();
  if (!displayName) {
    throw new Error("必须提供共享用户名");
  }
  const existing = readJson(profilePath(), {});
  const profile = {
    ...existing,
    displayName,
    userId: String(input.userId || existing.userId || "").trim(),
    updatedAt: nowIso()
  };
  writeJsonAtomic(profilePath(), profile);
  return getShareProfile();
}

export function getDingTalkMcpConfigStatus(workspacePath) {
  const target = normalizeTarget(resolveShareTargetForConfig(workspacePath));
  const endpoint = resolveMcpEndpoint(target);
  const configPath = resolveUserMcpConfigPath(target);
  const serverName = target.mcp.server_name || target.mcp_server || "钉钉 AI 表格";
  return {
    configured: Boolean(endpoint.endpoint),
    serverName,
    configPath,
    hasEndpoint: Boolean(endpoint.endpoint),
    hasAuthorization: Boolean(endpoint.authorization),
    source: endpoint.source || "none",
    example: {
      mcpServers: {
        [serverName]: {
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer <token>"
          }
        }
      }
    },
    note: "只保存到用户级 MCP 配置，不写入 Skill 包或共享工作区。"
  };
}

export function saveDingTalkMcpConfig(input = {}, workspacePath) {
  const target = normalizeTarget(resolveShareTargetForConfig(workspacePath));
  const configPath = resolveUserMcpConfigPath(target);
  const serverName = target.mcp.server_name || target.mcp_server || "钉钉 AI 表格";
  const payload = parseMcpConfigInput(input);
  const server = payload.mcpServers?.[serverName]
    || payload.mcpServers?.[target.mcp_server]
    || firstServerConfig(payload.mcpServers)
    || payload;
  const normalized = normalizeUserMcpServerConfig(server);
  if (!normalized.url) {
    const error = new Error("钉钉 MCP 配置 JSON 缺少 url/endpoint。");
    error.code = "failed_mcp_config_invalid";
    throw error;
  }

  const existing = readJson(configPath, { mcpServers: {} });
  const next = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers || {}),
      [serverName]: normalized
    },
    updatedAt: nowIso()
  };
  writeJsonAtomic(configPath, next);
  return getDingTalkMcpConfigStatus(workspacePath);
}

export function defaultShareTargetsYaml() {
  return `version: 1
default_target: ${defaultTargetId}
targets:
  - id: ${defaultTargetId}
    type: dingtalk_ai_table_mcp
    enabled: false
    mcp_server: aitable
    base_id: ""
    base_name: "团队 Agent BI 共享库"
    folder_id: ""
    allow_create_base: false
    dry_run: false
    tables:
      metrics: "${managementTables.metrics}"
      datasets: "${managementTables.datasets}"
      audit: "${managementTables.audit}"
    mcp:
      transport: "http"
      server_name: "钉钉 AI 表格"
      config_env: "AGENT_BI_MCP_CONFIG"
      endpoint_env: "DINGTALK_AITABLE_MCP_URL"
      authorization_env: "DINGTALK_AITABLE_MCP_AUTHORIZATION"
    data_policy:
      default_scope: aggregate
      require_confirmation: true
      allow_raw_detail: false
      direct_record_limit: 500
      import_file_limit: 50000
      sensitive_field_patterns:
        - token
        - authorization
        - phone
        - id_card
        - 身份证
        - 手机号
`;
}

export function loadShareTargets(workspacePath) {
  const filePath = path.join(workspacePath, "config", "share-targets.yaml");
  const raw = safeReadText(filePath, "");
  const config = parseShareTargetsYaml(raw);
  return {
    filePath,
    raw,
    configured: Boolean(raw.trim()),
    defaultTarget: config.defaultTarget || defaultTargetId,
    targets: config.targets
  };
}

function parseShareTargetsYaml(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const result = { defaultTarget: "", targets: [] };
  let current = null;
  let section = "";
  let listKey = "";
  for (const line of lines) {
    if (/^default_target:\s*/.test(line)) {
      result.defaultTarget = cleanYamlValue(line.split(/:\s*/).slice(1).join(":"));
      continue;
    }
    const targetMatch = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (targetMatch) {
      current = { id: cleanYamlValue(targetMatch[1]), tables: {}, data_policy: {}, mcp: {} };
      result.targets.push(current);
      section = "";
      listKey = "";
      continue;
    }
    if (!current) {
      continue;
    }
    const sectionMatch = line.match(/^\s{4}([a-zA-Z0-9_]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      listKey = "";
      continue;
    }
    const pair = line.match(/^\s{4}([a-zA-Z0-9_]+):\s*(.*)$/);
    if (pair) {
      current[pair[1]] = coerceYamlValue(pair[2]);
      section = "";
      listKey = "";
      continue;
    }
    const nestedPair = line.match(/^\s{6}([a-zA-Z0-9_]+):\s*(.*)$/);
    if (nestedPair && section) {
      current[section] = current[section] || {};
      const key = nestedPair[1];
      const value = nestedPair[2];
      if (value === "") {
        current[section][key] = [];
        listKey = key;
      } else {
        current[section][key] = coerceYamlValue(value);
        listKey = "";
      }
      continue;
    }
    const nestedList = line.match(/^\s{8}-\s*(.+)$/);
    if (nestedList && section && listKey) {
      current[section][listKey] = current[section][listKey] || [];
      current[section][listKey].push(cleanYamlValue(nestedList[1]));
    }
  }
  return result;
}

function cleanYamlValue(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

function coerceYamlValue(value) {
  const clean = cleanYamlValue(value);
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}

export function sharedMetricsCache(workspacePath) {
  const cachePath = path.join(workspacePath, "knowledge", "shared-metrics", "index.json");
  return readJson(cachePath, {
    version: 1,
    targetId: defaultTargetId,
    baseId: "",
    tableName: managementTables.metrics,
    syncedAt: "",
    status: "not_synced",
    records: [],
    error: ""
  });
}

export function listShareActions(workspacePath) {
  return collectShareActionFiles(workspacePath)
    .map((filePath) => readJson(filePath, null))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function collectShareActionFiles(workspacePath) {
  const files = [];
  const sessionsRoot = path.join(workspacePath, "sessions");
  if (fs.existsSync(sessionsRoot)) {
    for (const year of fs.readdirSync(sessionsRoot)) {
      const yearPath = path.join(sessionsRoot, year);
      if (!fs.statSync(yearPath).isDirectory()) continue;
      for (const month of fs.readdirSync(yearPath)) {
        const monthPath = path.join(yearPath, month);
        if (!fs.statSync(monthPath).isDirectory()) continue;
        for (const sessionId of fs.readdirSync(monthPath)) {
          const shareDir = path.join(monthPath, sessionId, "share-actions");
          if (!fs.existsSync(shareDir)) continue;
          for (const file of fs.readdirSync(shareDir).filter((item) => item.endsWith(".json"))) {
            files.push(path.join(shareDir, file));
          }
        }
      }
    }
  }
  const metricDir = path.join(workspacePath, "metrics", "_share-actions");
  if (fs.existsSync(metricDir)) {
    for (const file of fs.readdirSync(metricDir).filter((item) => item.endsWith(".json"))) {
      files.push(path.join(metricDir, file));
    }
  }
  return files;
}

export function latestShareActionFor(workspacePath, subjectType, subjectId) {
  return listShareActions(workspacePath).find((action) => action.subjectType === subjectType && action.subjectId === subjectId) || null;
}

export function createShareAction(options, workspacePath) {
  const shareType = normalizeShareType(options.shareType || options.type);
  const targetId = options.targetId || loadShareTargets(workspacePath).defaultTarget;
  const subjectType = shareType === "metric" ? "metric" : "session";
  const subjectId = shareType === "metric" ? safeName(options.metricId || options.id, "") : String(options.sessionId || "");
  if (!subjectId) {
    throw new Error(shareType === "metric" ? "必须提供 metricId" : "必须提供 sessionId");
  }
  const running = listShareActions(workspacePath).find((action) =>
    action.subjectType === subjectType &&
    action.subjectId === subjectId &&
    ["confirmed", "running", "pending_import_completion"].includes(action.status)
  );
  if (running) {
    return { action: running, reused: true };
  }
  const sharedBy = resolveSharedBy(options);
  const createdAt = nowIso();
  const shareId = safeName(options.shareId || `share-${shareType}-${createdAt}-${Date.now()}`, "share");
  const filePath = shareActionPath(workspacePath, shareType, subjectId, shareId);
  const action = {
    version: 1,
    shareId,
    shareType,
    subjectType,
    subjectId,
    sessionId: shareType === "dataset" ? subjectId : "",
    metricId: shareType === "metric" ? subjectId : "",
    targetId,
    status: "confirmed",
    dataScope: options.dataScope || "aggregate",
    confirmedBy: options.confirmedBy || sharedBy,
    sharedBy,
    confirmation: {
      confirmedAt: createdAt,
      sensitiveFieldsConfirmed: Boolean(options.sensitiveFieldsConfirmed),
      rawDetailConfirmed: Boolean(options.rawDetailConfirmed)
    },
    attempts: [],
    progress: buildProgress(shareType, "confirmed", 0),
    createdAt,
    updatedAt: createdAt,
    actionPath: path.relative(workspacePath, filePath)
  };
  writeJsonAtomic(filePath, action);
  appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: createdAt, event: "share.created", shareId, shareType, subjectId, targetId });
  return { action, reused: false };
}

function resolveSharedBy(options = {}) {
  const explicit = String(options.sharedBy || options.userName || options.confirmedBy || "").trim();
  if (explicit) return explicit;
  const profile = getShareProfile();
  if (profile.displayName) return profile.displayName;
  const error = new Error("首次使用共享功能前必须指定用户名");
  error.code = "failed_share_profile_required";
  throw error;
}

function normalizeShareType(value) {
  if (["metric", "share_metric"].includes(value)) return "metric";
  return "dataset";
}

function shareActionPath(workspacePath, shareType, subjectId, shareId) {
  if (shareType === "metric") {
    return path.join(workspacePath, "metrics", "_share-actions", `${shareId}.json`);
  }
  const dir = findSessionDir(workspacePath, subjectId);
  if (!dir) {
    throw new Error(`未找到 session：${subjectId}`);
  }
  return path.join(dir, "share-actions", `${shareId}.json`);
}

function getShareActionPath(workspacePath, shareId) {
  return collectShareActionFiles(workspacePath).find((filePath) => path.basename(filePath, ".json") === shareId) || null;
}

export async function executeShareAction(options, workspacePath) {
  const shareId = options.shareId || options["share-id"];
  if (!shareId) {
    throw new Error("必须提供 shareId");
  }
  const actionPath = getShareActionPath(workspacePath, shareId);
  if (!actionPath) {
    throw new Error(`未找到共享任务：${shareId}`);
  }
  let action = readJson(actionPath, null);
  if (!action) {
    throw new Error(`共享任务文件不可读：${shareId}`);
  }
  if (action.status === "completed") {
    return action;
  }
  const attempt = {
    attemptId: `attempt-${Date.now()}`,
    startedAt: nowIso(),
    status: "running"
  };
  action.attempts = [...(action.attempts || []), attempt];
  action = updateAction(actionPath, action, { status: "running", progress: buildProgress(action.shareType, "running", 5, "prepare_payload") });
  try {
    const target = resolveTarget(workspacePath, action.targetId);
    const payload = action.shareType === "metric"
      ? buildMetricSharePayload(workspacePath, action.metricId, target, action)
      : buildDatasetSharePayload(workspacePath, action.sessionId, action.dataScope, target, action);
    action = updateAction(actionPath, action, {
      payloadSummary: payload.summary,
      sensitiveFields: payload.sensitiveFields,
      progress: buildProgress(action.shareType, "running", 18, "resolve_target")
    });
    ensureShareAllowed(target, action, payload);
    const client = createAitableClient(target);
    const baseId = await resolveBase(client, target);
    action = updateAction(actionPath, action, {
      targetBaseId: baseId,
      progress: buildProgress(action.shareType, "running", 35, "ensure_schema")
    });
    const result = action.shareType === "metric"
      ? await writeMetricShare(client, target, baseId, payload, action)
      : await writeDatasetShare(client, target, baseId, payload, actionPath, action);
    action = updateAction(actionPath, action, {
      status: "completed",
      completedAt: nowIso(),
      target: result.target,
      result,
      progress: buildProgress(action.shareType, "completed", 100, "write_audit")
    });
    markAttempt(action, attempt.attemptId, "completed");
    writeJsonAtomic(actionPath, action);
    appendShareAudit(workspacePath, action, result);
    appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: nowIso(), event: "share.completed", shareId, shareType: action.shareType, rowCount: result.rowCount || 0 });
    return action;
  } catch (error) {
    const failedStatus = classifyShareError(error);
    action = updateAction(actionPath, action, {
      status: failedStatus,
      error: error.message,
      updatedAt: nowIso(),
      progress: {
        ...(action.progress || {}),
        status: "failed",
        error: error.message,
        updatedAt: nowIso()
      }
    });
    markAttempt(action, attempt.attemptId, "failed", error.message);
    writeJsonAtomic(actionPath, action);
    appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: nowIso(), event: "share.failed", shareId, status: failedStatus, error: error.message });
    return action;
  }
}

function updateAction(actionPath, action, patch) {
  const next = { ...action, ...patch, updatedAt: nowIso() };
  writeJsonAtomic(actionPath, next);
  return next;
}

function markAttempt(action, attemptId, status, error = "") {
  const attempt = (action.attempts || []).find((item) => item.attemptId === attemptId);
  if (attempt) {
    attempt.status = status;
    attempt.completedAt = nowIso();
    if (error) attempt.error = error;
  }
}

function classifyShareError(error) {
  if (error.code) return error.code;
  if (/未配置|disabled|目标/.test(error.message)) return "failed_target_not_configured";
  if (/MCP|endpoint|不可用/.test(error.message)) return "failed_mcp_unavailable";
  if (/Base|base/.test(error.message)) return "failed_target_not_found";
  if (/表|字段|schema|field|table/.test(error.message)) return "failed_schema_setup";
  return "failed";
}

function resolveTarget(workspacePath, targetId) {
  const config = loadShareTargets(workspacePath);
  const target = config.targets.find((item) => item.id === targetId) || config.targets.find((item) => item.id === config.defaultTarget);
  if (!target) {
    const error = new Error("未配置共享目标 config/share-targets.yaml");
    error.code = "failed_target_not_configured";
    throw error;
  }
  if (!target.enabled) {
    const error = new Error(`共享目标未启用：${target.id}`);
    error.code = "failed_target_not_configured";
    throw error;
  }
  return normalizeTarget(target);
}

function resolveShareTargetForConfig(workspacePath) {
  const config = loadShareTargets(workspacePath);
  return config.targets.find((item) => item.id === config.defaultTarget) || config.targets[0] || {
    id: defaultTargetId,
    mcp_server: "aitable",
    mcp: {
      server_name: "钉钉 AI 表格",
      config_env: "AGENT_BI_MCP_CONFIG",
      endpoint_env: "DINGTALK_AITABLE_MCP_URL",
      authorization_env: "DINGTALK_AITABLE_MCP_AUTHORIZATION"
    }
  };
}

function parseMcpConfigInput(input = {}) {
  if (typeof input === "string") {
    return JSON.parse(input);
  }
  if (typeof input.json === "string") {
    return JSON.parse(input.json);
  }
  if (typeof input.configJson === "string") {
    return JSON.parse(input.configJson);
  }
  if (input.config && typeof input.config === "object") {
    return input.config;
  }
  return input;
}

function firstServerConfig(mcpServers = {}) {
  if (!mcpServers || typeof mcpServers !== "object") {
    return null;
  }
  const firstKey = Object.keys(mcpServers)[0];
  return firstKey ? mcpServers[firstKey] : null;
}

function normalizeUserMcpServerConfig(server = {}) {
  const url = String(server.url || server.endpoint || "").trim();
  const headers = { ...(server.headers || server.http_headers || {}) };
  const authorization = server.authorization || server.Authorization || headers.Authorization || headers.authorization || "";
  if (authorization && !headers.Authorization && !headers.authorization) {
    headers.Authorization = authorization;
  }
  return {
    ...server,
    url,
    headers
  };
}

function normalizeTarget(target) {
  return {
    ...target,
    tables: { ...managementTables, ...(target.tables || {}) },
    data_policy: {
      default_scope: "aggregate",
      require_confirmation: true,
      allow_raw_detail: false,
      direct_record_limit: 500,
      import_file_limit: 50000,
      sensitive_field_patterns: ["token", "authorization", "phone", "id_card", "身份证", "手机号"],
      ...(target.data_policy || {})
    },
    mcp: {
      transport: "http",
      server_name: target.mcp_server || "钉钉 AI 表格",
      config_env: "AGENT_BI_MCP_CONFIG",
      endpoint_env: "DINGTALK_AITABLE_MCP_URL",
      authorization_env: "DINGTALK_AITABLE_MCP_AUTHORIZATION",
      ...(target.mcp || {})
    }
  };
}

function ensureShareAllowed(target, action, payload) {
  if (payload.sensitiveFields.length && !action.confirmation?.sensitiveFieldsConfirmed) {
    const error = new Error(`命中敏感字段，需二次确认：${payload.sensitiveFields.join(", ")}`);
    error.code = "failed_sensitive_confirmation_required";
    throw error;
  }
  if (action.dataScope === "raw" && !target.data_policy.allow_raw_detail && !action.confirmation?.rawDetailConfirmed) {
    const error = new Error("共享原始明细未启用或未确认");
    error.code = "failed_raw_detail_not_allowed";
    throw error;
  }
}

function buildProgress(kind, status, percent, currentStep = "") {
  const steps = progressSteps[kind] || progressSteps.dataset;
  const currentIndex = steps.findIndex(([id]) => id === currentStep);
  return {
    status,
    percent,
    currentStep,
    steps: steps.map(([id, label], index) => ({
      id,
      label,
      status: status === "completed" ? "completed" : currentIndex < 0 ? "pending" : index < currentIndex ? "completed" : index === currentIndex ? "running" : "pending"
    })),
    updatedAt: nowIso()
  };
}

function buildDatasetSharePayload(workspacePath, sessionId, dataScope = "aggregate", target = null, action = {}) {
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) throw new Error(`未找到 session：${sessionId}`);
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const confirmation = readJson(path.join(dir, "confirmation.json"), {});
  const aggregate = readJson(path.join(dir, "result.aggregate.json"), { columns: [], rows: [] });
  const preview = readJson(path.join(dir, "result.preview.json"), { columns: [], rows: [] });
  const queryPlan = readJson(path.join(dir, "query-plan.json"), null);
  const actualSql = extractActualSqlFromSession(dir);
  const rowsSource = dataScope === "preview" && preview.rows?.length ? preview : aggregate;
  const columns = rowsSource.columns || [];
  const rows = rowsSource.rows || [];
  const sensitiveFields = detectSensitiveFields(columns, target?.data_policy?.sensitive_field_patterns || []);
  const datasetId = safeName(`dataset-${sessionId}-${Date.now()}`, "dataset");
  return {
    kind: "dataset",
    datasetId,
    sessionId,
    title: metadata.question || confirmation.question || sessionId,
    columns,
    rows,
    sensitiveFields,
    summary: {
      title: metadata.question || confirmation.question || sessionId,
      rowCount: rows.length,
      columns,
      dataScope,
      sourceStatement: sourceStatement(metadata, confirmation)
    },
    directoryRecord: {
      dataset_id: datasetId,
      session_id: sessionId,
      title: metadata.question || confirmation.question || sessionId,
      metric_definition: confirmation.metricDefinition || confirmation.calculationLogic || safeReadText(path.join(dir, "metric-plan.yaml")).slice(0, 2000),
      data_scope: dataScope,
      row_count: rows.length,
      columns: columns.join(", "),
      target_table_name: datasetId,
      target_table_id: "",
      source_statement: sourceStatement(metadata, confirmation),
      actual_sql: actualSql,
      sensitivity_level: sensitiveFields.length ? "sensitive_confirmed" : "normal",
      shared_by: action.sharedBy || action.confirmedBy || getShareProfile().displayName || "",
      shared_at: nowIso(),
      local_session_path: path.relative(workspacePath, dir)
    },
    auditContext: {
      queryPlan: queryPlan || safeReadText(path.join(dir, "query-plan.sql")).slice(0, 2000),
      audit: safeReadText(path.join(dir, "audit.md")).slice(0, 2000)
    },
    workspacePath,
    sessionDir: dir
  };
}

function sourceStatement(metadata, confirmation) {
  return confirmation.sourceStatement || metadata.sourceStatement || `来源 provider：${confirmation.providerId || metadata.providerId || "unknown"}；共享前请确认指标口径和数据范围。`;
}

function collectRelatedMetricSessions(workspacePath, metric) {
  const metricId = metric.id || "";
  const needleValues = [metricId, metric.name].filter(Boolean);
  if (!needleValues.length) return [];
  const explicitSessionIds = [...metric.raw.matchAll(/session\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[A-Za-z0-9._-]+)/g)]
    .map((match) => match[1]);
  return listSessionIds(workspacePath)
    .map((sessionId) => {
      const dir = findSessionDir(workspacePath, sessionId);
      if (!dir) return null;
      const metadata = readJson(path.join(dir, "metadata.json"), {});
      const aggregate = safeReadText(path.join(dir, "result.aggregate.json"));
      const haystack = [
        safeReadText(path.join(dir, "metric-plan.yaml")),
        safeReadText(path.join(dir, "confirmation.json")),
        safeReadText(path.join(dir, "metadata.json")),
        aggregate
      ].join("\n");
      if (!explicitSessionIds.includes(sessionId) && !needleValues.some((needle) => haystack.includes(needle))) {
        return null;
      }
      return {
        sessionId,
        title: metadata.question || metadata.title || "",
        path: path.relative(workspacePath, dir),
        actualSql: extractActualSqlFromSession(dir)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function extractActualSqlFromSession(dir) {
  const sqlText = safeReadText(path.join(dir, "query-plan.sql"), "").trim();
  if (sqlText) return sqlText;
  const queryPlan = readJson(path.join(dir, "query-plan.json"), null);
  if (!queryPlan) return "";
  const actual = queryPlan.actualExecution || queryPlan.actual_execution || queryPlan.execution || queryPlan;
  const candidates = [];
  collectSqlLikeValues(actual, candidates);
  const sqlCandidates = candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter(isSqlLikeText);
  if (sqlCandidates.length) {
    return sqlCandidates.join("\n\n---\n\n");
  }
  if (queryPlan.actualExecution || queryPlan.actual_execution) {
    return JSON.stringify(queryPlan.actualExecution || queryPlan.actual_execution, null, 2);
  }
  return "";
}

function isSqlLikeText(value) {
  const text = String(value || "").trim();
  return /^\s*(with|select|show|describe)\b/i.test(text) || /\bfrom\b|\bwhere\b|\bgroup\s+by\b|\border\s+by\b/i.test(text);
}

function collectSqlLikeValues(value, out, keyName = "") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/sqlFile/i.test(keyName) && fs.existsSync(value)) {
      out.push(safeReadText(value));
      return;
    }
    if (/sql|query|script|statement/i.test(keyName) || isSqlLikeText(value)) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSqlLikeValues(item, out, keyName);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectSqlLikeValues(child, out, key);
    }
  }
}

function buildMetricSharePayload(workspacePath, metricId, target = null, action = {}) {
  const metricPath = path.join(workspacePath, "metrics", `${safeName(metricId, "")}.yaml`);
  const raw = safeReadText(metricPath, "");
  if (!raw) throw new Error(`未找到指标：${metricId}`);
  const metric = parseLocalMetricYaml(raw);
  const relatedSessions = collectRelatedMetricSessions(workspacePath, metric);
  const actualSql = metric.actual_sql || relatedSessions
    .filter((session) => session.actualSql)
    .map((session) => `## ${session.sessionId}\n\n${session.actualSql}`)
    .join("\n\n---\n\n");
  const sensitiveFields = detectSensitiveFields([metric.time_field, ...(metric.dimensions || []), ...(metric.source_tables || [])], target?.data_policy?.sensitive_field_patterns || []);
  return {
    kind: "metric",
    metricId: metric.id,
    metric,
    sensitiveFields,
    summary: {
      title: metric.name || metric.id,
      rowCount: 1,
      columns: Object.keys(metric),
      status: metric.status
    },
    record: {
      metric_id: metric.id,
      name: metric.name || metric.id,
      status: metric.status || "draft",
      version: Number(metric.version || 1),
      definition: metric.definition || metric.description || "",
      grain: metric.grain || "",
      time_field: metric.time_field || "",
      dimensions: (metric.dimensions || []).join(", "),
      source_tables: (metric.source_tables || []).join(", "),
      field_meanings: "",
      related_sessions: relatedSessions.map((session) => [session.sessionId, session.title].filter(Boolean).join(" · ")).join("\n"),
      actual_sql: actualSql,
      shared_by: action.sharedBy || action.confirmedBy || getShareProfile().displayName || "",
      shared_at: nowIso(),
      local_metric_path: path.relative(workspacePath, metricPath),
      source_workspace: workspacePath,
      source_agent: "agent-bi",
      share_status: "active",
      last_updated_at: nowIso()
    }
  };
}

function parseLocalMetricYaml(raw) {
  const scalar = (key) => raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
  return {
    id: scalar("id"),
    name: scalar("name"),
    status: scalar("status"),
    version: scalar("version") || 1,
    description: scalar("description"),
    definition: scalar("definition"),
    grain: scalar("grain"),
    time_field: raw.match(/time_field:\s*\n\s+field:\s*(.+)/)?.[1]?.trim()?.replace(/^"|"$/g, "") || "",
    dimensions: parseYamlList(raw, "dimensions"),
    source_tables: parseYamlList(raw, "source_tables"),
    actual_sql: parseYamlBlock(raw, "actual_sql"),
    raw
  };
}

function parseYamlBlock(raw, key) {
  const lines = raw.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}:`));
  if (index < 0) return "";
  const line = lines[index].trim();
  const inline = line.match(new RegExp(`^${key}:\\s*(.+)$`))?.[1]?.trim() || "";
  if (inline && inline !== "|") {
    return inline.replace(/^["']|["']$/g, "");
  }
  const baseIndent = lines[index].match(/^\s*/)?.[0].length || 0;
  const block = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const child = lines[cursor];
    if (!child.trim()) {
      block.push("");
      continue;
    }
    const indent = child.match(/^\s*/)?.[0].length || 0;
    if (indent <= baseIndent) break;
    block.push(child.slice(Math.min(indent, baseIndent + 2)));
  }
  return block.join("\n").trim();
}

function parseYamlList(raw, key) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const values = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) break;
    const item = line.match(/^\s*-\s*(.+)$/)?.[1];
    if (item) values.push(item.replace(/^table:\s*/, "").trim().replace(/^"|"$/g, ""));
  }
  return values;
}

function detectSensitiveFields(columns, extraPatterns = []) {
  const patterns = ["token", "authorization", "phone", "mobile", "id_card", "身份证", "手机号", ...extraPatterns].map((item) => new RegExp(item, "i"));
  return (columns || []).filter((column) => patterns.some((pattern) => pattern.test(String(column))));
}

function createAitableClient(target) {
  if (target.dry_run) {
    return new DryRunAitableClient(target);
  }
  const endpointConfig = resolveMcpEndpoint(target);
  const endpoint = endpointConfig.endpoint;
  if (!endpoint) {
    const error = new Error(`钉钉 AI 表格 MCP endpoint 不可用。请配置 ${target.mcp.endpoint_env || "DINGTALK_AITABLE_MCP_URL"}，或在用户级 MCP 配置中登记 ${target.mcp.server_name || target.mcp_server || "钉钉 AI 表格"}。`);
    error.code = "failed_mcp_unavailable";
    throw error;
  }
  return new HttpMcpAitableClient(endpoint, endpointConfig.authorization || "");
}

function resolveMcpEndpoint(target) {
  const endpointEnv = target.mcp.endpoint_env || "DINGTALK_AITABLE_MCP_URL";
  const authorizationEnv = target.mcp.authorization_env || "DINGTALK_AITABLE_MCP_AUTHORIZATION";
  const envEndpoint = target.mcp.endpoint || process.env[endpointEnv];
  if (envEndpoint) {
    return { endpoint: envEndpoint, authorization: process.env[authorizationEnv] || "", source: "env" };
  }
  const config = readUserMcpConfig(target);
  const serverName = target.mcp.server_name || target.mcp_server || "钉钉 AI 表格";
  const server = config.mcpServers?.[serverName] || config.mcpServers?.[target.mcp_server] || null;
  if (!server?.url) {
    return { endpoint: "", authorization: "", source: "none" };
  }
  const headers = server.headers || {};
  return {
    endpoint: server.url,
    authorization: headers.authorization || headers.Authorization || server.authorization || "",
    source: "user_config"
  };
}

function readUserMcpConfig(target) {
  return readJson(resolveUserMcpConfigPath(target), { mcpServers: {} });
}

function resolveUserMcpConfigPath(target) {
  const configPath = target.mcp.config_path
    || process.env[target.mcp.config_env || "AGENT_BI_MCP_CONFIG"]
    || path.join(process.env.HOME || "", ".agent-bi", "mcp-servers.json");
  return configPath;
}

class DryRunAitableClient {
  constructor(target) {
    this.target = target;
    this.tables = new Map();
  }
  async callTool(tool, args = {}) {
    if (tool === "search_bases" || tool === "list_bases") {
      return { bases: [{ baseId: this.target.base_id || "dry_base_id", name: this.target.base_name || "dry base" }] };
    }
    if (tool === "get_tables") {
      return { tables: [...this.tables.values()] };
    }
    if (tool === "create_table") {
      const tableId = `tbl_${safeName(args.tableName, "table")}`;
      const fields = (args.fields || []).map((field) => ({ fieldId: `fld_${safeName(field.fieldName, "field")}`, fieldName: field.fieldName, type: field.type }));
      const table = { tableId, tableName: args.tableName, fields };
      this.tables.set(args.tableName, table);
      return table;
    }
    if (tool === "create_fields") {
      return { fields: (args.fields || []).map((field) => ({ fieldId: `fld_${safeName(field.fieldName, "field")}`, fieldName: field.fieldName, type: field.type })) };
    }
    if (tool === "create_records") {
      return { records: (args.records || []).map((_, index) => ({ recordId: `rec_${Date.now()}_${index}` })) };
    }
    if (tool === "update_records") {
      return { updated: (args.records || []).length };
    }
  if (tool === "query_records") {
      return { records: [], cursor: "" };
    }
    if (tool === "prepare_import_upload") {
      return { importId: `import_${Date.now()}`, uploadUrl: "" };
    }
    if (tool === "import_data") {
      return { imported: true, tableId: args.tableId || `tbl_import_${Date.now()}` };
    }
    return {};
  }
}

class HttpMcpAitableClient {
  constructor(endpoint, authorization) {
    this.endpoint = endpoint;
    this.authorization = authorization;
    this.nextId = 1;
  }
  async callTool(tool, args = {}) {
    const headers = { "content-type": "application/json", "accept": "application/json, text/event-stream" };
    if (this.authorization) headers.authorization = this.authorization;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId++,
        method: "tools/call",
        params: { name: tool, arguments: args }
      })
    });
    const payload = await parseMcpHttpResponse(response);
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || payload.message || `MCP 工具调用失败：${tool}`);
    }
    return normalizeMcpResult(payload.result || payload);
  }
}

async function parseMcpHttpResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  const text = await response.text().catch(() => "");
  const dataLine = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter(Boolean)
    .at(-1);
  if (dataLine) {
    try {
      return JSON.parse(dataLine);
    } catch {
      return { text };
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function normalizeMcpResult(result) {
  if (result?.structuredContent) return result.structuredContent;
  if (result?.data) return result.data;
  const text = result?.content?.find?.((item) => item.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result || {};
}

async function resolveBase(client, target) {
  if (target.base_id) return target.base_id;
  const data = await client.callTool("search_bases", { keyword: target.base_name || "" }).catch(() => client.callTool("list_bases", {}));
  const body = payloadData(data);
  const bases = normalizeArray(body.bases || body.items || body.records || body);
  const matched = bases.filter((base) => (base.name || base.baseName || base.title) === target.base_name);
  if (matched.length === 1) return matched[0].baseId || matched[0].id;
  if (bases.length === 1) return bases[0].baseId || bases[0].id;
  const error = new Error(matched.length > 1 ? `目标 Base 名称重复，请配置 base_id：${target.base_name}` : `未找到目标 Base：${target.base_name}`);
  error.code = "failed_target_not_found";
  throw error;
}

async function ensureTable(client, baseId, tableName, fieldPairs) {
  const existing = await findTable(client, baseId, tableName);
  let table = existing?.table || null;
  let tableBody = existing?.tableBody || {};
  if (!table) {
    const initialFields = fieldPairs.slice(0, 15);
    table = await client.callTool("create_table", {
      baseId,
      tableName,
      fields: initialFields.map(([fieldName, type]) => fieldSpec(displayFieldName(fieldName), type))
    });
    table = tableRecord(table);
    tableBody = {};
  }
  const tableId = table.tableId || table.id;
  let fields = normalizeArray(table.fields || table.fieldList || table.columns || tableBody.fields || []);
  if (!fields.length && tableId) {
    const detailData = await client.callTool("get_tables", { baseId, tableIds: [tableId] }).catch(() => null);
    const detailBody = payloadData(detailData);
    const detailTable = normalizeArray(detailBody.tables || detailBody.items || detailBody.records || detailBody)
      .find((item) => (item.tableId || item.id) === tableId) || {};
    fields = normalizeArray(detailTable.fields || detailTable.fieldList || detailTable.columns || detailBody.fields || []);
  }
  const fieldMap = buildFieldMap(fields);
  if (tableId) {
    await renameLegacyFields(client, baseId, tableId, fields, fieldPairs, fieldMap);
  }
  const missing = fieldPairs.filter(([fieldName]) => !fieldMap[fieldName] && !fieldMap[displayFieldName(fieldName)]);
  if (missing.length && tableId) {
    for (const batch of chunk(missing, 15)) {
      const created = await client.callTool("create_fields", {
        baseId,
        tableId,
        fields: batch.map(([fieldName, type]) => fieldSpec(displayFieldName(fieldName), type))
      }).catch(() => ({ fields: [] }));
      const createdBody = payloadData(created);
      for (const field of normalizeArray(createdBody.fields || createdBody.items || createdBody.records || createdBody)) {
        addFieldMapEntry(fieldMap, field.fieldName || field.name, field.fieldId || field.id);
      }
    }
  }
  if (!tableId) {
    const error = new Error(`无法获取表 ID：${tableName}`);
    error.code = "failed_schema_setup";
    throw error;
  }
  return { tableId, tableName: table.tableName || table.name || tableName, fieldMap };
}

function displayFieldName(fieldName) {
  return fieldLabels[fieldName] || fieldName;
}

function buildFieldMap(fields) {
  const fieldMap = {};
  for (const field of normalizeArray(fields)) {
    addFieldMapEntry(fieldMap, field.fieldName || field.name, field.fieldId || field.id);
  }
  return fieldMap;
}

function addFieldMapEntry(fieldMap, fieldName, fieldId) {
  if (!fieldName || !fieldId) return;
  fieldMap[fieldName] = fieldId;
  const internal = Object.entries(fieldLabels).find(([, label]) => label === fieldName)?.[0];
  if (internal) fieldMap[internal] = fieldId;
  const label = fieldLabels[fieldName];
  if (label) fieldMap[label] = fieldId;
}

async function renameLegacyFields(client, baseId, tableId, fields, fieldPairs, fieldMap) {
  const byName = Object.fromEntries(normalizeArray(fields).map((field) => [field.fieldName || field.name, field]));
  for (const [fieldName] of fieldPairs) {
    const label = displayFieldName(fieldName);
    if (label === fieldName || byName[label] || !byName[fieldName]) continue;
    const fieldId = byName[fieldName].fieldId || byName[fieldName].id || fieldMap[fieldName];
    if (!fieldId) continue;
    assertMcpSuccess(await client.callTool("update_field", {
      baseId,
      tableId,
      fieldId,
      newFieldName: label
    }), "update_field");
    fieldMap[label] = fieldId;
    fieldMap[fieldName] = fieldId;
  }
}

async function findTable(client, baseId, tableName) {
  const tableData = await client.callTool("get_tables", { baseId });
  const tableBody = payloadData(tableData);
  const tables = normalizeArray(tableBody.tables || tableBody.items || tableBody.records || tableBody);
  const table = tables.find((item) => (item.tableName || item.name) === tableName) || null;
  const tableId = table?.tableId || table?.id;
  if (!tableId) {
    return { table, tableBody };
  }
  const detailData = await client.callTool("get_tables", { baseId, tableIds: [tableId] }).catch(() => null);
  const detailBody = payloadData(detailData);
  const detailTable = normalizeArray(detailBody.tables || detailBody.items || detailBody.records || detailBody)
    .find((item) => (item.tableId || item.id) === tableId) || table;
  return { table: detailTable, tableBody: detailBody };
}

function fieldSpec(fieldName, type) {
  const spec = { fieldName, type };
  if (type === "singleSelect") {
    spec.config = { options: ["active", "draft", "reviewed", "validated", "deprecated", "completed", "failed", "normal", "aggregate", "preview", "sensitive_confirmed"].map((name) => ({ name })) };
  }
  if (type === "number") {
    spec.config = { formatter: "FLOAT_2" };
  }
  if (type === "date") {
    spec.config = { formatter: "YYYY-MM-DD HH:mm:ss" };
  }
  return spec;
}

function tableRecord(value) {
  const body = payloadData(value);
  if (body.table) return body.table;
  if (Array.isArray(body.tables) && body.tables.length) return body.tables[0];
  if (Array.isArray(body.records) && body.records.length) return body.records[0];
  return body;
}

async function writeMetricShare(client, target, baseId, payload, action) {
  const table = await ensureTable(client, baseId, target.tables.metrics, managementFields.metrics);
  const record = recordByFieldMap(table.fieldMap, payload.record);
  const existingRecords = await queryAllRecords(client, baseId, table.tableId, table.fieldMap).catch(() => []);
  const existing = existingRecords.find((item) => item.id === payload.metricId);
  if (existing?.recordId) {
    assertMcpSuccess(await client.callTool("update_records", { baseId, tableId: table.tableId, records: [{ recordId: existing.recordId, cells: record }] }), "update_records");
  } else {
    assertMcpSuccess(await client.callTool("create_records", { baseId, tableId: table.tableId, records: [{ cells: record }] }), "create_records");
  }
  return {
    target: { targetId: action.targetId, baseId, tableId: table.tableId, tableName: table.tableName },
    rowCount: 1,
    operation: existing?.recordId ? "update" : "create",
    toolCalls: ["get_tables", "create_table/create_fields", "query_records", existing?.recordId ? "update_records" : "create_records"]
  };
}

async function writeDatasetShare(client, target, baseId, payload, actionPath, action) {
  const detailFields = payload.columns.map((column) => [column, inferAitableType(payload.rows, column)]);
  const detailTableName = payload.datasetId;
  const directLimit = Number(target.data_policy.direct_record_limit || 500);
  const detailTable = await ensureTable(client, baseId, detailTableName, detailFields);
  let targetTableId = detailTable.tableId;
  if (payload.rows.length <= directLimit) {
    const batches = chunk(payload.rows, 100);
    let written = 0;
    for (const batch of batches) {
      await client.callTool("create_records", {
        baseId,
        tableId: detailTable.tableId,
        records: batch.map((row) => ({ cells: recordByFieldMap(detailTable.fieldMap, row) }))
      }).then((result) => assertMcpSuccess(result, "create_records"));
      written += batch.length;
      const current = readJson(actionPath, action);
      writeJsonAtomic(actionPath, {
        ...current,
        writtenRows: written,
        progress: buildProgress("dataset", "running", Math.min(88, 50 + Math.round((written / Math.max(payload.rows.length, 1)) * 38)), "write_records"),
        updatedAt: nowIso()
      });
    }
  } else {
    const csvPath = writeDatasetCsv(payload, payload.workspacePath || "");
    const upload = await client.callTool("prepare_import_upload", { baseId, fileName: path.basename(csvPath), fileSize: fs.statSync(csvPath).size });
    if (upload.uploadUrl) {
      await fetch(upload.uploadUrl, { method: "PUT", body: fs.readFileSync(csvPath) });
    }
    const imported = await client.callTool("import_data", { importId: upload.importId, tableId: detailTable.tableId, timeout: 30 });
    targetTableId = imported.tableId || detailTable.tableId;
  }
  const directoryTable = await ensureTable(client, baseId, target.tables.datasets, managementFields.datasets);
  payload.directoryRecord.target_table_id = targetTableId;
  assertMcpSuccess(await client.callTool("create_records", { baseId, tableId: directoryTable.tableId, records: [{ cells: recordByFieldMap(directoryTable.fieldMap, payload.directoryRecord) }] }), "create_records");
  return {
    target: { targetId: action.targetId, baseId, tableId: targetTableId, tableName: detailTableName },
    rowCount: payload.rows.length,
    toolCalls: ["get_tables", "create_table/create_fields", payload.rows.length <= directLimit ? "create_records" : "prepare_import_upload/import_data"]
  };
}

function recordByFieldMap(fieldMap, record) {
  const cells = {};
  for (const [fieldName, value] of Object.entries(record)) {
    const fieldId = fieldMap[fieldName] || fieldMap[displayFieldName(fieldName)] || `fld_${safeName(fieldName, "field")}`;
    cells[fieldId] = normalizeCellValue(fieldName, value);
  }
  return cells;
}

function normalizeCellValue(fieldName, value) {
  if (value === null || value === undefined) return "";
  if (richTextFieldNames.has(fieldName)) {
    return { markdown: Array.isArray(value) || typeof value === "object" ? JSON.stringify(value, null, 2) : String(value) };
  }
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}

const richTextFieldNames = new Set([
  "definition",
  "dimensions",
  "source_tables",
  "field_meanings",
  "related_sessions",
  "actual_sql",
  "columns",
  "metric_definition",
  "source_statement",
  "mcp_tools",
  "error_message"
]);

function inferAitableType(rows, column) {
  if (rows.some((row) => Number.isFinite(Number(row[column])) && row[column] !== "")) return "number";
  if (rows.some((row) => /^\d{4}-\d{2}-\d{2}/.test(String(row[column] || "")))) return "date";
  return "text";
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function assertMcpSuccess(result, tool) {
  if (result?.isError || result?.success === false || result?.status === "error" || nonEmptyObject(result?.error)) {
    const message = result?.error?.message || result?.summary || result?.message || `${tool} 调用失败`;
    const error = new Error(message);
    error.code = "failed_mcp_business_error";
    throw error;
  }
  return result;
}

function nonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function chunk(rows, size) {
  const batches = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

function writeDatasetCsv(payload, workspacePath = "") {
  const tmpDir = path.join(workspacePath || process.cwd(), "tmp");
  mkdirp(tmpDir);
  const csvPath = path.join(tmpDir, `${payload.datasetId}.csv`);
  const csv = [
    payload.columns.map(csvCell).join(","),
    ...payload.rows.map((row) => payload.columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
  writeText(csvPath, `\uFEFF${csv}\n`);
  return csvPath;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function appendShareAudit(workspacePath, action, result) {
  if (action.shareType === "dataset" && action.sessionId) {
    const dir = findSessionDir(workspacePath, action.sessionId);
    if (dir) {
      appendText(path.join(dir, "audit.md"), `\n## 团队共享\n\n- 共享时间：${action.completedAt || nowIso()}\n- Share ID：${action.shareId}\n- 目标：${result.target?.baseId || ""} / ${result.target?.tableName || ""}\n- 行数：${result.rowCount || 0}\n- 状态：${action.status}\n`);
      const metadata = readJson(path.join(dir, "metadata.json"), { sessionId: action.sessionId });
      metadata.sharedAt = action.completedAt || nowIso();
      metadata.shareId = action.shareId;
      metadata.updatedAt = nowIso();
      writeJson(path.join(dir, "metadata.json"), metadata);
    }
  }
  if (action.shareType === "metric" && action.metricId) {
    appendJsonl(path.join(workspacePath, "metrics", "_shares", `${action.metricId}.jsonl`), {
      shareId: action.shareId,
      status: action.status,
      target: result.target,
      sharedAt: action.completedAt || nowIso()
    });
  }
}

export async function syncSharedMetrics(options, workspacePath) {
  const target = resolveTarget(workspacePath, options.targetId || loadShareTargets(workspacePath).defaultTarget);
  const cachePath = path.join(workspacePath, "knowledge", "shared-metrics", "index.json");
  const action = {
    shareId: `sync-shared-metrics-${Date.now()}`,
    shareType: "sync_metrics",
    status: "running",
    progress: buildProgress("sync_metrics", "running", 10, "resolve_target"),
    createdAt: nowIso()
  };
  try {
    const client = createAitableClient(target);
    const baseId = await resolveBase(client, target);
    action.progress = buildProgress("sync_metrics", "running", 45, "read_schema");
    const existing = await findTable(client, baseId, target.tables.metrics);
    if (!existing.table) {
      const payload = {
        version: 1,
        targetId: target.id,
        baseId,
        tableName: target.tables.metrics,
        tableId: "",
        syncedAt: nowIso(),
        status: "missing_table",
        records: [],
        error: `共享指标表不存在：${target.tables.metrics}`
      };
      writeJsonAtomic(cachePath, payload);
      appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: nowIso(), event: "shared_metrics.missing_table", targetId: target.id, tableName: target.tables.metrics });
      return payload;
    }
    const table = {
      tableId: existing.table.tableId || existing.table.id,
      tableName: existing.table.tableName || existing.table.name || target.tables.metrics,
      fieldMap: buildFieldMap(existing.table.fields || existing.table.fieldList || existing.table.columns || [])
    };
    action.progress = buildProgress("sync_metrics", "running", 72, "query_records");
    const records = (await queryAllRecords(client, baseId, table.tableId, table.fieldMap))
      .map((record) => enrichSharedMetricDisplayName(workspacePath, record));
    const payload = {
      version: 1,
      targetId: target.id,
      baseId,
      tableName: table.tableName,
      tableId: table.tableId,
      syncedAt: nowIso(),
      status: "ok",
      records
    };
    writeJsonAtomic(cachePath, payload);
    appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: nowIso(), event: "shared_metrics.synced", count: records.length, targetId: target.id });
    return payload;
  } catch (error) {
    const previous = sharedMetricsCache(workspacePath);
    const payload = { ...previous, status: "failed", error: error.message, syncedAt: previous.syncedAt || "" };
    writeJsonAtomic(cachePath, payload);
    appendJsonl(path.join(workspacePath, "logs", "share-runs.jsonl"), { ts: nowIso(), event: "shared_metrics.sync_failed", error: error.message });
    return payload;
  }
}

async function queryAllRecords(client, baseId, tableId, fieldMap) {
  const out = [];
  let cursor = "";
  do {
    const data = await client.callTool("query_records", { baseId, tableId, limit: 100, cursor: cursor || undefined });
    assertMcpSuccess(data, "query_records");
    const body = payloadData(data);
    const rows = normalizeArray(body.records || body.items || body.rows || []);
    for (const row of rows) {
      out.push(normalizeSharedMetricRecord(row, fieldMap));
    }
    cursor = body.cursor || body.nextCursor || data.cursor || data.nextCursor || "";
  } while (cursor);
  return out;
}

function payloadData(value) {
  if (value?.data && typeof value.data === "object") return value.data;
  if (value?.result && typeof value.result === "object") return value.result;
  return value || {};
}

function normalizeSharedMetricRecord(row, fieldMap) {
  const cells = row.cells || row.fields || row;
  const byName = {};
  for (const [fieldName, fieldId] of Object.entries(fieldMap)) {
    byName[fieldName] = cells[fieldId] ?? cells[fieldName] ?? "";
  }
  return {
    recordId: row.recordId || row.id || "",
    id: byName.metric_id || byName.metricId || "",
    name: byName.name || byName.metric_id || "",
    status: selectName(byName.status) || "shared",
    shareStatus: selectName(byName.share_status) || "",
    version: byName.version || "",
    definition: richTextValue(byName.definition),
    grain: byName.grain || "",
    timeField: byName.time_field || "",
    dimensions: splitList(byName.dimensions),
    sourceTables: splitList(byName.source_tables),
    fieldMeanings: richTextValue(byName.field_meanings),
    relatedSessions: splitList(byName.related_sessions),
    actualSql: richTextValue(byName.actual_sql),
    sharedBy: byName.shared_by || "",
    sharedAt: byName.shared_at || "",
    sourceWorkspace: byName.source_workspace || "",
    sourceAgent: byName.source_agent || "",
    raw: byName
  };
}

function enrichSharedMetricDisplayName(workspacePath, record) {
  if (!record?.id || hasCjk(record.name)) {
    return record;
  }
  const metricPath = path.join(workspacePath, "metrics", `${safeName(record.id, "")}.yaml`);
  const raw = safeReadText(metricPath, "");
  if (!raw) {
    return record;
  }
  const local = parseLocalMetricYaml(raw);
  return hasCjk(local.name) ? { ...record, name: local.name } : record;
}

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function richTextValue(value) {
  if (value?.markdown) return value.markdown;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value || "");
}

function selectName(value) {
  if (value?.name) return value.name;
  if (Array.isArray(value)) return value.map(selectName).filter(Boolean).join(", ");
  return String(value || "");
}

function splitList(value) {
  if (value?.markdown) return splitList(value.markdown);
  if (Array.isArray(value)) return value;
  return String(value || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

export function copySharedMetricToLocal(options, workspacePath, saveMetricDefinition) {
  const metricId = options.metricId || options.id;
  const cache = sharedMetricsCache(workspacePath);
  const metric = cache.records.find((item) => item.id === metricId || item.recordId === metricId);
  if (!metric) {
    throw new Error(`共享指标不存在或尚未同步：${metricId}`);
  }
  const localId = safeName(options.localMetricId || metric.id, "shared_metric");
  const result = saveMetricDefinition({
    id: localId,
    name: metric.name || localId,
    status: "draft",
    version: 1,
    description: metric.definition || "从共享指标库复制到本地。",
    definition: metric.definition || "从共享指标库复制到本地，使用前请在 Agent 对话中确认口径。",
    grain: metric.grain || "unknown",
    timeField: metric.timeField || "unknown",
    timeDescription: "来自共享指标库，复制后需按本地查询场景确认。",
    dimensions: metric.dimensions || [],
    source_tables: (metric.sourceTables || []).map((table) => ({ table, role: "共享指标来源" })),
    actualSql: metric.actualSql || "",
    notes: [
      `从共享指标库复制：${metric.id}`,
      metric.recordId ? `source_record_id=${metric.recordId}` : "",
      cache.baseId ? `source_base_id=${cache.baseId}` : "",
      `copied_at=${nowIso()}`
    ].filter(Boolean)
  }, workspacePath);
  appendJsonl(path.join(workspacePath, "metrics", "_shares", `${localId}.jsonl`), {
    event: "shared_metric.copied_to_local",
    sourceSharedMetricId: metric.id,
    sourceRecordId: metric.recordId,
    sourceBaseId: cache.baseId,
    copiedAt: nowIso(),
    localMetricId: localId
  });
  return { ...result, source: metric };
}

function writeJsonAtomic(filePath, value) {
  mkdirp(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}
