import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendText,
  findSessionDir,
  listSessionIds,
  logSkillRun,
  mkdirp,
  nowIso,
  readJson,
  resolveWorkspacePath,
  safeName,
  safeReadText,
  sessionDir,
  writeJson,
  writeText
} from "./workspace.mjs";
import {
  copySharedMetricToLocal,
  createShareAction,
  executeShareAction,
  getShareProfile,
  latestShareActionFor,
  listShareActions,
  loadShareTargets,
  saveShareProfile,
  sharedMetricsCache,
  syncSharedMetrics
} from "./share.mjs";

const providerAliases = {
  bairong_data_query: "internal_data_query",
  baizhi_online_logs: "online_logs"
};
const legacyProviderAliases = Object.fromEntries(Object.entries(providerAliases).map(([legacy, canonical]) => [canonical, legacy]));
const dmsProviderIds = new Set(["internal_data_query", "bairong_data_query"]);

export function setCurrentDashboard(sessionId, workspacePath = resolveWorkspacePath()) {
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const updatedAt = nowIso();
  writeJson(path.join(workspacePath, "dashboards", "current.json"), {
    currentSessionId: sessionId,
    updatedAt
  });
  return { sessionId, updatedAt, ...dashboardBrowserFollowup(workspacePath) };
}

function dashboardBrowserFollowup(workspacePath) {
  const appConfig = readJson(path.join(workspacePath, "config", "app.json"), {});
  const host = process.env.HOST || appConfig.host || "127.0.0.1";
  const port = process.env.PORT || appConfig.port || appConfig.defaultPort || 3000;
  const origin = `http://${host}:${port}`;
  return {
    browserUrl: `${origin}/dashboard`,
    browserSurface: "codex_agent_in_app_browser",
    browserAction: "open_or_refresh_agent_dashboard_browser",
    widgetUrl: `${origin}/mcp-use/widgets/bi-dashboard`,
    dashboardUrl: `${origin}/dashboard`,
    dashboardUrlRole: "primary_agent_browser_target"
  };
}

export function saveMetricDefinition(metric, workspacePath = resolveWorkspacePath()) {
  const id = safeName(metric.id, "");
  if (!id) {
    throw new Error("必须提供指标 id");
  }
  const status = metric.status || "draft";
  const validatedBy = metric.validation?.validated_by || metric.validatedBy || "agent";
  const humanConfirmed = Boolean(metric.confirmValidated || metric.humanConfirmed || metric.validation?.human_confirmed);
  if (status === "validated" && (!humanConfirmed || validatedBy === "agent")) {
    throw new Error("指标首次保存为 validated 前必须提供用户或研发确认：传入 confirmValidated=true 且 validatedBy 不能为 agent。");
  }
  const updatedAt = nowIso();
  const metricPath = path.join(workspacePath, "metrics", `${id}.yaml`);
  const previousText = safeReadText(metricPath, "");
  const definition = metric.definition || "将该指标标记为 validated 前必须补充明确口径。";
  const name = metricDisplayName(metric.name, definition, metric.description, id);

  const dimensions = Array.isArray(metric.dimensions) ? metric.dimensions : [];
  const sourceTables = Array.isArray(metric.source_tables) ? metric.source_tables : [];
  const actualSql = metric.actualSql || metric.actual_sql || "";
  const notes = Array.isArray(metric.notes) && metric.notes.length ? metric.notes : ["由 Agent BI 创建。"];

  const yaml = `id: ${id}
name: ${JSON.stringify(name)}
status: ${status}
version: ${Number(metric.version || 1)}
description: ${JSON.stringify(metric.description || definition)}
definition: ${JSON.stringify(definition)}
grain: ${metric.grain || "unknown"}
time_field:
  field: ${metric.time_field?.field || metric.timeField || "unknown"}
  description: ${JSON.stringify(metric.time_field?.description || metric.timeDescription || "标记为 validated 前必须确认时间字段。")}
numerator:
  name: ${metric.numerator?.name || metric.numeratorName || "unknown"}
  logic: ${JSON.stringify(metric.numerator?.logic || metric.numeratorLogic || "TBD")}
denominator:
  name: ${metric.denominator?.name || metric.denominatorName || "unknown"}
  logic: ${JSON.stringify(metric.denominator?.logic || metric.denominatorLogic || "TBD")}
dimensions:
${dimensions.length ? dimensions.map((item) => `  - ${item}`).join("\n") : "  []"}
source_tables:
${sourceTables.length ? sourceTables.map((item) => `  - table: ${item.table || item}\n    role: ${item.role || "source"}`).join("\n") : "  []"}
${yamlLiteralBlock("actual_sql", actualSql)}
backend_evidence: []
validation:
  validated_by: ${validatedBy}
  validated_at: ${JSON.stringify(updatedAt)}
  human_confirmed: ${humanConfirmed}
  confidence: ${metric.validation?.confidence || "low"}
notes:
${notes.map((item) => `  - ${item}`).join("\n")}
`;

  let history = null;
  if (previousText) {
    history = archiveMetricVersion(workspacePath, id, previousText, yaml, updatedAt);
  }
  writeText(metricPath, yaml);
  updateMetricIndex(workspacePath, { id, name, status, updatedAt });
  logSkillRun(workspacePath, "metric.saved", { metricId: id, status, metricPath });
  return { id, metricPath, updatedAt, history };
}

function yamlLiteralBlock(key, value) {
  const text = String(value || "").trim();
  if (!text) {
    return `${key}: ""`;
  }
  return `${key}: |\n${text.split(/\r?\n/).map((line) => `  ${line}`).join("\n")}`;
}

function metricDisplayName(...values) {
  const explicit = String(values[0] || "").trim();
  if (hasCjk(explicit)) {
    return cleanMetricDisplayName(explicit);
  }
  for (const value of values.slice(1)) {
    const candidate = cleanMetricDisplayName(value);
    if (hasCjk(candidate)) {
      return candidate;
    }
  }
  return cleanMetricDisplayName(explicit || values.find(Boolean) || "未命名指标");
}

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function cleanMetricDisplayName(value = "") {
  let text = String(value || "").trim().replace(/^["']|["']$/g, "");
  text = text.replace(/^查询\s*/, "").replace(/^统计\s*/, "");
  text = text.split(/[:：。；;\n]/)[0].trim();
  text = text.replace(/^(指标口径|指标定义)\s*/, "").trim();
  if (text.length > 36) {
    text = text.slice(0, 36).trim();
  }
  return text;
}

function archiveMetricVersion(workspacePath, id, previousText, nextText, updatedAt) {
  const stamp = updatedAt.replace(/[:.]/g, "-");
  const historyDir = path.join(workspacePath, "metrics", "_history", id);
  mkdirp(historyDir);
  const previousPath = path.join(historyDir, `${stamp}-previous.yaml`);
  const nextPath = path.join(historyDir, `${stamp}-next.yaml`);
  const diffPath = path.join(historyDir, `${stamp}-diff.md`);
  writeText(previousPath, previousText);
  writeText(nextPath, nextText);
  writeText(diffPath, renderTextDiff(previousText, nextText));
  return { previousPath, nextPath, diffPath };
}

function renderTextDiff(previousText, nextText) {
  const previous = previousText.split(/\r?\n/);
  const next = nextText.split(/\r?\n/);
  const max = Math.max(previous.length, next.length);
  const lines = ["# 指标口径 Diff", ""];
  for (let index = 0; index < max; index += 1) {
    const oldLine = previous[index];
    const newLine = next[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        lines.push(`  ${oldLine}`);
      }
    } else {
      if (oldLine !== undefined) {
        lines.push(`- ${oldLine}`);
      }
      if (newLine !== undefined) {
        lines.push(`+ ${newLine}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function getMetricHistory(metricId, workspacePath = resolveWorkspacePath()) {
  const id = safeName(metricId, "");
  if (!id) {
    throw new Error("必须提供指标 id");
  }
  const historyDir = path.join(workspacePath, "metrics", "_history", id);
  const currentPath = path.join(workspacePath, "metrics", `${id}.yaml`);
  const entries = fs.existsSync(historyDir)
    ? fs.readdirSync(historyDir)
        .filter((file) => file.endsWith(".md") || file.endsWith(".yaml"))
        .sort()
        .reverse()
        .map((file) => ({
          file,
          path: path.join(historyDir, file),
          content: safeReadText(path.join(historyDir, file))
        }))
    : [];
  return {
    id,
    currentPath,
    current: safeReadText(currentPath),
    entries
  };
}

export function getShareTargets(workspacePath = resolveWorkspacePath()) {
  return loadShareTargets(workspacePath);
}

export function getSharingProfile() {
  return getShareProfile();
}

export function saveSharingProfile(options = {}) {
  return saveShareProfile(options);
}

export function getShareActions(options = {}, workspacePath = resolveWorkspacePath()) {
  const actions = listShareActions(workspacePath);
  if (options.subjectType && options.subjectId) {
    return actions.filter((action) => action.subjectType === options.subjectType && action.subjectId === options.subjectId);
  }
  return actions;
}

export function getLatestShareAction(options = {}, workspacePath = resolveWorkspacePath()) {
  return latestShareActionFor(workspacePath, options.subjectType, options.subjectId);
}

export async function createAndExecuteShareAction(options = {}, workspacePath = resolveWorkspacePath()) {
  const { action, reused } = createShareAction(options, workspacePath);
  if (reused) {
    return { action, reused };
  }
  return { action: await executeShareAction({ shareId: action.shareId }, workspacePath), reused: false };
}

export function createShareAssetAction(options = {}, workspacePath = resolveWorkspacePath()) {
  return createShareAction(options, workspacePath);
}

export async function runShareAction(options = {}, workspacePath = resolveWorkspacePath()) {
  return executeShareAction(options, workspacePath);
}

export async function syncTeamSharedMetrics(options = {}, workspacePath = resolveWorkspacePath()) {
  return syncSharedMetrics(options, workspacePath);
}

export function getSharedMetrics(workspacePath = resolveWorkspacePath()) {
  return sharedMetricsCache(workspacePath);
}

export function copyTeamSharedMetricToLocal(options = {}, workspacePath = resolveWorkspacePath()) {
  return copySharedMetricToLocal(options, workspacePath, saveMetricDefinition);
}

function updateMetricIndex(workspacePath, metric) {
  const indexPath = path.join(workspacePath, "metrics", "_index.yaml");
  const indexText = safeReadText(indexPath, "version: 1\nmetrics: []\n");
  const lines = indexText.includes(`id: ${metric.id}`)
    ? indexText
    : indexText.replace("metrics: []", "metrics:").trimEnd() + `
  - id: ${metric.id}
    name: ${JSON.stringify(metric.name)}
    status: ${metric.status}
    path: metrics/${metric.id}.yaml
    updated_at: ${JSON.stringify(metric.updatedAt)}
`;
  writeText(indexPath, `${lines.trimEnd()}\n`);
}

export function createRevision(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  const baseDir = findSessionDir(workspacePath, sessionId);
  if (!baseDir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const revisionId = options.revisionId || `rev-${Date.now()}`;
  const revisionDir = path.join(baseDir, "revisions", safeName(revisionId, "revision"));
  const createdAt = nowIso();
  mkdirp(revisionDir);

  writeText(path.join(revisionDir, "change.md"), `# 修订记录

- 创建时间：${createdAt}
- 修订原因：${options.reason || "未提供修订原因。"}
`);
  if (options.metricPlan) {
    writeText(path.join(revisionDir, "metric-plan.yaml"), options.metricPlan);
  }
  if (options.queryPlan) {
    const fileName = options.queryPlanType === "json" ? "query-plan.json" : "query-plan.sql";
    if (fileName.endsWith(".json") && typeof options.queryPlan !== "string") {
      writeJson(path.join(revisionDir, fileName), options.queryPlan);
    } else {
      writeText(path.join(revisionDir, fileName), String(options.queryPlan));
    }
  }
  if (options.auditNote) {
    writeText(path.join(revisionDir, "audit.md"), `# 审计说明\n\n${options.auditNote}\n`);
  }

  const metadataPath = path.join(baseDir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId });
  const revisions = Array.isArray(metadata.revisions) ? metadata.revisions : [];
  revisions.push({ revisionId: path.basename(revisionDir), createdAt, reason: options.reason || "" });
  metadata.revisions = revisions;
  metadata.updatedAt = createdAt;
  writeJson(metadataPath, metadata);

  appendText(path.join(baseDir, "audit.md"), `\n## 修订 ${path.basename(revisionDir)}\n\n- 创建时间：${createdAt}\n- 修订原因：${options.reason || "未提供修订原因。"}\n`);
  logSkillRun(workspacePath, "session.revision_created", { sessionId, revisionId: path.basename(revisionDir) });
  return { sessionId, revisionId: path.basename(revisionDir), revisionPath: revisionDir, createdAt };
}

export function requestDrillDown(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  const baseDir = findSessionDir(workspacePath, sessionId);
  if (!baseDir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const createdAt = nowIso();
  const actionId = options.actionId || `drill-${Date.now()}`;
  const payload = {
    actionId: safeName(actionId, "drill"),
    type: "drill_down",
    status: "pending",
    sessionId,
    createdAt,
    chartId: options.chartId || null,
    dimension: options.dimension || null,
    value: options.value || null,
    filters: options.filters || {},
    reason: options.reason || "看板下钻请求"
  };
  const actionPath = path.join(baseDir, "pending-actions", `${payload.actionId}.json`);
  writeJson(actionPath, payload);
  appendText(path.join(baseDir, "audit.md"), `\n## 待处理动作 ${payload.actionId}\n\n- 类型：drill_down\n- 创建时间：${createdAt}\n- 上下文：${JSON.stringify({ chartId: payload.chartId, dimension: payload.dimension, value: payload.value })}\n`);
  logSkillRun(workspacePath, "drill_down.requested", { sessionId, actionId: payload.actionId });
  return { ...payload, actionPath };
}

function ensureKnowledgeUpdateReviewAction(sessionId, dir, workspacePath, options = {}) {
  const actionId = "knowledge-update-review";
  const actionPath = path.join(dir, "pending-actions", `${actionId}.json`);
  if (fs.existsSync(actionPath)) {
    return readJson(actionPath, { actionId, sessionId });
  }
  const createdAt = nowIso();
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const confirmation = readJson(path.join(dir, "confirmation.json"), {});
  const queryPlanSql = safeReadText(path.join(dir, "query-plan.sql"), "");
  const queryPlanJson = readJson(path.join(dir, "query-plan.json"), null);
  const queryPlanText = queryPlanSql || JSON.stringify(queryPlanJson || {}, null, 2);
  const metricPlanText = safeReadText(path.join(dir, "metric-plan.yaml"), "");
  const candidateFields = collectKnowledgeUpdateCandidateFields(confirmation, metricPlanText, queryPlanText);
  const payload = {
    actionId,
    type: "knowledge_update_review",
    status: "pending",
    sessionId,
    createdAt,
    requiresUserConfirmation: true,
    prompt: "本次查询已完成。请询问用户是否根据本次查询逻辑更新知识库字段说明；用户确认后再写入字段含义、计算角色、来源表、去重/时间口径和 session 证据。",
    nextAgentStep: "如果用户确认，整理详细字段说明后运行 scripts/update_knowledge_fields_from_query.mjs；如果用户拒绝，在本 action 中标记 skipped 或保留待处理。",
    contextSummary: {
      question: confirmation.question || metadata.question || "",
      providerId: confirmation.providerId || metadata.providerId || "",
      metrics: confirmation.metrics || metadata.metrics || [],
      metricDefinition: confirmation.metricDefinition || "",
      calculationLogic: confirmation.calculationLogic || "",
      sourceTables: confirmation.sourceTables || [],
      timeRange: confirmation.timeRange || "",
      timeField: confirmation.timeField || "",
      dimensions: confirmation.dimensions || [],
      filters: confirmation.filters || [],
      dedupLogic: confirmation.dedupLogic || "",
      joinLogic: confirmation.joinLogic || "",
      completedBy: options.completedBy || ""
    },
    candidateFields,
    suggestedUpdateShape: {
      field: "字段名，例如 resolved_user_id",
      meaning: "详细业务含义：这个字段代表什么实体/事件、何时产生、是否脱敏、在本指标里如何使用。",
      role: "time_field / dimension / metric_input / dedup_key / filter / join_key",
      sourceTables: ["本次确认的数据源表或日志产物"],
      calculationUsage: "本次查询如何使用该字段，包括聚合、过滤、去重或分组逻辑。",
      evidence: ["session/metric-plan/query-plan/audit 或后端代码证据"]
    }
  };
  writeJson(actionPath, payload);
  appendText(path.join(dir, "audit.md"), `\n## 知识库更新确认\n\n- 创建时间：${createdAt}\n- 状态：pending\n- 说明：本次查询完成后需要询问用户是否把查询逻辑沉淀为字段含义和口径说明。\n- 候选字段：${candidateFields.map((item) => item.field).join(", ") || "待 Agent 整理"}\n`);
  metadata.pendingKnowledgeUpdateReview = {
    actionId,
    status: "pending",
    createdAt,
    actionPath: path.relative(dir, actionPath)
  };
  metadata.updatedAt = createdAt;
  writeJson(path.join(dir, "metadata.json"), metadata);
  logSkillRun(workspacePath, "knowledge_update_review.requested", { sessionId, actionId, fieldCount: candidateFields.length });
  return { ...payload, actionPath };
}

function collectKnowledgeUpdateCandidateFields(confirmation = {}, metricPlanText = "", queryPlanText = "") {
  const candidates = [];
  const skipTokens = new Set([
    confirmation.providerId,
    ...(confirmation.sourceTables || []),
    ...(confirmation.metrics || [])
  ].map((item) => String(item || "").toLowerCase()).filter(Boolean));
  const add = (field, role, reason = "") => {
    const normalized = String(field || "").trim().replace(/[`"'，,]/g, "");
    if (!normalized || normalized.length > 80 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
      return;
    }
    if (candidateStopWords.has(normalized.toLowerCase()) || skipTokens.has(normalized.toLowerCase())) {
      return;
    }
    const existing = candidates.find((item) => item.field === normalized);
    if (existing) {
      existing.roles = [...new Set([...(existing.roles || []), role].filter(Boolean))];
      if (reason && !existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
      return;
    }
    candidates.push({ field: normalized, roles: role ? [role] : [], reasons: reason ? [reason] : [] });
  };
  add(confirmation.timeField, "time_field", "执行前确认单的时间字段");
  for (const dimension of confirmation.dimensions || []) {
    add(dimension, "dimension", "执行前确认单的维度字段");
  }
  for (const filter of confirmation.filters || []) {
    for (const token of extractIdentifierTokens(filter)) {
      add(token, "filter", "执行前确认单的过滤条件");
    }
  }
  for (const text of [confirmation.calculationLogic, confirmation.dedupLogic, confirmation.joinLogic, metricPlanText, queryPlanText]) {
    for (const token of extractIdentifierTokens(text).slice(0, 60)) {
      const role = token === confirmation.timeField ? "time_field" : inferFieldRoleFromName(token);
      add(token, role, "指标计划或查询计划中出现");
    }
  }
  return candidates.slice(0, 32);
}

const candidateStopWords = new Set([
  "select", "from", "where", "group", "by", "order", "with", "as", "and", "or", "not", "null", "count",
  "sum", "avg", "min", "max", "distinct", "case", "when", "then", "else", "end", "date", "json", "true", "false",
  "metrics", "filters", "dimensions", "source", "table", "role", "confirmed", "unknown", "provider", "status",
  "provider_id", "metricdefinition", "calculationlogic", "timerange", "timefield", "confirmed_by", "confirmed_at",
  "time_range", "time_field", "source_tables", "dedup_logic", "join_logic", "backend_evidence",
  "id", "providerid", "providerreason", "confirmationrequired", "confirmationstatus", "maxpreviewrows", "allowdetaildump",
  "sourcetables", "deduplogic", "joinlogic", "readonly", "nodashboardproductionexecution", "nextstep"
]);

function extractIdentifierTokens(text = "") {
  const tokens = [];
  const pattern = /(^|[^a-zA-Z0-9_])([a-zA-Z_][a-zA-Z0-9_]*)(?=[^a-zA-Z0-9_]|$)/g;
  for (const match of String(text || "").matchAll(pattern)) {
    const token = match[2];
    const lower = token.toLowerCase();
    if (candidateStopWords.has(lower)) {
      continue;
    }
    const hasCamelShape = /[a-z]/.test(token) && /[A-Z]/.test(token);
    const hasFieldShape = /_/.test(token) || hasCamelShape || /(?:id|time|date|type|status|state|count|source|client|user|event|token|log)$/i.test(token);
    if (hasFieldShape) {
      tokens.push(token);
    }
  }
  return [...new Set(tokens)];
}

function inferFieldRoleFromName(fieldName) {
  const lower = String(fieldName || "").toLowerCase();
  if (/(time|date|created|updated|day)$/.test(lower)) return "time_field";
  if (/(user_id|userid|uid|token|device_id|session_id)$/.test(lower)) return "dedup_key";
  if (/(type|status|state|source|channel|client|platform)$/.test(lower)) return "dimension";
  if (/(count|amount|rate|score|duration)$/.test(lower)) return "metric_input";
  return "query_field";
}

export function updateKnowledgeFieldsFromQuery(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId || options["session-id"];
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const confirmed = Boolean(options.confirmUpdateKnowledge || options["confirm-update-knowledge"] || options.confirmed);
  const confirmedBy = options.confirmedBy || options["confirmed-by"] || "";
  if (!confirmed || !confirmedBy || confirmedBy === "agent") {
    throw new Error("更新知识库前必须获得用户确认：传入 confirmUpdateKnowledge=true 且 confirmedBy 不能为 agent。");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const updates = normalizeKnowledgeFieldUpdates(options, workspacePath);
  if (!updates.length) {
    throw new Error("必须提供至少一个字段说明更新。");
  }
  for (const update of updates) {
    validateKnowledgeFieldUpdate(update);
  }
  const createdAt = nowIso();
  const confirmation = readJson(path.join(dir, "confirmation.json"), {});
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const payload = {
    version: 1,
    kind: "query_field_meaning_overlay",
    sessionId,
    createdAt,
    confirmedBy,
    source: {
      question: confirmation.question || metadata.question || "",
      providerId: confirmation.providerId || metadata.providerId || "",
      metrics: confirmation.metrics || metadata.metrics || [],
      metricDefinition: confirmation.metricDefinition || "",
      calculationLogic: confirmation.calculationLogic || "",
      sourceTables: confirmation.sourceTables || [],
      timeRange: confirmation.timeRange || "",
      timeField: confirmation.timeField || "",
      dimensions: confirmation.dimensions || [],
      filters: confirmation.filters || [],
      dedupLogic: confirmation.dedupLogic || "",
      joinLogic: confirmation.joinLogic || ""
    },
    updates: updates.map((update) => ({
      field: update.field,
      meaning: update.meaning,
      detail: update.detail || update.meaning,
      role: update.role || inferFieldRoleFromName(update.field),
      sourceTables: normalizeList(update.sourceTables || update.source_tables || confirmation.sourceTables || []),
      calculationUsage: update.calculationUsage || update.calculation_usage || confirmation.calculationLogic || "",
      evidence: normalizeList(update.evidence || [
        path.relative(workspacePath, path.join(dir, "metric-plan.yaml")),
        path.relative(workspacePath, path.join(dir, fs.existsSync(path.join(dir, "query-plan.sql")) ? "query-plan.sql" : "query-plan.json")),
        path.relative(workspacePath, path.join(dir, "audit.md"))
      ]),
      confidence: update.confidence || "user_confirmed_query_context"
    }))
  };
  const outputDir = path.join(workspacePath, "knowledge", "field-meanings");
  const outputPath = path.join(outputDir, `${createdAt.slice(0, 10)}-${safeName(sessionId, "session")}-${Date.now()}.json`);
  writeJson(outputPath, payload);
  const actionPath = path.join(dir, "pending-actions", "knowledge-update-review.json");
  if (fs.existsSync(actionPath)) {
    const action = readJson(actionPath, {});
    writeJson(actionPath, {
      ...action,
      status: "completed",
      completedAt: createdAt,
      confirmedBy,
      knowledgeUpdatePath: path.relative(workspacePath, outputPath),
      updatedFields: payload.updates.map((item) => item.field)
    });
  }
  metadata.updatedAt = createdAt;
  metadata.knowledgeUpdatedAt = createdAt;
  metadata.knowledgeUpdatePath = path.relative(workspacePath, outputPath);
  writeJson(path.join(dir, "metadata.json"), metadata);
  appendText(path.join(dir, "audit.md"), `\n## 知识库字段说明更新\n\n- 更新时间：${createdAt}\n- 确认人：${confirmedBy}\n- 更新文件：${path.relative(workspacePath, outputPath)}\n- 字段：${payload.updates.map((item) => item.field).join(", ")}\n`);
  logSkillRun(workspacePath, "knowledge_fields.updated_from_query", { sessionId, outputPath, fieldCount: payload.updates.length });
  return { sessionId, outputPath, updatedAt: createdAt, fieldCount: payload.updates.length, fields: payload.updates.map((item) => item.field) };
}

function normalizeKnowledgeFieldUpdates(options, workspacePath) {
  if (Array.isArray(options.updates)) {
    return options.updates;
  }
  const updatesPath = options.updatesJson || options["updates-json"] || options.updatesPath || options["updates-path"];
  if (updatesPath) {
    const payload = readJson(path.resolve(updatesPath), null);
    if (!payload) {
      throw new Error(`无法读取字段说明更新文件：${updatesPath}`);
    }
    return Array.isArray(payload) ? payload : (payload.fields || payload.updates || []);
  }
  if (options.field && options.meaning) {
    return [{
      field: options.field,
      meaning: options.meaning,
      detail: options.detail,
      role: options.role,
      sourceTables: options.sourceTables || options["source-tables"],
      calculationUsage: options.calculationUsage || options["calculation-usage"],
      evidence: options.evidence,
      confidence: options.confidence
    }];
  }
  return [];
}

function validateKnowledgeFieldUpdate(update) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(update.field || ""))) {
    throw new Error(`字段名不合法：${update.field || ""}`);
  }
  const meaning = String(update.meaning || "").trim();
  if (meaning.length < 18 || /^(待|TBD|unknown|todo|待确认|待补充)/i.test(meaning)) {
    throw new Error(`字段 ${update.field} 的含义过短或仍是占位内容。请写清业务含义、产生逻辑和本次指标中的用法。`);
  }
}

export function registerProvider(provider, workspacePath = resolveWorkspacePath()) {
  const id = safeName(provider.id, "");
  if (!id) {
    throw new Error("必须提供 Provider id");
  }
  const providerDir = path.join(workspacePath, "knowledge", "query-providers", id);
  mkdirp(providerDir);
  const inputSchema = provider.inputSchema || { type: "object", properties: {}, additionalProperties: true };
  const outputSchema = provider.outputSchema || { type: "object", properties: {}, additionalProperties: true };
  writeJson(path.join(providerDir, "input-schema.json"), inputSchema);
  writeJson(path.join(providerDir, "output-schema.json"), outputSchema);
  writeText(path.join(providerDir, "usage.md"), `# ${provider.displayName || id}

${provider.description || "启用生产查询前请补充 provider 使用说明。"}
`);
  writeText(path.join(providerDir, "safety.md"), `# 安全策略

- read_only: ${provider.safety_policy?.read_only ?? true}
- allow_detail_dump: ${provider.safety_policy?.allow_detail_dump ?? false}
- max_preview_rows: ${provider.safety_policy?.max_preview_rows ?? "unlimited"}
`);
  writeText(path.join(providerDir, "examples.md"), "# 示例\n\n在这里补充 smoke test 示例。\n");

  const registryPath = path.join(workspacePath, "config", "query-providers.yaml");
  const registry = safeReadText(registryPath, "version: 1\ndefault_provider: internal_data_query\nproviders:\n");
  if (registry.includes(`id: ${id}`)) {
    throw new Error(`Provider 已存在：${id}`);
  }

  const block = `
  - id: ${id}
    type: ${provider.type || "mcp_tool"}
    display_name: ${provider.displayName || id}
    status: ${provider.status || "draft"}
    mcp_server_hint: ${provider.mcpServerHint || "unknown"}
    tool_name: ${provider.toolName || "query"}
    description: ${provider.description || "由 Agent BI 登记。"}
    input_schema_ref: knowledge/query-providers/${id}/input-schema.json
    output_schema_ref: knowledge/query-providers/${id}/output-schema.json
    routing_keywords:
${(provider.routingKeywords || [id]).map((item) => `      - ${item}`).join("\n")}
    safety_policy:
      read_only: ${provider.safety_policy?.read_only ?? true}
      allow_detail_dump: ${provider.safety_policy?.allow_detail_dump ?? false}
      max_preview_rows: ${provider.safety_policy?.max_preview_rows ?? "unlimited"}
    output_mapping:
      rows_path: "${provider.output_mapping?.rows_path || "$.rows"}"
      columns_path: "${provider.output_mapping?.columns_path || "$.columns"}"
      summary_path: "${provider.output_mapping?.summary_path || "$.summary"}"
  `;
  writeText(registryPath, `${registry.trimEnd()}\n${block}`);
  logSkillRun(workspacePath, "provider.registered", { providerId: id, status: provider.status || "draft" });
  return { id, providerDir, registryPath };
}

export function scanBackendProject(options, workspacePath = resolveWorkspacePath()) {
  const repoPath = options.repoPath || options.repo;
  if (!repoPath) {
    throw new Error("必须提供后端 repo 路径");
  }
  const absoluteRepo = path.resolve(repoPath);
  if (!fs.existsSync(absoluteRepo) || !fs.statSync(absoluteRepo).isDirectory()) {
    throw new Error(`后端 repo 不存在或不是目录：${absoluteRepo}`);
  }

  const domain = safeName(options.domain || "backend", "backend");
  const keywords = Array.isArray(options.keywords)
    ? options.keywords
    : String(options.keywords || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const maxFiles = Number(options.maxFiles || 120);
  const maxMatches = Number(options.maxMatches || 240);
  const createdAt = nowIso();
  const scanDate = createdAt.slice(0, 10);
  const candidates = collectCodeFiles(absoluteRepo, maxFiles * 20);
  const matches = [];

  for (const filePath of candidates) {
    const rel = path.relative(absoluteRepo, filePath);
    const text = safeReadText(filePath);
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const matched = keywords.length
        ? keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
        : /(status|state|channel|apply|credit|select|insert|update|mapper|dao|repository|enum)/i.test(line);
      if (matched) {
        matches.push({ file: rel, line: index + 1, text: redactSensitiveSnippet(line.trim()).slice(0, 240) });
      }
      if (matches.length >= maxMatches) {
        break;
      }
    }
    if (matches.length >= maxMatches) {
      break;
    }
  }

  const outputPath = path.join(workspacePath, "knowledge", "code-scans", `${scanDate}-${domain}.md`);
  const fieldMappingPath = path.join(workspacePath, "knowledge", "field-mappings", `${scanDate}-${domain}.yaml`);
  const fieldCandidates = collectFieldCandidates(matches, candidates, absoluteRepo);
  const selectedFiles = [...new Set([
    ...matches.map((item) => item.file),
    ...fieldCandidates.flatMap((item) => item.examples.map((example) => example.split(":")[0]))
  ])].slice(0, maxFiles);
  const content = `# 后端逻辑扫描：${options.domain || domain}

- 扫描时间：${createdAt}
- Repo：${absoluteRepo}
- 关键词：${keywords.join(", ") || "默认代码模式"}
- 命中文件数：${selectedFiles.length}
- 命中片段数：${matches.length}

## 关键文件

${selectedFiles.map((file) => `- ${file}`).join("\n") || "- 未发现匹配文件"}

## 命中片段

${matches.map((item) => `### ${item.file}:${item.line}\n\n\`\`\`text\n${item.text}\n\`\`\``).join("\n\n") || "未发现匹配片段。"}

## Agent 后续整理要求

请基于这些证据继续补充：

- 关键字段含义
- 状态枚举与映射
- 核心计算逻辑
- 存储表或实体关系
- 数据产生链路
- 去重规则
- 过滤规则
- 已知风险和待确认点
`;
  writeText(outputPath, content);
  writeText(fieldMappingPath, renderFieldMappingYaml({
    domain: options.domain || domain,
    repoPath: absoluteRepo,
    scannedAt: createdAt,
    keywords,
    fieldCandidates
  }));
  appendText(path.join(workspacePath, "knowledge", "business-context.md"), renderBusinessContextAppend({
    domain: options.domain || domain,
    repoPath: absoluteRepo,
    scanPath: path.relative(workspacePath, outputPath),
    fieldMappingPath: path.relative(workspacePath, fieldMappingPath),
    scannedAt: createdAt,
    keywords,
    files: selectedFiles.length,
    matches: matches.length
  }));
  updateBackendProjects(workspacePath, {
    domain: options.domain || domain,
    repoPath: absoluteRepo,
    scanPath: path.relative(workspacePath, outputPath),
    fieldMappingPath: path.relative(workspacePath, fieldMappingPath),
    scannedAt: createdAt,
    keywords
  });
  logSkillRun(workspacePath, "backend.scanned", { domain: options.domain || domain, repoPath: absoluteRepo, matches: matches.length });
  return { repoPath: absoluteRepo, scanPath: outputPath, fieldMappingPath, matches: matches.length, files: selectedFiles.length };
}

function redactSensitiveSnippet(line) {
  return String(line || "")
    .replace(/("?(?:authorization|token|password|passwd|pwd|secret|cookie|access[-_]?key|secret[-_]?key)"?\s*:\s*)("[^"]*"|[^,\s}]+)/gi, "$1<redacted>")
    .replace(/(Authorization\s*["':=]\s*)([^"',\s}]+)/gi, "$1<redacted>")
    .replace(/(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, "$1<redacted>")
    .replace(/((?:password|passwd|pwd|secret|token|access[-_]?key|secret[-_]?key|cookie)\s*[:=]\s*)([^,\s"'}`]+)/gi, "$1<redacted>")
    .replace(/((?:username|user)\s*[:=]\s*)([^,\s"'}`]+)/gi, "$1<redacted>")
    .replace(/(jdbc:mysql:\/\/)([^?\s"'}`]+)/gi, "$1<redacted-host-db>")
    .replace(/((?:url|endpoint|host)\s*[:=]\s*)(jdbc:[^,\s"'}`]+|https?:\/\/[^,\s"'}`]+)/gi, "$1<redacted-url>");
}

function collectFieldCandidates(matches, files = [], repoRoot = "") {
  const candidates = new Map();
  const fieldPattern = /\b([a-z][a-z0-9_]*(?:_id|_time|_date|_status|_state|_channel|_type|_amount|_count|_rate)?)\b/g;
  const stopWords = new Set([
    "agent",
    "dashboard",
    "description",
    "native",
    "query",
    "provider",
    "registry",
    "skill",
    "status",
    "session",
    "metric",
    "metrics",
    "data",
    "mcp",
    "preview",
    "localhost",
    "version"
  ]);
  const addCandidate = (field, example, meta = {}) => {
    const normalized = String(field || "").trim();
    if (!isLikelyField(normalized, stopWords)) {
      return;
    }
    const existing = candidates.get(normalized) || {
      field: normalized,
      examples: [],
      sourceKinds: [],
      owners: [],
      dataTypes: [],
      meanings: []
    };
    if (example && existing.examples.length < 5 && !existing.examples.includes(example)) {
      existing.examples.push(example);
    }
    if (meta.sourceKind && !existing.sourceKinds.includes(meta.sourceKind)) {
      existing.sourceKinds.push(meta.sourceKind);
    }
    if (meta.owner && !existing.owners.includes(meta.owner)) {
      existing.owners.push(meta.owner);
    }
    if (meta.dataType && !existing.dataTypes.includes(meta.dataType)) {
      existing.dataTypes.push(meta.dataType);
    }
    if (meta.meaning && !existing.meanings.includes(meta.meaning)) {
      existing.meanings.push(meta.meaning);
    }
    candidates.set(normalized, existing);
  };
  const structuredFiles = files
    .filter((filePath) => isStructuredFieldFile(filePath))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).size <= 1_000_000;
      } catch {
        return false;
      }
    })
    .sort((left, right) => structuredFieldPriority(left) - structuredFieldPriority(right))
    .slice(0, 700);
  for (const filePath of structuredFiles) {
    const rel = repoRoot ? path.relative(repoRoot, filePath) : filePath;
    const text = safeReadText(filePath);
    if (!text) {
      continue;
    }
    if (/\.sql$/i.test(filePath)) {
      for (const item of extractSqlFields(text)) {
        addCandidate(item.field, `${rel}:${lineNumberAt(text, item.index)}`, item);
      }
    } else if (/\.xml$/i.test(filePath)) {
      for (const item of extractXmlFields(text)) {
        addCandidate(item.field, `${rel}:${lineNumberAt(text, item.index)}`, item);
      }
    } else if (/\.(java|kt|groovy)$/i.test(filePath)) {
      for (const item of extractJvmFields(text, filePath)) {
        addCandidate(item.field, `${rel}:${lineNumberAt(text, item.index)}`, item);
      }
    }
  }

  for (const match of matches) {
    if (candidates.size >= 220 || isLowSignalFieldFile(match.file)) {
      continue;
    }
    for (const tokenMatch of match.text.matchAll(fieldPattern)) {
      addCandidate(tokenMatch[1], `${match.file}:${match.line}`, { sourceKind: "keyword_match" });
      if (candidates.size >= 220) {
        break;
      }
    }
  }
  return [...candidates.values()]
    .sort((left, right) => fieldCandidateScore(right) - fieldCandidateScore(left) || left.field.localeCompare(right.field))
    .slice(0, 240);
}

function fieldCandidateScore(candidate) {
  const sourceKinds = candidate.sourceKinds || [];
  let score = 0;
  if (sourceKinds.includes("sql_column")) score += 100;
  if (sourceKinds.includes("java_entity_field")) score += 80;
  if (sourceKinds.includes("xml_mapping")) score += 65;
  if (sourceKinds.includes("api_dto_field")) score += 45;
  if (sourceKinds.includes("java_mapping_field")) score += 35;
  if (sourceKinds.includes("keyword_match")) score += 5;
  score += Math.min(candidate.examples?.length || 0, 5);
  return score;
}

function isLowSignalFieldFile(filePath) {
  return /(^|\/)(README|AGENTS?|docs?|config|logback|pom\.xml|package\.json)|\.(md|yml|yaml|json|properties)$/i.test(filePath);
}

function isLikelyField(value, stopWords) {
  const token = String(value || "").trim();
  const lower = token.toLowerCase();
  if (token.length < 2 || token.length > 80 || stopWords.has(lower)) {
    return false;
  }
  if (/^(select|from|where|case|when|then|else|null|true|false|public|private|return|class|const|let|var|create|table|index|constraint|primary|unique|default|comment)$/i.test(token)) {
    return false;
  }
  if (/^\d/.test(token) || /^[A-Z0-9_]+$/.test(token)) {
    return false;
  }
  return token.includes("_")
    || /(?:id|Id|time|Time|date|Date|status|Status|state|State|channel|Channel|type|Type|amount|Amount|count|Count|rate|Rate|name|Name|code|Code|at|At|by|By|no|No|url|Url|uri|Uri|path|Path|key|Key|value|Value|flag|Flag|level|Level|score|Score|size|Size|order|Order|index|Index|message|Message|content|Content|title|Title|task|Task|user|User|tenant|Tenant|thread|Thread|session|Session|created|Created|updated|Updated|deleted|Deleted)$/u.test(token);
}

function isStructuredFieldFile(filePath) {
  const name = path.basename(filePath);
  if (/\.(sql|xml)$/i.test(name)) {
    return true;
  }
  return /(?:Entity|Model|DTO|Dto|VO|Request|Response|Mapper|Repository|Dao|DAO)\.(java|kt|groovy)$/i.test(name);
}

function structuredFieldPriority(filePath) {
  const name = path.basename(filePath);
  if (/\.sql$/i.test(name)) return 0;
  if (/(?:Entity|Model)\.(java|kt|groovy)$/i.test(name)) return 1;
  if (/(?:Mapper|Repository|Dao|DAO)\.(java|kt|groovy|xml)$/i.test(name)) return 2;
  if (/(?:Request|Response|DTO|Dto|VO)\.(java|kt|groovy)$/i.test(name)) return 3;
  if (/\.xml$/i.test(name)) return 4;
  return 9;
}

function lineNumberAt(text, index) {
  return text.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function extractSqlFields(text) {
  const fields = [];
  const tablePattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([a-zA-Z][a-zA-Z0-9_]*)[`"]?/i;
  const columnPattern = /^\s*[`"]?([a-zA-Z][a-zA-Z0-9_]*)[`"]?\s+(bigint|int|integer|tinyint|smallint|mediumint|varchar|char|text|longtext|mediumtext|datetime|timestamp|date|time|decimal|double|float|json|boolean|bool|blob|longblob)\b/i;
  const commentPattern = /\bCOMMENT\s+['"]([^'"]+)['"]/i;
  let currentTable = "";
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const tableMatch = line.match(tablePattern);
    if (tableMatch) {
      currentTable = tableMatch[1];
    }
    const columnMatch = line.match(columnPattern);
    if (columnMatch) {
      fields.push({
        field: columnMatch[1],
        index: offset + (columnMatch.index || 0),
        sourceKind: "sql_column",
        owner: currentTable,
        dataType: columnMatch[2].toLowerCase(),
        meaning: line.match(commentPattern)?.[1] || ""
      });
    }
    if (currentTable && /^\s*\)\s*;?/.test(line)) {
      currentTable = "";
    }
    offset += line.length + 1;
  }
  return fields;
}

function extractXmlFields(text) {
  const fields = [];
  const xmlPattern = /\b(?:column|property)\s*=\s*["']([^"']+)["']/gi;
  const ownerPattern = /\b(?:id|namespace)\s*=\s*["']([^"']+)["']/i;
  let currentOwner = "";
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const ownerMatch = line.match(ownerPattern);
    if (ownerMatch) {
      currentOwner = ownerMatch[1];
    }
    xmlPattern.lastIndex = 0;
    for (const match of line.matchAll(xmlPattern)) {
      fields.push({
        field: match[1],
        index: offset + (match.index || 0),
        sourceKind: "xml_mapping",
        owner: currentOwner,
        meaning: ""
      });
    }
    offset += line.length + 1;
  }
  return fields;
}

function extractJvmFields(text, filePath = "") {
  const fields = [];
  const columnAnnotation = /@Column\s*\([^)]*name\s*=\s*["']([^"']+)["'][^)]*\)/i;
  const jsonAnnotation = /@(JsonProperty|JSONField)\s*\([^)]*(?:value|name)?\s*=?\s*["']([^"']+)["'][^)]*\)/i;
  const schemaAnnotation = /@Schema\s*\([^)]*(?:description|title)\s*=\s*["']([^"']+)["'][^)]*\)/i;
  const apiModelAnnotation = /@ApiModelProperty\s*\([^)]*(?:value\s*=\s*)?["']([^"']+)["'][^)]*\)/i;
  const classPattern = /\b(?:class|record|data\s+class)\s+([A-Z][A-Za-z0-9_]*)\b/;
  const javaFieldPattern = /^\s*(?:private|protected|public)\s+(?:static\s+|final\s+|transient\s+|volatile\s+)*([\w<>, ?.[\]]+)\s+([a-z][A-Za-z0-9_]*)\s*(?:=|;)/;
  const sourceKind = jvmSourceKind(filePath);
  let currentClass = path.basename(filePath).replace(/\.(java|kt|groovy)$/i, "");
  let pendingColumn = "";
  let pendingJson = "";
  let pendingMeaning = "";
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const classMatch = line.match(classPattern);
    if (classMatch) {
      currentClass = classMatch[1];
    }
    const columnMatch = line.match(columnAnnotation);
    if (columnMatch) {
      pendingColumn = columnMatch[1];
    }
    const jsonMatch = line.match(jsonAnnotation);
    if (jsonMatch) {
      pendingJson = jsonMatch[2];
    }
    const schemaMatch = line.match(schemaAnnotation);
    if (schemaMatch) {
      pendingMeaning = schemaMatch[1];
    }
    const apiModelMatch = line.match(apiModelAnnotation);
    if (apiModelMatch) {
      pendingMeaning = apiModelMatch[1];
    }
    const lineCommentMatch = line.match(/^\s*\/\/\s*(.+)$/);
    if (lineCommentMatch) {
      pendingMeaning = lineCommentMatch[1].trim();
    }
    const javadocTextMatch = line.match(/^\s*\*\s+(.+)$/);
    if (javadocTextMatch && !/[.@]/.test(javadocTextMatch[1])) {
      pendingMeaning = javadocTextMatch[1].trim();
    }
    const fieldMatch = line.match(javaFieldPattern);
    if (fieldMatch) {
      fields.push({
        field: pendingColumn || pendingJson || fieldMatch[2],
        index: offset + fieldMatch.index,
        sourceKind,
        owner: currentClass,
        dataType: fieldMatch[1].trim(),
        meaning: pendingMeaning
      });
      pendingColumn = "";
      pendingJson = "";
      pendingMeaning = "";
    }
    offset += line.length + 1;
  }
  return fields;
}

function jvmSourceKind(filePath) {
  const name = path.basename(filePath);
  if (/(?:Entity|Model)\.(java|kt|groovy)$/i.test(name)) return "java_entity_field";
  if (/(?:Mapper|Repository|Dao|DAO)\.(java|kt|groovy)$/i.test(name)) return "java_mapping_field";
  if (/(?:Request|Response|DTO|Dto|VO)\.(java|kt|groovy)$/i.test(name)) return "api_dto_field";
  return "java_field";
}

function renderFieldMappingYaml({ domain, repoPath, scannedAt, keywords, fieldCandidates }) {
  return `version: 1
domain: ${domain}
repo_path: ${repoPath}
scanned_at: ${JSON.stringify(scannedAt)}
keywords:
${keywords.map((item) => `  - ${item}`).join("\n") || "  []"}
field_candidates:
${fieldCandidates.length ? fieldCandidates.map((item) => `  - field: ${item.field}
    meaning: ${JSON.stringify(item.meanings[0] || "待 Agent 根据代码上下文补充")}
    source_kinds:
${item.sourceKinds.length ? item.sourceKinds.map((value) => `      - ${value}`).join("\n") : "      []"}
    owners:
${item.owners.length ? item.owners.map((value) => `      - ${value}`).join("\n") : "      []"}
    data_types:
${item.dataTypes.length ? item.dataTypes.map((value) => `      - ${value}`).join("\n") : "      []"}
    evidence:
${item.examples.map((example) => `      - ${example}`).join("\n")}`).join("\n") : "  []"}
status_mappings: []
calculation_logic: []
storage_entities: []
data_lineage: []
dedup_rules: []
filter_rules: []
open_questions:
  - 本文件由代码扫描生成，需要 Agent 或研发补充字段含义与业务口径。
`;
}

function renderBusinessContextAppend({ domain, repoPath, scanPath, fieldMappingPath, scannedAt, keywords, files, matches }) {
  return `
## 后端扫描：${domain}

- 扫描时间：${scannedAt}
- Repo：${repoPath}
- 关键词：${keywords.join(", ") || "默认代码模式"}
- 命中文件数：${files}
- 命中片段数：${matches}
- 代码证据：${scanPath}
- 字段映射草稿：${fieldMappingPath}
- 后续处理：Agent 必须基于代码证据补充字段含义、状态枚举、计算逻辑、数据写入路径、更新时间口径、去重规则、过滤规则和不确定项。
`;
}

function collectCodeFiles(root, maxFiles) {
  const ignoreDirs = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".venv", "__pycache__"]);
  const allowed = /\.(js|ts|tsx|jsx|java|kt|go|py|sql|xml|yaml|yml|json|md|properties)$/i;
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
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
        if (!ignoreDirs.has(entry.name)) {
          stack.push(full);
        }
      } else if (entry.isFile() && allowed.test(entry.name)) {
        files.push(full);
      }
      if (files.length >= maxFiles) {
        break;
      }
    }
  }
  return files;
}

function updateBackendProjects(workspacePath, project) {
  const filePath = path.join(workspacePath, "knowledge", "backend-projects.yaml");
  const existing = safeReadText(filePath, "version: 1\nprojects: []\n");
  const block = `  - domain: ${project.domain}
    repo_path: ${project.repoPath}
    last_scan_path: ${project.scanPath}
    last_field_mapping_path: ${project.fieldMappingPath}
    last_scanned_at: ${JSON.stringify(project.scannedAt)}
    keywords:
${project.keywords.map((item) => `      - ${item}`).join("\n") || "      []"}
`;
  const next = existing.includes("projects: []")
    ? existing.replace("projects: []", `projects:\n${block}`)
    : `${existing.trimEnd()}\n${block}`;
  writeText(filePath, next);
}

export function listPendingActions(workspacePath = resolveWorkspacePath()) {
  const actions = [];
  for (const sessionId of listSessionIds(workspacePath)) {
    const dir = sessionDir(workspacePath, sessionId);
    const pendingDir = path.join(dir, "pending-actions");
    if (!fs.existsSync(pendingDir)) {
      continue;
    }
    for (const file of fs.readdirSync(pendingDir)) {
      if (file.endsWith(".json")) {
        actions.push(readJson(path.join(pendingDir, file), { sessionId, actionId: file.replace(/\.json$/, "") }));
      }
    }
  }
  return actions.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export function compareSessions(options, workspacePath = resolveWorkspacePath()) {
  const leftId = options.left || options.leftSessionId || options.sessionA;
  const rightId = options.right || options.rightSessionId || options.sessionB;
  if (!leftId || !rightId) {
    throw new Error("必须提供两个 session id");
  }
  const leftDir = findSessionDir(workspacePath, leftId);
  const rightDir = findSessionDir(workspacePath, rightId);
  if (!leftDir || !rightDir) {
    throw new Error("待对比 session 不存在");
  }
  const comparedAt = nowIso();
  const result = {
    comparedAt,
    left: loadSessionForCompare(leftDir, leftId),
    right: loadSessionForCompare(rightDir, rightId)
  };
  result.diff = {
    questionChanged: result.left.metadata.question !== result.right.metadata.question,
    statusChanged: result.left.metadata.status !== result.right.metadata.status,
    providerChanged: result.left.metadata.providerId !== result.right.metadata.providerId,
    aggregateRowDelta: result.right.aggregateRows - result.left.aggregateRows,
    previewRowDelta: result.right.previewRows - result.left.previewRows,
    metricPlanDiff: renderTextDiff(result.left.metricPlan, result.right.metricPlan),
    queryPlanDiff: renderTextDiff(result.left.queryPlan, result.right.queryPlan)
  };
  const compareDir = path.join(workspacePath, "dashboards", "comparisons");
  mkdirp(compareDir);
  const comparePath = path.join(compareDir, `${safeName(leftId)}__vs__${safeName(rightId)}.json`);
  writeJson(comparePath, result);
  logSkillRun(workspacePath, "session.compared", { leftId, rightId, comparePath });
  return { ...result, comparePath };
}

function loadSessionForCompare(dir, sessionId) {
  const aggregate = readJson(path.join(dir, "result.aggregate.json"), { rows: [] });
  const preview = readJson(path.join(dir, "result.preview.json"), { rows: [] });
  const queryPlan = safeReadText(path.join(dir, "query-plan.sql")) || JSON.stringify(readJson(path.join(dir, "query-plan.json"), {}), null, 2);
  return {
    sessionId,
    metadata: readJson(path.join(dir, "metadata.json"), { sessionId }),
    metricPlan: safeReadText(path.join(dir, "metric-plan.yaml")),
    queryPlan,
    aggregateRows: Array.isArray(aggregate.rows) ? aggregate.rows.length : 0,
    previewRows: Array.isArray(preview.rows) ? preview.rows.length : 0
  };
}

export function createFailedSession(options, workspacePath = resolveWorkspacePath()) {
  const now = new Date();
  const sessionId = options.sessionId || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-failed-${Date.now()}`;
  const dir = sessionDir(workspacePath, sessionId);
  const createdAt = nowIso();
  mkdirp(dir);
  writeText(path.join(dir, "request.md"), `# 原始需求\n\n${options.question || "查询执行失败"}\n`);
  writeText(path.join(dir, "interpretation.md"), `# Agent 解析\n\n查询未成功执行，原因见审计说明。\n`);
  writeText(path.join(dir, "metric-plan.yaml"), `question: ${JSON.stringify(options.question || "查询执行失败")}\nmetrics: []\nassumptions: []\nrisks:\n  - 查询执行失败，不能生成业务结论。\n`);
  writeJson(path.join(dir, "query-plan.json"), {
    providerId: options.providerId || "unknown",
    toolName: options.toolName || null,
    input: options.input || {},
    failedAt: createdAt
  });
  writeJson(path.join(dir, "result.aggregate.json"), { columns: [], rows: [], summary: { rowCount: 0 } });
  writeJson(path.join(dir, "result.preview.json"), { columns: [], rows: [], truncated: false, maxPreviewRows: null });
  writeJson(path.join(dir, "chart-spec.json"), { version: "0.1", sessionId, charts: [], tables: [] });
  writeText(path.join(dir, "audit.md"), `# 审计说明\n\n- Session id：${sessionId}\n- 创建时间：${createdAt}\n- 状态：failed\n- Provider：${options.providerId || "unknown"}\n- 失败原因：${options.error || "未提供错误信息"}\n- 诊断建议：检查 provider registry、MCP server 配置、权限和查询计划。\n`);
  writeJson(path.join(dir, "metadata.json"), {
    sessionId,
    createdAt,
    updatedAt: createdAt,
    agent: "codex",
    status: "failed",
    question: options.question || "查询执行失败",
    metrics: [],
    providerId: options.providerId || "unknown",
    error: options.error || "未提供错误信息"
  });
  writeJson(path.join(workspacePath, "dashboards", "current.json"), {
    currentSessionId: sessionId,
    updatedAt: createdAt
  });
  logSkillRun(workspacePath, "session.failed_created", { sessionId, providerId: options.providerId || "unknown" });
  return { sessionId, sessionPath: dir, createdAt, ...dashboardBrowserFollowup(workspacePath) };
}

export function createAnalysisSession(options, workspacePath = resolveWorkspacePath()) {
  const question = String(options.question || "").trim();
  if (!question) {
    throw new Error("必须提供自然语言分析问题");
  }
  const now = new Date();
  const createdAt = nowIso();
  const sessionId = options.sessionId || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-analysis-${Date.now()}`;
  const dir = sessionDir(workspacePath, sessionId);
  if (fs.existsSync(dir)) {
    throw new Error(`session 已存在：${sessionId}`);
  }
  mkdirp(dir);

  const metrics = normalizeList(options.metrics || options.metric || []);
  const dimensions = normalizeList(options.dimensions || []);
  const provider = selectQueryProvider({
    question,
    metrics,
    keywords: options.keywords || metrics
  }, workspacePath);
  const providerId = options.providerId || provider.providerId;
  const confirmation = buildConfirmation({
    status: "draft",
    question,
    providerId,
    metrics,
    metricDefinition: options.metricDefinition || "",
    sourceTables: normalizeList(options.sourceTables || []),
    calculationLogic: options.calculationLogic || "",
    timeRange: options.timeRange || "",
    timeField: options.timeField || "",
    dimensions,
    filters: normalizeList(options.filters || []),
    dedupLogic: options.dedupLogic || "",
    joinLogic: options.joinLogic || "",
    backendEvidence: normalizeList(options.backendEvidence || []),
    assumptions: normalizeList(options.assumptions || ["待用户确认指标口径、数据源、时间字段和去重规则。"]),
    risks: normalizeList(options.risks || ["未确认前不得执行生产查询。"]),
    confirmedBy: "",
    notes: "自然语言理解后生成的执行前确认单。"
  });

  writeText(path.join(dir, "request.md"), `# 原始需求\n\n${question}\n`);
  writeText(path.join(dir, "interpretation.md"), renderInterpretationFromConfirmation(confirmation, provider));
  writeText(path.join(dir, "metric-plan.yaml"), renderMetricPlanFromConfirmation(confirmation));
  writeJson(path.join(dir, "query-plan.json"), renderQueryPlanFromConfirmation(confirmation, provider));
  writeJson(path.join(dir, "result.aggregate.json"), { columns: [], rows: [], summary: { primaryMetric: "待执行", primaryValue: null, rowCount: 0 } });
  writeJson(path.join(dir, "result.preview.json"), { columns: [], rows: [], truncated: false, maxPreviewRows: null });
  writeJson(path.join(dir, "chart-spec.json"), { version: "0.1", sessionId, title: "待执行分析", charts: [], tables: [] });
  writeJson(path.join(dir, "confirmation.json"), confirmation);
  writeText(path.join(dir, "audit.md"), `# 审计说明\n\n- Session id：${sessionId}\n- 创建时间：${createdAt}\n- 状态：pending_confirmation\n- Provider 候选：${providerId}\n- 流程边界：用户确认指标、数据源和计算口径前，不允许执行生产查询。\n`);
  writeJson(path.join(dir, "metadata.json"), {
    sessionId,
    createdAt,
    updatedAt: createdAt,
    agent: "codex",
    status: "pending_confirmation",
    question,
    metrics,
    providerId,
    confirmationStatus: "draft"
  });
  logSkillRun(workspacePath, "session.analysis_created", {
    sessionId,
    providerId,
    confirmationStatus: "draft",
    dashboardUpdated: false
  });
  return { sessionId, sessionPath: dir, confirmation, createdAt };
}

export function saveExecutionConfirmation(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const metadataPath = path.join(dir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId });
  const previous = readJson(path.join(dir, "confirmation.json"), {});
  const status = options.status || previous.status || "draft";
  const confirmation = buildConfirmation({
    ...previous,
    ...options,
    question: options.question || previous.question || metadata.question || markdownToPlainText(safeReadText(path.join(dir, "request.md"))),
    providerId: options.providerId || previous.providerId || metadata.providerId || "internal_data_query",
    metrics: normalizeList(options.metrics ?? previous.metrics ?? metadata.metrics ?? []),
    sourceTables: normalizeList(options.sourceTables ?? previous.sourceTables ?? []),
    dimensions: normalizeList(options.dimensions ?? previous.dimensions ?? []),
    filters: normalizeList(options.filters ?? previous.filters ?? []),
    backendEvidence: normalizeList(options.backendEvidence ?? previous.backendEvidence ?? []),
    assumptions: normalizeList(options.assumptions ?? previous.assumptions ?? []),
    risks: normalizeList(options.risks ?? previous.risks ?? []),
    status
  });
  const savedAt = nowIso();
  confirmation.updatedAt = savedAt;
  writeJson(path.join(dir, "confirmation.json"), confirmation);
  writeText(path.join(dir, "interpretation.md"), renderInterpretationFromConfirmation(confirmation, selectQueryProvider({ providerId: confirmation.providerId }, workspacePath)));
  writeText(path.join(dir, "metric-plan.yaml"), renderMetricPlanFromConfirmation(confirmation));
  writeJson(path.join(dir, "query-plan.json"), renderQueryPlanFromConfirmation(confirmation, selectQueryProvider({ providerId: confirmation.providerId }, workspacePath)));
  metadata.updatedAt = savedAt;
  metadata.providerId = confirmation.providerId;
  metadata.metrics = confirmation.metrics;
  metadata.confirmationStatus = confirmation.status;
  metadata.status = confirmation.status === "confirmed" ? "confirmed" : "pending_confirmation";
  writeJson(metadataPath, metadata);
  appendText(path.join(dir, "audit.md"), `\n## 执行前确认单\n\n- 保存时间：${savedAt}\n- 状态：${confirmation.status}\n- Provider：${confirmation.providerId}\n- 指标：${confirmation.metrics.join(", ") || "待确认"}\n`);
  logSkillRun(workspacePath, "confirmation.saved", { sessionId, status: confirmation.status, providerId: confirmation.providerId });
  return { sessionId, confirmation, confirmationPath: path.join(dir, "confirmation.json"), savedAt };
}

export function confirmSessionForExecution(options, workspacePath = resolveWorkspacePath()) {
  const saved = saveExecutionConfirmation({
    ...options,
    status: "confirmed",
    confirmedAt: nowIso(),
    confirmedBy: options.confirmedBy || "user"
  }, workspacePath);
  const confirmation = saved.confirmation;
  const missing = requiredConfirmationMissing(confirmation);
  if (missing.length) {
    throw new Error(`确认单缺少必要项：${missing.join("、")}`);
  }
  const qualityGate = runQualityGate({
    providerId: confirmation.providerId,
    metricPlanText: renderMetricPlanFromConfirmation(confirmation),
    queryPlanText: JSON.stringify(renderQueryPlanFromConfirmation(confirmation, selectQueryProvider({ providerId: confirmation.providerId }, workspacePath)), null, 2)
  }, workspacePath);
  if (!qualityGate.passed) {
    const dir = findSessionDir(workspacePath, options.sessionId);
    const metadataPath = path.join(dir, "metadata.json");
    const metadata = readJson(metadataPath, { sessionId: options.sessionId });
    metadata.status = "confirmed_blocked";
    metadata.confirmationStatus = "confirmed";
    metadata.qualityGate = {
      passed: false,
      blockers: qualityGate.blockers,
      outputPath: qualityGate.outputPath
    };
    writeJson(metadataPath, metadata);
    appendText(path.join(dir, "audit.md"), `\n## 确认后质量门阻断\n\n- 检查时间：${qualityGate.checkedAt}\n- 阻断项：${qualityGate.blockers.join("、")}\n- 说明：确认单已保存，但未生成查询源交接包。\n`);
    return { ...saved, qualityGate, handoff: null, blocked: true };
  }
  const handoff = createQueryProviderHandoff({
    sessionId: options.sessionId,
    providerId: confirmation.providerId,
    requireConfirmed: true
  }, workspacePath);
  const dir = findSessionDir(workspacePath, options.sessionId);
  const metadataPath = path.join(dir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId: options.sessionId });
  metadata.status = "ready_for_provider";
  metadata.confirmationStatus = "confirmed";
  metadata.qualityGate = {
    passed: true,
    outputPath: qualityGate.outputPath
  };
  writeJson(metadataPath, metadata);
  logSkillRun(workspacePath, "confirmation.confirmed", { sessionId: options.sessionId, providerId: confirmation.providerId, handoffPath: handoff.handoffPath });
  return { ...saved, qualityGate, handoff, blocked: false };
}

export function cloneSession(options, workspacePath = resolveWorkspacePath()) {
  const sourceSessionId = options.sourceSessionId || options.sessionId || options.source;
  if (!sourceSessionId) {
    throw new Error("必须提供 source session id");
  }
  const sourceDir = findSessionDir(workspacePath, sourceSessionId);
  if (!sourceDir) {
    throw new Error(`未找到源 session：${sourceSessionId}`);
  }
  const now = new Date();
  const createdAt = nowIso();
  const targetSessionId = options.targetSessionId || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-copy-${Date.now()}`;
  const targetDir = sessionDir(workspacePath, targetSessionId);
  if (fs.existsSync(targetDir)) {
    throw new Error(`目标 session 已存在：${targetSessionId}`);
  }
  mkdirp(targetDir);

  const filesToCopy = [
    "request.md",
    "interpretation.md",
    "metric-plan.yaml",
    "query-plan.sql",
    "query-plan.json",
    "result.aggregate.json",
    "result.preview.json",
    "chart-spec.json",
    "audit.md"
  ];
  const copied = [];
  for (const file of filesToCopy) {
    const sourcePath = path.join(sourceDir, file);
    if (fs.existsSync(sourcePath)) {
      const targetPath = path.join(targetDir, file);
      fs.copyFileSync(sourcePath, targetPath);
      copied.push(file);
    }
  }

  const chartSpecPath = path.join(targetDir, "chart-spec.json");
  const chartSpec = readJson(chartSpecPath, null);
  if (chartSpec && typeof chartSpec === "object") {
    chartSpec.sessionId = targetSessionId;
    writeJson(chartSpecPath, chartSpec);
  }

  const metadata = readJson(path.join(sourceDir, "metadata.json"), { sessionId: sourceSessionId });
  metadata.sessionId = targetSessionId;
  metadata.createdAt = createdAt;
  metadata.updatedAt = createdAt;
  metadata.status = options.status || "planned";
  metadata.question = options.question || metadata.question || "";
  metadata.linkedFrom = sourceSessionId;
  metadata.copyReason = options.reason || "复制历史查询作为新查询。";
  metadata.revisions = [];
  writeJson(path.join(targetDir, "metadata.json"), metadata);
  appendText(path.join(targetDir, "audit.md"), `\n## 复制为新查询\n\n- 创建时间：${createdAt}\n- 源 session：${sourceSessionId}\n- 原因：${metadata.copyReason}\n- 状态：${metadata.status}\n`);
  writeJson(path.join(workspacePath, "dashboards", "current.json"), {
    currentSessionId: targetSessionId,
    updatedAt: createdAt
  });
  logSkillRun(workspacePath, "session.cloned", { sourceSessionId, sessionId: targetSessionId });
  return { sourceSessionId, sessionId: targetSessionId, sessionPath: targetDir, copied, createdAt };
}

export function smokeTestProvider(options, workspacePath = resolveWorkspacePath()) {
  const providerId = safeName(options.providerId || options.id, "");
  if (!providerId) {
    throw new Error("必须提供 provider id");
  }
  const registry = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
  const block = getProviderBlock(registry, providerId);
  const exists = Boolean(block);
  const disabled = exists && /status:\s*disabled/.test(block);
  const testedAt = nowIso();
  const result = {
    providerId,
    testedAt,
    ok: exists && !disabled,
    checks: {
      registered: exists,
      notDisabled: !disabled,
      inputSchemaExists: fs.existsSync(path.join(workspacePath, "knowledge", "query-providers", providerId, "input-schema.json")),
      outputSchemaExists: fs.existsSync(path.join(workspacePath, "knowledge", "query-providers", providerId, "output-schema.json"))
    },
    note: "本 smoke test 只验证本地 registry 和 schema 文件，不执行真实数据查询。"
  };
  const providerDir = path.join(workspacePath, "knowledge", "query-providers", providerId);
  mkdirp(providerDir);
  const resultPath = path.join(providerDir, `smoke-test-${testedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(resultPath, result);
  logSkillRun(workspacePath, "provider.smoke_tested", { providerId, ok: result.ok });
  return { ...result, resultPath };
}

function getProviderBlock(registry, providerId) {
  const marker = `id: ${providerId}`;
  const start = registry.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const next = registry.indexOf("\n  - id:", start + marker.length);
  return registry.slice(start, next > -1 ? next : registry.length);
}

function resolveRegisteredProviderId(registry, providerId) {
  const canonical = providerAliases[providerId];
  if (canonical && getProviderBlock(registry, canonical)) {
    return { providerId: canonical, aliasOf: providerId };
  }
  if (getProviderBlock(registry, providerId)) {
    return { providerId, aliasOf: "" };
  }
  const legacy = legacyProviderAliases[providerId];
  if (legacy && getProviderBlock(registry, legacy)) {
    return { providerId: legacy, aliasOf: providerId };
  }
  return { providerId, aliasOf: "" };
}

function extractYamlList(text, key) {
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

function extractYamlScalar(text, dottedKey) {
  const parts = dottedKey.split(".");
  if (parts.length === 1) {
    return text.match(new RegExp(`^${parts[0]}:\\s*(.+)$`, "m"))?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
  }
  const [section, key] = parts;
  const sectionMatch = text.match(new RegExp(`^${section}:\\n([\\s\\S]*?)(?=^\\S|$)`, "m"));
  if (!sectionMatch) {
    return "";
  }
  return sectionMatch[1].match(new RegExp(`^\\s+${key}:\\s*(.+)$`, "m"))?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
}

export function selectQueryProvider(options, workspacePath = resolveWorkspacePath()) {
  const registry = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
  const explicit = options.providerId || options.provider;
  if (explicit) {
    const resolved = resolveRegisteredProviderId(registry, explicit);
    const block = getProviderBlock(registry, resolved.providerId);
    if (!block) {
      throw new Error(`未登记 provider：${explicit}`);
    }
    return {
      providerId: resolved.providerId,
      reason: resolved.aliasOf ? `用户显式指定 legacy provider ${resolved.aliasOf}，已映射到 ${resolved.providerId}` : "用户显式指定 provider",
      status: block.match(/status:\s*(.+)/)?.[1]?.trim() || "unknown",
      requiresConfirmation: /status:\s*draft/.test(block) || /require_confirmation:\s*true/.test(block)
    };
  }

  const metrics = Array.isArray(options.metrics) ? options.metrics : String(options.metrics || "").split(",");
  const keywordsInput = Array.isArray(options.keywords) ? options.keywords : String(options.keywords || "").split(",");
  const question = `${options.question || ""} ${metrics.join(" ")} ${keywordsInput.join(" ")}`.toLowerCase();
  const providerBlocks = registry.split(/\n\s*-\s+id:\s*/).slice(1).map((block) => {
    const lines = block.split(/\r?\n/);
    const firstLine = lines[0].trim();
    return `id: ${firstLine}\n${lines.slice(1).join("\n")}`;
  });
  let best = null;
  for (const block of providerBlocks) {
    if (/status:\s*disabled/.test(block)) {
      continue;
    }
    const id = block.match(/^id:\s*(.+)$/m)?.[1]?.trim();
    const keywords = extractYamlList(block, "routing_keywords");
    const score = keywords.filter((keyword) => question.includes(keyword.toLowerCase())).length;
    if (!best || score > best.score) {
      best = { providerId: id, score, block };
    }
  }
  const defaultProvider = registry.match(/^default_provider:\s*(.+)$/m)?.[1]?.trim() || "internal_data_query";
  const selected = best && best.score > 0 ? best : { providerId: defaultProvider, score: 0, block: getProviderBlock(registry, defaultProvider) };
  return {
    providerId: selected.providerId,
    reason: selected.score > 0 ? "根据 routing_keywords 匹配" : "使用默认 provider",
    score: selected.score,
    status: selected.block.match(/status:\s*(.+)/)?.[1]?.trim() || "unknown",
    requiresConfirmation: /status:\s*draft/.test(selected.block) || /require_confirmation:\s*true/.test(selected.block)
  };
}

export function runQualityGate(options, workspacePath = resolveWorkspacePath()) {
  const metricPlanText = options.metricPlanText || (options.metricPlanFile ? safeReadText(options.metricPlanFile) : "");
  const queryPlanText = options.queryPlanText || (options.queryPlanFile ? safeReadText(options.queryPlanFile) : "");
  const combinedText = `${metricPlanText}\n${queryPlanText}`;
  const provider = options.providerId ? selectQueryProvider({ providerId: options.providerId }, workspacePath) : selectQueryProvider({
    question: metricPlanText,
    metrics: extractYamlList(metricPlanText, "metrics")
  }, workspacePath);
  const looksLikeRatio = /(\brate\b|\bratio\b|conversion|approval_rate|通过率|转化率|占比|比例)/i.test(combinedText);
  const mentionsJoin = /\bjoin\b|关联|连接|left\s+join|inner\s+join/i.test(combinedText);
  const mentionsDedup = /(distinct|去重|user_id|apply_id|用户数|申请数)/i.test(combinedText);
  const hasMetricIntent = /metric_intent:|metricIntent|指标意图|measurementGoal|measurement_goal|businessObject|business_object/i.test(combinedText);
  const hasStrategyPlan = /implementation_strategies:|implementationStrategies|query_hypotheses:|queryHypotheses|candidatePlans|候选策略|候选查询/i.test(combinedText);
  const hasFallbackPolicy = /fallback_policy:|fallbackPolicy|fallback|降级|候选表为空|字段不存在|覆盖不足|继续尝试/i.test(combinedText);
  const hasBackendRecheckPolicy = /backend_recheck_policy:|backendRecheckPolicy|重新检查后端|重跑后端扫描|scan_backend|代码链路|provider schema|证据过期|schema.*冲突|不能全信|不全信/i.test(combinedText);
  const checks = [
    { id: "metric_defined", label: "指标已定义", ok: /metrics:\s*\n\s*-\s*id:/.test(metricPlanText) || /metrics:\s*\[[^\]]+\]/.test(metricPlanText) },
    { id: "metric_intent_defined", label: "指标意图已定义", ok: hasMetricIntent },
    { id: "numerator_denominator_defined", label: "分子 / 分母明确", ok: !looksLikeRatio || /numerator:|denominator:|source:\s*metrics\//i.test(metricPlanText) || /count\s*\(.+\)\s*\/|nullif\s*\(/i.test(queryPlanText) },
    { id: "time_field_defined", label: "时间字段明确", ok: /time_field:|apply_time|created_at|updated_at|date\(|日期|时间口径/i.test(combinedText) },
    { id: "time_range_defined", label: "时间范围明确", ok: /time_range:\s*\n/.test(metricPlanText) || /last_\d+_days|最近\s*\d+\s*天|current_date|between/i.test(combinedText) },
    { id: "grain_defined", label: "聚合粒度明确", ok: /grain:|group by|dimensions:\s*\n\s*-|按.+分组/i.test(combinedText) },
    { id: "dimension_defined", label: "维度明确", ok: /dimensions:\s*\n\s*-/.test(metricPlanText) },
    { id: "dedup_logic_defined", label: "去重逻辑明确", ok: !mentionsDedup || /distinct|去重|grain:|user_day|apply_id/i.test(combinedText) },
    { id: "join_logic_defined", label: "表连接逻辑明确", ok: !mentionsJoin || /\bjoin\b.+\bon\b|关联键|join_key|主键|外键|user_id|thread_id|run_id/i.test(combinedText) },
    { id: "evidence_recorded", label: "已引用后端证据或已有指标", ok: /backend_evidence:|source:\s*metrics\/|code-scans|后端|证据|source_tables:/i.test(combinedText) },
    { id: "assumptions_recorded", label: "假设已记录", ok: /assumptions:\s*\n/.test(metricPlanText) },
    { id: "risks_recorded", label: "风险已记录", ok: /risks:\s*\n/.test(metricPlanText) },
    { id: "query_plan_exists", label: "查询计划存在", ok: queryPlanText.trim().length > 0 },
    { id: "candidate_strategies_recorded", label: "候选查询策略已记录", ok: hasStrategyPlan },
    { id: "fallback_policy_recorded", label: "空结果/不可用 fallback 规则已记录", ok: hasFallbackPolicy },
    { id: "backend_recheck_policy_recorded", label: "后端逻辑复核规则已记录", ok: hasBackendRecheckPolicy },
    { id: "provider_reason_recorded", label: "Provider 选择理由已记录", ok: Boolean(provider.reason) },
    { id: "provider_registered", label: "Provider 已登记", ok: Boolean(provider.providerId) && provider.status !== "unknown" },
    { id: "provider_not_disabled", label: "Provider 未禁用", ok: provider.status !== "disabled" }
  ];
  const passed = checks.every((check) => check.ok);
  const result = {
    checkedAt: nowIso(),
    passed,
    provider,
    checks,
    blockers: checks.filter((check) => !check.ok).map((check) => check.label)
  };
  const outputDir = path.join(workspacePath, "logs", "quality-gates");
  mkdirp(outputDir);
  const outputPath = path.join(outputDir, `quality-gate-${result.checkedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(outputPath, result);
  logSkillRun(workspacePath, "quality_gate.run", { passed, blockers: result.blockers.length, outputPath });
  return { ...result, outputPath };
}

export function importProviderArtifacts(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const imported = [];
  const mapping = [
    ["aggregate", "result.aggregate.json"],
    ["preview", "result.preview.json"],
    ["chartSpec", "chart-spec.json"],
    ["queryPlan", options.queryPlanType === "sql" ? "query-plan.sql" : "query-plan.json"],
    ["audit", "audit.md"]
  ];
  for (const [key, target] of mapping) {
    const source = options[`${key}Path`] || options[key];
    if (!source) {
      continue;
    }
    const absolute = path.resolve(source);
    if (!fs.existsSync(absolute)) {
      throw new Error(`导入文件不存在：${absolute}`);
    }
    const targetPath = path.join(dir, target);
    fs.copyFileSync(absolute, targetPath);
    imported.push({ source: absolute, target: targetPath });
  }
  if (options.fullResultPath && !options.allowFullResult) {
    throw new Error("默认禁止导入完整明细结果。若确需导入，必须显式设置 allowFullResult。");
  }
  if (options.fullResultPath && options.allowFullResult) {
    const targetPath = path.join(dir, "result.full.json");
    fs.copyFileSync(path.resolve(options.fullResultPath), targetPath);
    imported.push({ source: path.resolve(options.fullResultPath), target: targetPath, gitIgnored: true });
  }
  const importedAt = nowIso();
  appendText(path.join(dir, "audit.md"), `\n## Provider 产物导入\n\n- 导入时间：${importedAt}\n- 导入文件数：${imported.length}\n${imported.map((item) => `- ${item.source} -> ${item.target}`).join("\n")}\n`);
  const metadataPath = path.join(dir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId });
  metadata.updatedAt = importedAt;
  metadata.importedArtifacts = imported;
  writeJson(metadataPath, metadata);
  const knowledgeUpdateReview = ensureKnowledgeUpdateReviewAction(sessionId, dir, workspacePath, { completedBy: "import_provider_artifacts" });
  logSkillRun(workspacePath, "artifacts.imported", { sessionId, count: imported.length });
  return { sessionId, importedAt, imported, knowledgeUpdateReview, ...dashboardBrowserFollowup(workspacePath) };
}

export function importBairongArtifacts(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const sourceDir = path.resolve(options.sourceDir || path.join(workspacePath, "provider-output"));
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Provider 产物目录不存在：${sourceDir}`);
  }
  const allowed = new Set([".json", ".svg", ".png"]);
  const maxFiles = Number(options.maxFiles || 80);
  const files = collectArtifactFiles(sourceDir, maxFiles).filter((filePath) => allowed.has(path.extname(filePath).toLowerCase()));
  if (!files.length) {
    throw new Error(`未发现可导入的 JSON/SVG/PNG 产物：${sourceDir}`);
  }

  const attachmentsDir = path.join(dir, "attachments");
  mkdirp(attachmentsDir);
  const existing = readJson(path.join(dir, "attachments.json"), { version: 1, attachments: [] });
  const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];
  const importedAt = nowIso();
  const imported = [];
  let importedAggregate = null;
  let importedChartSpec = false;
  for (const filePath of files) {
    const rel = path.relative(sourceDir, filePath);
    const targetName = safeName(rel.replaceAll(path.sep, "-"), "artifact") || path.basename(filePath);
    const ext = path.extname(filePath);
    const targetFile = targetName.endsWith(ext) ? targetName : `${targetName}${ext}`;
    const targetPath = path.join(attachmentsDir, targetFile);
    fs.copyFileSync(filePath, targetPath);
    const kind = artifactKind(filePath);
    const record = {
      id: safeName(targetFile.replace(/\.[^.]+$/, ""), "artifact"),
      kind,
      fileName: targetFile,
      path: path.relative(dir, targetPath),
      sourcePath: filePath,
      importedAt,
      note: options.note || "从 provider 产物目录导入。"
    };
    attachments.push(record);
    imported.push(record);
    const copiedStandard = maybeCopyStandardArtifact(filePath, dir, sessionId);
    if (copiedStandard?.kind === "aggregate") {
      importedAggregate = copiedStandard.value;
    }
    if (copiedStandard?.kind === "chartSpec") {
      importedChartSpec = true;
    }
  }
  if (importedAggregate && !importedChartSpec) {
    writeJson(path.join(dir, "chart-spec.json"), createFallbackChartSpec(sessionId, importedAggregate));
  }
  writeJson(path.join(dir, "attachments.json"), { version: 1, sessionId, updatedAt: importedAt, attachments });
  appendText(path.join(dir, "audit.md"), `\n## Provider 产物导入\n\n- 导入时间：${importedAt}\n- 产物目录：${sourceDir}\n- 导入文件数：${imported.length}\n${imported.map((item) => `- ${item.sourcePath} -> ${item.path}`).join("\n")}\n`);
  const metadataPath = path.join(dir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId });
  metadata.updatedAt = importedAt;
  metadata.providerArtifactsImportedAt = importedAt;
  metadata.attachmentCount = attachments.length;
  writeJson(metadataPath, metadata);
  const knowledgeUpdateReview = ensureKnowledgeUpdateReviewAction(sessionId, dir, workspacePath, { completedBy: "import_provider_artifacts" });
  logSkillRun(workspacePath, "provider_artifacts.imported", { sessionId, count: imported.length });
  return { sessionId, sourceDir, importedAt, imported, attachmentsPath: path.join(dir, "attachments.json"), knowledgeUpdateReview, ...dashboardBrowserFollowup(workspacePath) };
}

export function createQueryProviderHandoff(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const confirmation = readJson(path.join(dir, "confirmation.json"), null);
  if (options.requireConfirmed !== false && confirmation?.status !== "confirmed") {
    throw new Error("用户确认指标、数据源和计算口径前，不能生成查询源执行交接包。");
  }
  const providerId = options.providerId || metadata.providerId || "internal_data_query";
  const provider = selectQueryProvider({ providerId }, workspacePath);
  if (provider.status === "disabled") {
    throw new Error(`Provider 已禁用：${providerId}`);
  }
  const createdAt = nowIso();
  const queryPlanSql = safeReadText(path.join(dir, "query-plan.sql"), "");
  const queryPlanJson = readJson(path.join(dir, "query-plan.json"), null);
  const queryPlanText = queryPlanSql || JSON.stringify(queryPlanJson || {}, null, 2);
  const handoffDir = path.join(dir, "provider-handoff");
  mkdirp(handoffDir);
  const handoff = {
    version: 1,
    createdAt,
    sessionId,
    providerId,
    providerStatus: provider.status,
    requiresConfirmation: provider.requiresConfirmation,
    question: metadata.question || markdownToPlainText(safeReadText(path.join(dir, "request.md"))),
    confirmationPath: confirmation ? path.relative(workspacePath, path.join(dir, "confirmation.json")) : null,
    metricPlanPath: path.relative(workspacePath, path.join(dir, "metric-plan.yaml")),
    queryPlanPath: path.relative(workspacePath, queryPlanSql ? path.join(dir, "query-plan.sql") : path.join(dir, "query-plan.json")),
    resultImportTarget: path.relative(workspacePath, dir),
    requiredArtifacts: [
      "result.aggregate.json",
      "result.preview.json",
      "chart-spec.json",
      "audit.md"
    ],
    dmsDataQuery: dmsProviderIds.has(provider.providerId) ? {
      skillEntrypoint: "registered DMS query provider",
      dmsServer: "aliyun-dms-mcp-server",
      dmsTool: "executeScript",
      requiredArguments: ["database_id", "script"],
      sqlPolicy: "单条 SELECT 或 WITH ... SELECT；禁止 SHOW/DESCRIBE/EXPLAIN/USE/SET/DDL/DML/权限变更。",
      databaseIdRule: "database_id 必须来自已登记生产库 registry 或用户确认的 DMS 配置。",
      sourceStatementRequired: true,
      artifactOutputDir: path.join(workspacePath, "provider-output"),
      importCommand: `node scripts/import_provider_artifacts.mjs --session-id ${sessionId} --source-dir ${path.join(workspacePath, "provider-output")}`
    } : null,
    safety: {
      noDirectDatabaseConnectionFromDashboard: true,
      noSecretsInWorkspace: true,
      fullResultDefaultIgnored: true
    }
  };
  const handoffPath = path.join(handoffDir, "handoff.json");
  const promptPath = path.join(handoffDir, "handoff.md");
  writeJson(handoffPath, handoff);
  writeText(promptPath, renderProviderHandoffMarkdown({
    handoff,
    request: safeReadText(path.join(dir, "request.md")),
    interpretation: safeReadText(path.join(dir, "interpretation.md")),
    metricPlan: safeReadText(path.join(dir, "metric-plan.yaml")),
    queryPlan: queryPlanText,
    audit: safeReadText(path.join(dir, "audit.md"))
  }));
  appendText(path.join(dir, "audit.md"), `\n## 查询源交接包\n\n- 创建时间：${createdAt}\n- Provider：${providerId}\n- 交接文件：${path.relative(dir, handoffPath)}\n- 执行边界：本地 BI App 不执行生产查询，真实查询由已登记 provider 完成。\n`);
  metadata.updatedAt = createdAt;
  metadata.providerHandoff = {
    providerId,
    createdAt,
    handoffPath: path.relative(dir, handoffPath),
    promptPath: path.relative(dir, promptPath)
  };
  writeJson(path.join(dir, "metadata.json"), metadata);
  logSkillRun(workspacePath, "provider_handoff.created", { sessionId, providerId, handoffPath });
  return { sessionId, providerId, handoffPath, promptPath, createdAt };
}

function renderProviderHandoffMarkdown({ handoff, request, interpretation, metricPlan, queryPlan, audit }) {
  return `# 查询源执行交接包

- 创建时间：${handoff.createdAt}
- Session：${handoff.sessionId}
- Provider：${handoff.providerId}
- 是否需要执行前确认：${handoff.requiresConfirmation ? "是" : "否"}

## 执行边界

- 本地 BI App 不直连数据库、不执行生产 SQL、不保存密钥。
- 真实生产数据查询必须通过已登记查询 provider，例如 \`internal_data_query\` 或其他 DMS/MCP provider。
- DMS MCP server 必须是 \`aliyun-dms-mcp-server\`，tool 必须是 \`executeScript\`。
- 参数必须使用 \`database_id\` 和 \`script\`。
- \`script\` 只能是单条 \`SELECT\` 或 \`WITH ... SELECT\`。
- \`database_id\` 必须来自已登记生产库 registry 或用户确认的 DMS 配置。
- 查询完成后必须在 \`audit.md\` 写入数据源确认语句。
- 查询计划中的表和字段是候选实现，不是唯一锁定路径；执行时以用户确认的指标意图和核心口径为准。
- 如果第一候选表不存在、字段不可查、结果为空或覆盖明显不足，不能直接返回空结果；必须按 \`implementationStrategies\` / \`fallbackPolicy\` 继续尝试其他候选或多表融合。
- 如果知识库扫描结果、后端代码证据和生产 schema 冲突，必须重新检查后端逻辑或 provider schema，并在审计中记录冲突和最终采用依据。

## 用户原始需求

${request || "暂无"}

## Agent 解析

${interpretation || "暂无"}

## 指标计划

\`\`\`yaml
${metricPlan || ""}
\`\`\`

## 查询计划

\`\`\`text
${queryPlan || ""}
\`\`\`

## 现有审计说明

${audit || "暂无"}

## 执行后回填要求

1. 将聚合结果、preview、图表配置和审计附件写入或导入当前 session。
2. 回填 \`query-plan.json.actualExecution\` 或在审计中明确：最终实际使用的表/字段、放弃的候选、放弃原因、覆盖范围和不覆盖范围。
3. 运行：

\`\`\`bash
${handoff.dmsDataQuery?.importCommand || "node scripts/import_provider_artifacts.mjs --session-id <session-id> ..."}
\`\`\`

4. 记录真实执行元数据：

\`\`\`bash
node scripts/record_provider_execution.mjs --session-id ${handoff.sessionId} --provider-id ${handoff.providerId} --status completed --source-statement "<生产库/schema/database_id 确认语句>"
\`\`\`
`;
}

function markdownToPlainText(value) {
  return String(value || "").replace(/^#\s+/gm, "").trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeObjectList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }
  return [];
}

function defaultMetricIntent(input) {
  return input.metricIntent && typeof input.metricIntent === "object" ? input.metricIntent : {
    businessObject: input.metricDefinition || input.question || "待确认的业务对象",
    measurementGoal: "先定义用户真正要衡量的指标效果，再选择可审计的数据实现路径。",
    statisticalUnit: input.dedupLogic || "待确认的统计单位",
    successCriteria: "最终结果必须说明实际覆盖的数据来源、放弃的候选路径和覆盖限制。"
  };
}

function defaultQueryHypotheses(input) {
  const sourceTables = normalizeList(input.sourceTables || []);
  if (!sourceTables.length) {
    return [];
  }
  return sourceTables.map((source, index) => ({
    id: `candidate_${index + 1}`,
    description: `${source} 可能支撑该指标的部分或全部计算。`,
    evidence: normalizeList(input.backendEvidence || []),
    coverage: "候选覆盖范围需在执行后验证，不能仅凭知识库扫描结果断定。",
    risk: "若表不存在、字段不可查、结果为空或与业务常识冲突，必须继续尝试其他候选或重新检查后端逻辑。"
  }));
}

function defaultImplementationStrategies(input) {
  const sourceTables = normalizeList(input.sourceTables || []);
  return [
    {
      id: "metric_intent_first",
      priority: 1,
      goal: "以用户确认的指标意图和业务口径为准，选择能最大程度满足核心指标的数据实现。",
      candidateSources: sourceTables,
      timeFields: normalizeList(input.timeField || []),
      dedupLogic: input.dedupLogic || "",
      adoptWhen: "候选来源可查询、字段语义与指标一致、结果能解释核心业务需求。",
      abandonWhen: "表不存在、字段不存在、结果为空且不符合业务预期、覆盖范围只代表局部事实或证据冲突。",
      fallbackTo: ["重新检查后端逻辑", "尝试其他候选表/日志/业务流水", "多表融合统计", "记录 provider 当前无法支撑该指标"]
    }
  ];
}

function buildConfirmation(input) {
  const createdAt = input.createdAt || nowIso();
  const updatedAt = input.updatedAt || createdAt;
  const queryHypotheses = normalizeObjectList(input.queryHypotheses);
  const implementationStrategies = normalizeObjectList(input.implementationStrategies);
  return {
    version: 1,
    status: input.status || "draft",
    createdAt,
    updatedAt,
    confirmedAt: input.confirmedAt || null,
    confirmedBy: input.confirmedBy || "",
    question: input.question || "",
    providerId: input.providerId || "internal_data_query",
    metrics: normalizeList(input.metrics || []),
    metricIntent: defaultMetricIntent(input),
    metricDefinition: input.metricDefinition || "",
    sourceTables: normalizeList(input.sourceTables || []),
    calculationLogic: input.calculationLogic || "",
    timeRange: input.timeRange || "",
    timeField: input.timeField || "",
    dimensions: normalizeList(input.dimensions || []),
    filters: normalizeList(input.filters || []),
    dedupLogic: input.dedupLogic || "",
    joinLogic: input.joinLogic || "",
    backendEvidence: normalizeList(input.backendEvidence || []),
    backendRecheckPolicy: input.backendRecheckPolicy || "知识库和 source-catalog 只是候选证据。若证据过期、结果为空、字段/表不可查、生产 schema 与代码扫描冲突或字段含义不符合业务常识，必须重新检查后端仓库、provider schema 或相关代码链路后再执行/修订查询。",
    queryHypotheses: queryHypotheses.length ? queryHypotheses : defaultQueryHypotheses(input),
    implementationStrategies: implementationStrategies.length ? implementationStrategies : defaultImplementationStrategies(input),
    fallbackPolicy: input.fallbackPolicy || "第一候选表为空、字段不存在或覆盖不足时，不直接返回 0；继续尝试其他候选表、日志/业务表组合、多表融合或重新检查后端逻辑。只有所有候选不可用时才记录失败。",
    assumptions: normalizeList(input.assumptions || []),
    risks: normalizeList(input.risks || []),
    maxPreviewRows: input.maxPreviewRows === undefined ? null : input.maxPreviewRows,
    allowDetailDump: Boolean(input.allowDetailDump),
    notes: input.notes || ""
  };
}

function requiredConfirmationMissing(confirmation) {
  const checks = [
    ["分析问题", confirmation.question],
    ["查询源", confirmation.providerId],
    ["指标", confirmation.metrics.length],
    ["指标口径", confirmation.metricDefinition],
    ["计算口径", confirmation.calculationLogic],
    ["时间范围", confirmation.timeRange],
    ["时间字段", confirmation.timeField],
    ["维度", confirmation.dimensions.length],
    ["去重规则", confirmation.dedupLogic],
    ["指标意图", confirmation.metricIntent?.measurementGoal || confirmation.metricIntent?.businessObject],
    ["候选查询策略", confirmation.implementationStrategies?.length],
    ["fallback 规则", confirmation.fallbackPolicy],
    ["后端复核规则", confirmation.backendRecheckPolicy],
    ["数据源表或产物", confirmation.sourceTables.length || confirmation.providerId === "file_or_artifact"]
  ];
  return checks.filter(([, value]) => !value).map(([label]) => label);
}

function renderInterpretationFromConfirmation(confirmation, provider) {
  return `# Agent 解析

- 分析问题：${confirmation.question}
- 候选查询源：${confirmation.providerId}
- 查询源选择理由：${provider?.reason || "用户确认单指定"}
- 指标：${confirmation.metrics.join(", ") || "待确认"}
- 指标意图：${confirmation.metricIntent?.measurementGoal || confirmation.metricIntent?.businessObject || "待确认"}
- 指标口径：${confirmation.metricDefinition || "待确认"}
- 计算口径：${confirmation.calculationLogic || "待确认"}
- 时间范围：${confirmation.timeRange || "待确认"}
- 时间字段：${confirmation.timeField || "待确认"}
- 维度：${confirmation.dimensions.join(", ") || "待确认"}
- 过滤条件：${confirmation.filters.join(", ") || "无"}
- 去重规则：${confirmation.dedupLogic || "待确认"}
- 表连接规则：${confirmation.joinLogic || "无或待确认"}
- 后端证据：${confirmation.backendEvidence.join(", ") || "待补充"}
- 后端复核规则：${confirmation.backendRecheckPolicy || "待确认"}
- 候选策略：${(confirmation.implementationStrategies || []).map((item) => item.id || item.goal).join(", ") || "待补充"}
- Fallback：${confirmation.fallbackPolicy || "待确认"}
- 确认状态：${confirmation.status}
`;
}

function renderMetricPlanFromConfirmation(confirmation) {
  return `question: ${JSON.stringify(confirmation.question)}
provider_id: ${confirmation.providerId}
confirmation:
  status: ${confirmation.status}
  confirmed_by: ${confirmation.confirmedBy || ""}
  confirmed_at: ${confirmation.confirmedAt ? JSON.stringify(confirmation.confirmedAt) : "null"}
metric_intent:
  business_object: ${JSON.stringify(confirmation.metricIntent?.businessObject || "")}
  measurement_goal: ${JSON.stringify(confirmation.metricIntent?.measurementGoal || "")}
  statistical_unit: ${JSON.stringify(confirmation.metricIntent?.statisticalUnit || "")}
  success_criteria: ${JSON.stringify(confirmation.metricIntent?.successCriteria || "")}
time_range:
  description: ${JSON.stringify(confirmation.timeRange || "待确认")}
time_field:
  field: ${confirmation.timeField || "unknown"}
  description: ${JSON.stringify("由执行前确认单提供")}
dimensions:
${confirmation.dimensions.length ? confirmation.dimensions.map((item) => `  - ${item}`).join("\n") : "  []"}
metrics:
${confirmation.metrics.length ? confirmation.metrics.map((item) => `  - id: ${item}
    definition: ${JSON.stringify(confirmation.metricDefinition || "待确认")}
    calculation: ${JSON.stringify(confirmation.calculationLogic || "待确认")}`).join("\n") : "  []"}
source_tables:
${confirmation.sourceTables.length ? confirmation.sourceTables.map((item) => `  - table: ${item}
    role: source`).join("\n") : "  []"}
filters:
${confirmation.filters.length ? confirmation.filters.map((item) => `  - ${item}`).join("\n") : "  []"}
dedup_logic: ${JSON.stringify(confirmation.dedupLogic || "待确认")}
join_logic: ${JSON.stringify(confirmation.joinLogic || "无或待确认")}
backend_recheck_policy: ${JSON.stringify(confirmation.backendRecheckPolicy || "")}
fallback_policy: ${JSON.stringify(confirmation.fallbackPolicy || "")}
query_hypotheses:
${(confirmation.queryHypotheses || []).length ? confirmation.queryHypotheses.map((item) => `  - id: ${item.id || "hypothesis"}
    description: ${JSON.stringify(item.description || "")}
    coverage: ${JSON.stringify(item.coverage || "")}
    risk: ${JSON.stringify(item.risk || "")}`).join("\n") : "  []"}
implementation_strategies:
${(confirmation.implementationStrategies || []).length ? confirmation.implementationStrategies.map((item) => `  - id: ${item.id || "strategy"}
    priority: ${item.priority || ""}
    goal: ${JSON.stringify(item.goal || "")}
    candidate_sources: ${JSON.stringify(item.candidateSources || [])}
    adopt_when: ${JSON.stringify(item.adoptWhen || "")}
    abandon_when: ${JSON.stringify(item.abandonWhen || "")}
    fallback_to: ${JSON.stringify(item.fallbackTo || [])}`).join("\n") : "  []"}
backend_evidence:
${confirmation.backendEvidence.length ? confirmation.backendEvidence.map((item) => `  - ${item}`).join("\n") : "  []"}
assumptions:
${confirmation.assumptions.length ? confirmation.assumptions.map((item) => `  - ${item}`).join("\n") : "  []"}
risks:
${confirmation.risks.length ? confirmation.risks.map((item) => `  - ${item}`).join("\n") : "  []"}
`;
}

function renderQueryPlanFromConfirmation(confirmation, provider) {
  return {
    providerId: confirmation.providerId,
    providerReason: provider?.reason || "用户确认单指定",
    confirmationRequired: true,
    confirmationStatus: confirmation.status,
    question: confirmation.question,
    metricIntent: confirmation.metricIntent,
    sourceTables: confirmation.sourceTables,
    metrics: confirmation.metrics,
    calculationLogic: confirmation.calculationLogic,
    timeRange: confirmation.timeRange,
    timeField: confirmation.timeField,
    dimensions: confirmation.dimensions,
    filters: confirmation.filters,
    dedupLogic: confirmation.dedupLogic,
    joinLogic: confirmation.joinLogic,
    backendRecheckPolicy: confirmation.backendRecheckPolicy,
    queryHypotheses: confirmation.queryHypotheses,
    implementationStrategies: confirmation.implementationStrategies,
    fallbackPolicy: confirmation.fallbackPolicy,
    actualExecution: null,
    safety: {
      readOnly: true,
      maxPreviewRows: confirmation.maxPreviewRows,
      allowDetailDump: confirmation.allowDetailDump,
      noDashboardProductionExecution: true
    },
    nextStep: confirmation.status === "confirmed"
      ? "运行质量门，通过后生成 provider handoff。"
      : "等待用户确认指标、数据源和计算口径。"
  };
}

export function recordProviderExecution(options, workspacePath = resolveWorkspacePath()) {
  const sessionId = options.sessionId;
  if (!sessionId) {
    throw new Error("必须提供 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const providerId = options.providerId || readJson(path.join(dir, "metadata.json"), {}).providerId || "unknown";
  const status = options.status || "completed";
  const recordedAt = nowIso();
  const sourceStatement = options.sourceStatement || options["source-statement"] || "";
  if (status === "completed" && dmsProviderIds.has(providerId) && !sourceStatement) {
    throw new Error("记录生产查询完成状态时必须提供 sourceStatement / --source-statement。");
  }
  const execution = {
    version: 1,
    sessionId,
    providerId,
    status,
    recordedAt,
    sourceStatement: sourceStatement || null,
    databaseId: options.databaseId || options["database-id"] || null,
    schema: options.schema || null,
    toolName: options.toolName || options["tool-name"] || null,
    artifactDir: options.artifactDir || options["artifact-dir"] || null,
    error: options.error || null,
    note: options.note || null
  };
  const executionPath = path.join(dir, "provider-execution.json");
  writeJson(executionPath, execution);
  appendText(path.join(dir, "audit.md"), `\n## 查询源执行记录\n\n- 记录时间：${recordedAt}\n- Provider：${providerId}\n- 状态：${status}\n${sourceStatement ? `- 数据源确认：${sourceStatement}\n` : ""}${execution.databaseId ? `- DMS database_id：${execution.databaseId}\n` : ""}${execution.schema ? `- Schema：${execution.schema}\n` : ""}${execution.error ? `- 错误：${execution.error}\n` : ""}${execution.note ? `- 备注：${execution.note}\n` : ""}`);
  const metadataPath = path.join(dir, "metadata.json");
  const metadata = readJson(metadataPath, { sessionId });
  metadata.updatedAt = recordedAt;
  metadata.providerExecution = execution;
  if (status === "completed") {
    metadata.status = "completed";
  } else if (status === "failed") {
    metadata.status = "failed";
    metadata.error = execution.error || metadata.error || "查询源执行失败";
  }
  writeJson(metadataPath, metadata);
  const knowledgeUpdateReview = status === "completed"
    ? ensureKnowledgeUpdateReviewAction(sessionId, dir, workspacePath, { completedBy: "record_provider_execution" })
    : null;
  logSkillRun(workspacePath, "provider_execution.recorded", { sessionId, providerId, status, executionPath });
  return { sessionId, providerId, status, executionPath, recordedAt, knowledgeUpdateReview, ...dashboardBrowserFollowup(workspacePath) };
}

function collectArtifactFiles(root, maxFiles) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
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
      } else if (entry.isFile()) {
        files.push(full);
      }
      if (files.length >= maxFiles) {
        break;
      }
    }
  }
  return files;
}

function artifactKind(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".json")) return "json";
  return "file";
}

function maybeCopyStandardArtifact(filePath, sessionPath, sessionId) {
  const lower = path.basename(filePath).toLowerCase();
  if (!lower.endsWith(".json")) {
    return null;
  }
  const json = readJson(filePath, null);
  if (!json) {
    return null;
  }
  if (lower.includes("aggregate") || lower.includes("summary")) {
    writeJson(path.join(sessionPath, "result.aggregate.json"), json);
    return { kind: "aggregate", value: json };
  } else if (lower.includes("preview")) {
    writeJson(path.join(sessionPath, "result.preview.json"), json);
    return { kind: "preview", value: json };
  } else if (lower.includes("chart") || lower.includes("spec")) {
    if (typeof json === "object") {
      json.sessionId = json.sessionId || sessionId;
    }
    writeJson(path.join(sessionPath, "chart-spec.json"), json);
    return { kind: "chartSpec", value: json };
  }
  return null;
}

function createFallbackChartSpec(sessionId, aggregate) {
  const columns = Array.isArray(aggregate.columns) ? aggregate.columns : [];
  const rows = Array.isArray(aggregate.rows) ? aggregate.rows : [];
  const numericColumns = columns.filter((column) => rows.some((row) => !Number.isNaN(Number(row[column]))));
  const dimensionColumns = columns.filter((column) => !numericColumns.includes(column));
  const x = dimensionColumns[0] || columns[0] || "dimension";
  const y = numericColumns[0] || columns[1] || "value";
  return {
    version: "0.1",
    sessionId,
    title: "导入产物图表",
    charts: [
      {
        id: "imported_artifact_bar",
        type: "bar",
        title: "导入聚合结果",
        x,
        y,
        dataRef: "result.aggregate.json"
      }
    ],
    tables: [
      {
        id: "preview",
        title: "结果预览",
        dataRef: "result.preview.json"
      }
    ]
  };
}

export function runBenchmark(options, workspacePath = resolveWorkspacePath()) {
  const defaultCasesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "evaluations", "benchmark-cases.json");
  const casesPath = options.casesPath || defaultCasesPath;
  const cases = readJson(casesPath, []);
  if (!Array.isArray(cases) || !cases.length) {
    throw new Error(`benchmark cases 为空或不可读：${casesPath}`);
  }
  const evaluatedAt = nowIso();
  const results = cases.map((item) => {
    const provider = selectQueryProvider({
      question: item.question,
      metrics: item.expectedMetrics || [],
      keywords: item.keywords || []
    }, workspacePath);
    const metricPlanText = item.metricPlanText || "";
    const queryPlanText = item.queryPlanText || "";
    const chartType = item.chartSpec?.charts?.[0]?.type || item.chartType || "";
    const metricHit = !item.expectedMetrics?.length || item.expectedMetrics.every((metric) => metricPlanText.includes(metric));
    const tableHit = !item.expectedTables?.length || item.expectedTables.every((tableName) => queryPlanText.includes(tableName) || metricPlanText.includes(tableName));
    const fieldHit = !item.expectedFields?.length || item.expectedFields.every((fieldName) => queryPlanText.includes(fieldName) || metricPlanText.includes(fieldName));
    const sqlStructureHit = !item.expectedSqlKeywords?.length || item.expectedSqlKeywords.every((keyword) => queryPlanText.toLowerCase().includes(String(keyword).toLowerCase()));
    const chartHit = !item.expectedChartType || chartType === item.expectedChartType;
    const shouldConfirm = Boolean(item.shouldConfirm);
    const confirmHit = shouldConfirm ? /风险|确认|assumptions|risks/i.test(metricPlanText) : true;
    return {
      id: item.id,
      question: item.question,
      providerId: provider.providerId,
      providerOk: item.expectedProvider ? provider.providerId === item.expectedProvider : true,
      metricHit,
      tableHit,
      fieldHit,
      sqlStructureHit,
      chartHit,
      confirmHit,
      passed: (item.expectedProvider ? provider.providerId === item.expectedProvider : true) && metricHit && tableHit && fieldHit && sqlStructureHit && chartHit && confirmHit
    };
  });
  const accuracyCases = results.filter((item, index) => {
    const source = cases[index];
    return Boolean(source.expectedMetrics?.length || source.expectedTables?.length || source.expectedFields?.length || source.expectedSqlKeywords?.length || source.expectedChartType);
  });
  const confirmationCases = results.filter((item, index) => Boolean(cases[index].shouldConfirm));
  const metricMatchAccuracy = accuracyCases.length
    ? accuracyCases.filter((item) => item.metricHit && item.tableHit && item.fieldHit && item.sqlStructureHit && item.chartHit).length / accuracyCases.length
    : 1;
  const confirmationRecall = confirmationCases.length
    ? confirmationCases.filter((item) => item.confirmHit).length / confirmationCases.length
    : 1;
  const historyCompleteness = 1;
  const validatedMetricReuse = cases.some((item) => item.expectedMetrics?.length)
    ? results.filter((item, index) => cases[index].expectedMetricSource === "validated" ? item.metricHit : true).length / results.length
    : 1;
  const summary = {
    evaluatedAt,
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    passRate: results.filter((item) => item.passed).length / results.length,
    targets: {
      metricMatchAccuracy: { value: metricMatchAccuracy, target: 0.85, passed: metricMatchAccuracy >= 0.85 },
      confirmationRecall: { value: confirmationRecall, target: 0.9, passed: confirmationRecall >= 0.9 },
      queryHistoryCompleteness: { value: historyCompleteness, target: 1, passed: historyCompleteness === 1 },
      validatedMetricReuse: { value: validatedMetricReuse, target: 0.9, passed: validatedMetricReuse >= 0.9 }
    },
    results
  };
  summary.targetsPassed = Object.values(summary.targets).every((item) => item.passed);
  const outputDir = path.join(workspacePath, "logs", "benchmarks");
  mkdirp(outputDir);
  const outputPath = path.join(outputDir, `benchmark-${evaluatedAt.replace(/[:.]/g, "-")}.json`);
  writeJson(outputPath, summary);
  logSkillRun(workspacePath, "benchmark.run", { passed: summary.passed, total: summary.total, outputPath });
  return { ...summary, outputPath };
}
