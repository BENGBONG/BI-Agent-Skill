#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findSessionDir,
  listSessionIds,
  readJson,
  resolveWorkspacePath,
  safeReadText
} from "../../scripts/lib/workspace.mjs";
import {
  cloneSession,
  compareSessions,
  confirmSessionForExecution,
  createAnalysisSession,
  createFailedSession,
  createRevision,
  getMetricHistory,
  getSharingProfile,
  importBairongArtifacts,
  importProviderArtifacts,
  listPendingActions,
  copyTeamSharedMetricToLocal,
  createAndExecuteShareAction,
  createShareAssetAction,
  createQueryProviderHandoff,
  getSharedMetrics,
  getShareActions,
  getShareTargets,
  registerProvider,
  requestDrillDown,
  recordProviderExecution,
  runBenchmark,
  runQualityGate,
  saveExecutionConfirmation,
  saveSharingProfile,
  saveMetricDefinition,
  scanBackendProject,
  selectQueryProvider,
  smokeTestProvider,
  setCurrentDashboard,
  runShareAction,
  syncTeamSharedMetrics,
  updateKnowledgeFieldsFromQuery
} from "../../scripts/lib/operations.mjs";
import {
  getDingTalkMcpConfigStatus,
  saveDingTalkMcpConfig
} from "../../scripts/lib/share.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const workspacePath = resolveWorkspacePath();
const host = process.env.HOST || "127.0.0.1";
const startPort = Number(process.env.PORT || 3000);

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`${body}\n`);
}

function sendText(res, value, status = 200, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(value);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeSessionId(sessionId) {
  return /^[a-zA-Z0-9._-]+$/.test(sessionId);
}

function safeMetricId(metricId) {
  return /^[a-zA-Z0-9._-]+$/.test(metricId);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function listRevisions(dir) {
  const revisionsDir = path.join(dir, "revisions");
  if (!fs.existsSync(revisionsDir)) {
    return [];
  }
  return fs.readdirSync(revisionsDir)
    .filter((name) => fs.statSync(path.join(revisionsDir, name)).isDirectory())
    .map((revisionId) => ({
      revisionId,
      change: safeReadText(path.join(revisionsDir, revisionId, "change.md")),
      audit: safeReadText(path.join(revisionsDir, revisionId, "audit.md")),
      metricPlan: safeReadText(path.join(revisionsDir, revisionId, "metric-plan.yaml")),
      queryPlan: readJson(path.join(revisionsDir, revisionId, "query-plan.json"), null) || safeReadText(path.join(revisionsDir, revisionId, "query-plan.sql")),
      queryPlanType: fs.existsSync(path.join(revisionsDir, revisionId, "query-plan.json")) ? "json" : "sql"
    }))
    .sort((a, b) => a.revisionId.localeCompare(b.revisionId));
}

function sessionSummary(sessionId) {
  if (!safeSessionId(sessionId)) {
    return null;
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    return null;
  }
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const revisions = listRevisions(dir);
  const executedAt = sessionExecutedAt(dir, metadata);
  return {
    sessionId,
    status: metadata.status || "unknown",
    question: metadata.question || "",
    providerId: metadata.providerId || "",
    executedAt,
    updatedAt: metadata.updatedAt || metadata.createdAt || "",
    linkedFrom: metadata.linkedFrom || "",
    copyReason: metadata.copyReason || "",
    revisionCount: revisions.length,
    revisions
  };
}

function linkedChildrenFor(sessionId) {
  return listSessionIds(workspacePath)
    .map((candidateId) => {
      const dir = findSessionDir(workspacePath, candidateId);
      const metadata = readJson(path.join(dir, "metadata.json"), { sessionId: candidateId });
      return metadata.linkedFrom === sessionId ? sessionSummary(candidateId) : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(b.executedAt || b.updatedAt || "").localeCompare(String(a.executedAt || a.updatedAt || "")));
}

function sessionExecutedAt(dir, metadata = {}) {
  const execution = readJson(path.join(dir, "provider-execution.json"), null) || metadata.providerExecution || {};
  const queryPlan = readJson(path.join(dir, "query-plan.json"), null);
  return firstText(
    execution.recordedAt,
    execution.completedAt,
    execution.executedAt,
    queryPlan?.actualExecution?.executedAt,
    queryPlan?.actual_execution?.executedAt,
    metadata.completedAt,
    metadata.executedAt,
    metadata.updatedAt,
    metadata.createdAt
  );
}

function listSessionPendingActions(dir) {
  const pendingDir = path.join(dir, "pending-actions");
  if (!fs.existsSync(pendingDir)) {
    return [];
  }
  return fs.readdirSync(pendingDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(pendingDir, name), { actionId: name.replace(/\.json$/, "") }))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function createSessionPendingAction(sessionId, action) {
  if (!safeSessionId(sessionId)) {
    throw new Error("非法 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const createdAt = new Date().toISOString();
  const actionId = String(action.actionId || `${action.type || "action"}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const payload = {
    actionId,
    type: action.type || "pending_action",
    status: "pending",
    sessionId,
    createdAt,
    ...action
  };
  const pendingDir = path.join(dir, "pending-actions");
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(path.join(pendingDir, `${actionId}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  fs.appendFileSync(path.join(dir, "audit.md"), `\n## 待处理动作 ${actionId}\n\n- 类型：${payload.type}\n- 创建时间：${createdAt}\n- 说明：${payload.reason || "等待 Agent 处理。"}\n`);
  return payload;
}

function loadSession(sessionId) {
  if (!safeSessionId(sessionId)) {
    return null;
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    return null;
  }

  const queryPlanSql = safeReadText(path.join(dir, "query-plan.sql"), "");
  const queryPlanJson = readJson(path.join(dir, "query-plan.json"), null);
  const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
  const linkedFrom = metadata.linkedFrom || "";
  return {
    sessionId,
    path: dir,
    metadata,
    lineage: {
      linkedFrom,
      copyReason: metadata.copyReason || "",
      source: linkedFrom ? sessionSummary(linkedFrom) : null,
      children: linkedChildrenFor(sessionId)
    },
    request: safeReadText(path.join(dir, "request.md")),
    interpretation: safeReadText(path.join(dir, "interpretation.md")),
    metricPlan: safeReadText(path.join(dir, "metric-plan.yaml")),
    queryPlan: queryPlanJson || queryPlanSql,
    queryPlanType: queryPlanJson ? "json" : "sql",
    aggregate: readJson(path.join(dir, "result.aggregate.json"), { columns: [], rows: [] }),
    preview: readJson(path.join(dir, "result.preview.json"), { columns: [], rows: [] }),
    chartSpec: readJson(path.join(dir, "chart-spec.json"), { charts: [], tables: [] }),
    confirmation: readJson(path.join(dir, "confirmation.json"), null),
    audit: safeReadText(path.join(dir, "audit.md")),
    providerDetails: providerDetailsFor(metadata.providerId),
    providerHandoff: readJson(path.join(dir, "provider-handoff", "handoff.json"), null),
    providerExecution: readJson(path.join(dir, "provider-execution.json"), null),
    shareActions: listSessionShareActions(dir),
    revisions: listRevisions(dir),
    pendingActions: listSessionPendingActions(dir)
  };
}

function listSessionShareActions(dir) {
  const shareDir = path.join(dir, "share-actions");
  if (!fs.existsSync(shareDir)) {
    return [];
  }
  return fs.readdirSync(shareDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(shareDir, name), { shareId: name.replace(/\.json$/, "") }))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function compactMetricId(value, sessionId) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized && normalized !== "metric") {
    return normalized;
  }
  return `metric_${String(sessionId || Date.now()).replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase()}`;
}

function listFrom(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return String(value).split(/[,，、/]/).map((item) => item.trim()).filter(Boolean);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (value !== null && value !== undefined && typeof value !== "object" && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function metricDefinitionFromSession(session, body = {}) {
  const confirmation = session.confirmation || {};
  const queryPlan = typeof session.queryPlan === "object" && session.queryPlan ? session.queryPlan : {};
  const summary = session.aggregate?.summary || {};
  const chart = session.chartSpec?.charts?.[0] || {};
  const metricId = compactMetricId(
    body.metricId || confirmation.metrics?.[0] || session.metadata?.metrics?.[0] || summary.primaryMetric || chart.y,
    session.sessionId
  );
  const metricName = chineseMetricDisplayName(
    body.metricName,
    confirmation.metricDefinition,
    queryPlan.metricDefinition,
    queryPlan.metricIntent?.metricName,
    queryPlan.actualExecution?.metricDefinition,
    chart.title,
    session.metadata?.question,
    body.description,
    metricId
  );
  const dimensions = [
    ...listFrom(confirmation.dimensions),
    ...listFrom(queryPlan.dimensions),
    ...listFrom(chart.x),
    ...listFrom(chart.series)
  ].filter((item, index, array) => item && array.indexOf(item) === index);
  const sourceTables = listFrom(confirmation.sourceTables || queryPlan.sourceTables)
    .map((item) => ({ table: typeof item === "string" ? item : item.table || item.name || "unknown", role: typeof item === "string" ? "指标候选来源" : item.role || "指标候选来源" }));
  const actualSources = listFrom(queryPlan.actualExecution?.sourceTables || queryPlan.actualExecution?.sources)
    .map((item) => ({ table: typeof item === "string" ? item : item.table || item.name || "unknown", role: typeof item === "string" ? "实际执行来源" : item.role || "实际执行来源" }));
  const providerId = session.metadata?.providerId || confirmation.providerId || queryPlan.providerId || "";
  if (providerId && !sourceTables.length && !actualSources.length) {
    sourceTables.push({ table: providerId, role: "查询 provider" });
  }
  const calculationLogic = firstText(
    body.definition,
    confirmation.calculationLogic,
    queryPlan.calculationLogic,
    queryPlan.actualExecution?.calculationLogic,
    confirmation.metricDefinition,
    summary.primaryMetric
  );
  return {
    id: metricId,
    name: metricName,
    status: body.status || "draft",
    description: firstText(body.description, session.metadata?.question, confirmation.metricDefinition, metricName),
    definition: firstText(body.definition, confirmation.metricDefinition, calculationLogic, metricName),
    grain: firstText(body.grain, confirmation.grain, queryPlan.grain, dimensions.length ? dimensions.join("_") : "session_result"),
    timeField: firstText(body.timeField, confirmation.timeField, queryPlan.timeField, queryPlan.timeFields?.[0], "unknown"),
    timeDescription: firstText(confirmation.timeRange, queryPlan.timeRange, "来自保存该指标的查询 session 时间口径。"),
    numeratorName: firstText(body.numeratorName, metricName),
    numeratorLogic: calculationLogic || "使用保存该指标的查询 session 中已确认的计算逻辑。",
    denominatorName: firstText(body.denominatorName, confirmation.denominator?.name, "not_applicable"),
    denominatorLogic: firstText(body.denominatorLogic, confirmation.denominator?.logic, "非比率指标无分母。"),
    dimensions,
    source_tables: [...actualSources, ...sourceTables].filter((item, index, array) => item.table && array.findIndex((candidate) => candidate.table === item.table && candidate.role === item.role) === index),
    actualSql: firstText(body.actualSql, body.actual_sql, extractActualSqlFromLoadedSession(session)),
    notes: [
      `由 Dashboard 从查询 session ${session.sessionId} 直接保存`,
      providerId ? `关联查询源 ${providerId}` : "",
      session.metadata?.status ? `来源查询状态 ${session.metadata.status}` : ""
    ].filter(Boolean)
  };
}

function extractActualSqlFromLoadedSession(session) {
  if (session.queryPlanType === "sql" && typeof session.queryPlan === "string") {
    return session.queryPlan.trim();
  }
  const queryPlan = typeof session.queryPlan === "object" && session.queryPlan ? session.queryPlan : {};
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

function chineseMetricDisplayName(...values) {
  const explicit = firstText(values[0]);
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

function saveSessionMetric(sessionId, body = {}) {
  const session = loadSession(sessionId);
  if (!session) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const metric = metricDefinitionFromSession(session, body);
  const result = saveMetricDefinition(metric, workspacePath);
  fs.appendFileSync(path.join(session.path, "audit.md"), `\n## 指标保存\n\n- 保存时间：${result.updatedAt}\n- 指标：${result.id}\n- 路径：${path.relative(workspacePath, result.metricPath)}\n- 来源：Dashboard 直接保存当前查询结果为指标库资产。\n`);
  return { ...result, metric };
}

function deleteSessionLocal(sessionId) {
  if (!safeSessionId(sessionId)) {
    throw new Error("非法 session id");
  }
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  const sessionsRoot = path.resolve(workspacePath, "sessions");
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(`${sessionsRoot}${path.sep}`)) {
    throw new Error("拒绝删除 sessions 目录之外的数据");
  }
  const currentPath = path.join(workspacePath, "dashboards", "current.json");
  const current = readJson(currentPath, {});
  fs.rmSync(resolvedDir, { recursive: true, force: false });
  const remaining = listSessions();
  let nextCurrentSessionId = current.currentSessionId || "";
  if (current.currentSessionId === sessionId) {
    nextCurrentSessionId = remaining[0]?.sessionId || "";
    fs.writeFileSync(currentPath, `${JSON.stringify({
      currentSessionId: nextCurrentSessionId,
      updatedAt: new Date().toISOString(),
      deletedSessionId: sessionId
    }, null, 2)}\n`);
  }
  fs.appendFileSync(path.join(workspacePath, "logs", "skill-runs.jsonl"), `${JSON.stringify({
    ts: new Date().toISOString(),
    event: "session.deleted",
    sessionId,
    nextCurrentSessionId
  })}\n`);
  return {
    sessionId,
    deleted: true,
    deletedPath: path.relative(workspacePath, resolvedDir),
    nextCurrentSessionId,
    metricsUnaffected: true
  };
}

function removeMetricFromIndex(metricId) {
  const indexPath = path.join(workspacePath, "metrics", "_index.yaml");
  const indexText = safeReadText(indexPath, "");
  if (!indexText) {
    return;
  }
  const pattern = new RegExp(`^\\s*-\\s+id:\\s+${escapeRegExp(metricId)}\\s*\\n(?:\\s{4}[^\\n]*\\n?)*`, "m");
  const nextText = indexText.replace(pattern, "").replace(/metrics:\s*\n\s*$/m, "metrics: []\n");
  fs.writeFileSync(indexPath, `${nextText.trimEnd()}\n`);
}

function deleteMetricLocal(metricId) {
  if (!safeMetricId(metricId)) {
    throw new Error("非法 metric id");
  }
  const metricsRoot = path.resolve(workspacePath, "metrics");
  const metricPath = path.resolve(metricsRoot, `${metricId}.yaml`);
  if (!metricPath.startsWith(`${metricsRoot}${path.sep}`)) {
    throw new Error("拒绝删除 metrics 目录之外的数据");
  }
  if (!fs.existsSync(metricPath)) {
    throw new Error(`未找到指标：${metricId}`);
  }
  fs.unlinkSync(metricPath);
  removeMetricFromIndex(metricId);
  fs.appendFileSync(path.join(workspacePath, "logs", "skill-runs.jsonl"), `${JSON.stringify({
    ts: new Date().toISOString(),
    event: "metric.deleted",
    metricId
  })}\n`);
  return {
    metricId,
    deleted: true,
    deletedPath: path.relative(workspacePath, metricPath),
    sessionsUnaffected: true,
    sharedMetricsUnaffected: true
  };
}

function providerDetailsFor(providerId) {
  if (!providerId) {
    return null;
  }
  return listProviders().find((provider) => provider.id === providerId) || { id: providerId, status: "unknown" };
}

function listSessions() {
  return listSessionIds(workspacePath).map((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
    const revisions = listRevisions(dir);
    const executedAt = sessionExecutedAt(dir, metadata);
    return {
      sessionId,
      status: metadata.status || "unknown",
      question: metadata.question || "",
      providerId: metadata.providerId || "",
      confirmationStatus: metadata.confirmationStatus || "",
      executedAt,
      updatedAt: metadata.updatedAt || metadata.createdAt || "",
      linkedFrom: metadata.linkedFrom || "",
      copyReason: metadata.copyReason || "",
      revisionCount: revisions.length
    };
  }).sort((a, b) => String(b.executedAt || b.updatedAt || "").localeCompare(String(a.executedAt || a.updatedAt || "")));
}

function sessionsUsingMetric(metricId) {
  return listSessionIds(workspacePath)
    .map((sessionId) => {
      const dir = findSessionDir(workspacePath, sessionId);
      const metadata = readJson(path.join(dir, "metadata.json"), { sessionId });
      const queryPlanJson = readJson(path.join(dir, "query-plan.json"), null);
      const haystack = [
        ...(metadata.metrics || []),
        metadata.question || "",
        safeReadText(path.join(dir, "metric-plan.yaml")),
        safeReadText(path.join(dir, "query-plan.sql")),
        queryPlanJson ? JSON.stringify(queryPlanJson) : ""
      ].join("\n");
      if (!haystack.includes(metricId)) {
        return null;
      }
      return {
        sessionId,
        status: metadata.status || "unknown",
        question: metadata.question || "",
        providerId: metadata.providerId || "",
        executedAt: sessionExecutedAt(dir, metadata),
        updatedAt: metadata.updatedAt || metadata.createdAt || "",
        linkedFrom: metadata.linkedFrom || ""
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.executedAt || b.updatedAt || "").localeCompare(String(a.executedAt || a.updatedAt || "")));
}

function listMetrics() {
  const metricsDir = path.join(workspacePath, "metrics");
  if (!fs.existsSync(metricsDir)) {
    return [];
  }
  const usage = metricUsageCounts();
  return fs.readdirSync(metricsDir)
    .filter((file) => file.endsWith(".yaml") && file !== "_index.yaml")
    .map((file) => {
      const text = safeReadText(path.join(metricsDir, file));
      const id = text.match(/^id:\s*(.+)$/m)?.[1]?.trim() || file.replace(/\.yaml$/, "");
      const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim()?.replace(/^"|"$/g, "") || id;
      const status = text.match(/^status:\s*(.+)$/m)?.[1]?.trim() || "unknown";
      const definition = text.match(/^definition:\s*(.+)$/m)?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
      const relatedSessions = sessionsUsingMetric(id);
      const providerIds = [...new Set(relatedSessions.map((session) => session.providerId).filter(Boolean))];
      const shareActions = getShareActions({ subjectType: "metric", subjectId: id }, workspacePath);
      return {
        id,
        name,
        status,
        description: yamlScalar(text, "description"),
        definition,
        grain: yamlScalar(text, "grain"),
        timeField: yamlBlock(text, "time_field"),
        numerator: yamlBlock(text, "numerator"),
        denominator: yamlBlock(text, "denominator"),
        dimensions: yamlList(text, "dimensions"),
        sourceTables: yamlList(text, "source_tables"),
        actualSql: yamlLiteral(text, "actual_sql"),
        backendEvidence: yamlList(text, "backend_evidence"),
        validation: yamlBlock(text, "validation"),
        notes: yamlList(text, "notes"),
        relatedSessions,
        relatedProviders: providerIds.map((providerId) => providerDetailsFor(providerId)),
        shareActions,
        recentUsageCount: usage[id] || 0,
        path: `metrics/${file}`,
        raw: text
      };
    });
}

function listProviders() {
  const raw = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
  return raw.split(/\n\s*-\s+id:\s*/).slice(1).map((block) => {
    const lines = block.split(/\r?\n/);
    const firstLine = lines[0].trim();
    const text = `id: ${firstLine}\n${lines.slice(1).join("\n")}`;
    return {
      id: firstLine,
      type: yamlScalar(text, "type"),
      displayName: yamlScalar(text, "display_name"),
      status: yamlScalar(text, "status"),
      legacyReplacedBy: yamlScalar(text, "legacy_replaced_by"),
      mcpServerHint: yamlScalar(text, "mcp_server_hint"),
      toolName: yamlScalar(text, "tool_name"),
      toolNames: yamlList(text, "tool_names"),
      skillEntrypoint: yamlScalar(text, "skill_entrypoint"),
      description: yamlScalar(text, "description"),
      routingKeywords: yamlList(text, "routing_keywords"),
      safetyPolicy: {
        readOnly: yamlScalar(text, "read_only"),
        allowDetailDump: yamlScalar(text, "allow_detail_dump"),
        maxPreviewRows: yamlScalar(text, "max_preview_rows"),
        requireSourceStatement: yamlScalar(text, "require_source_statement")
      },
      raw: text
    };
  });
}

function yamlScalar(text, key) {
  return text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"))?.[1]?.trim()?.replace(/^"|"$/g, "") || "";
}

function yamlLiteral(text, key) {
  const scalar = yamlScalar(text, key);
  if (scalar && scalar !== "|") {
    return scalar;
  }
  return yamlBlock(text, key);
}

function yamlBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `${key}:` || line.trim() === `${key}: |`);
  if (index < 0) {
    return "";
  }
  const baseIndent = lines[index].match(/^\s*/)?.[0].length || 0;
  const block = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim()) {
      block.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (indent <= baseIndent) {
      break;
    }
    block.push(line);
  }
  return block.join("\n").trim();
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

function metricUsageCounts() {
  const counts = {};
  for (const sessionId of listSessionIds(workspacePath)) {
    const dir = findSessionDir(workspacePath, sessionId);
    const metadata = readJson(path.join(dir, "metadata.json"), {});
    for (const metric of metadata.metrics || []) {
      counts[metric] = (counts[metric] || 0) + 1;
    }
  }
  return counts;
}

function listBackendProjects() {
  const scansDir = path.join(workspacePath, "knowledge", "code-scans");
  const scans = fs.existsSync(scansDir)
    ? fs.readdirSync(scansDir)
        .filter((file) => file.endsWith(".md"))
        .sort()
        .reverse()
        .map((file) => ({
          file,
          path: `knowledge/code-scans/${file}`,
          content: safeReadText(path.join(scansDir, file))
        }))
    : [];
  return {
    raw: safeReadText(path.join(workspacePath, "knowledge", "backend-projects.yaml")),
    scans
  };
}

function loadSourceCatalog() {
  const dir = path.join(workspacePath, "knowledge", "source-catalog");
  return {
    index: readJson(path.join(dir, "index.json"), null),
    services: readJson(path.join(dir, "services.json"), { backendProjects: [], mcpServers: [] }),
    queryCapabilities: readJson(path.join(dir, "query-capabilities.json"), { providers: [] }),
    fieldLineage: readJson(path.join(dir, "field-lineage.json"), { fields: [] }),
    metricCandidates: readJson(path.join(dir, "metric-candidates.json"), { metrics: [] }),
    readme: safeReadText(path.join(dir, "README.md"))
  };
}

function mcpTools() {
  return [
    "get-workspace-status",
    "load-current-dashboard",
    "update-current-dashboard",
    "save-metric-definition",
    "create-analysis-session",
    "save-execution-confirmation",
    "confirm-session-for-execution",
    "get-metric-history",
    "list-metrics",
    "list-query-history",
    "load-query-session",
    "compare-query-sessions",
    "clone-query-session",
    "create-failed-session",
    "create-query-handoff",
    "select-query-provider",
    "record-provider-execution",
    "update-knowledge-fields-from-query",
    "run-quality-gate",
    "import-provider-artifacts",
    "run-benchmark",
    "share-bi-asset",
    "sync-shared-metrics",
    "request-drill-down",
    "drill-down-query",
    "register-query-provider",
    "smoke-test-provider",
    "scan-backend-project",
    "render-bi-dashboard"
  ];
}

async function runMcpTool(tool, args = {}) {
  if (tool === "get-workspace-status") {
    const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
    return { workspacePath, current, tools: mcpTools() };
  }
  if (tool === "load-current-dashboard") {
    const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
    return { current, session: current.currentSessionId ? loadSession(current.currentSessionId) : null };
  }
  if (tool === "update-current-dashboard") {
    return setCurrentDashboard(args.sessionId, workspacePath);
  }
  if (tool === "save-metric-definition") {
    return saveMetricDefinition(args.metric || args, workspacePath);
  }
  if (tool === "create-analysis-session") {
    return createAnalysisSession(args, workspacePath);
  }
  if (tool === "save-execution-confirmation") {
    return saveExecutionConfirmation(args, workspacePath);
  }
  if (tool === "confirm-session-for-execution") {
    return confirmSessionForExecution(args, workspacePath);
  }
  if (tool === "get-metric-history") {
    return getMetricHistory(args.metricId || args.id, workspacePath);
  }
  if (tool === "list-metrics") {
    return { metrics: listMetrics(), sharedMetrics: getSharedMetrics(workspacePath) };
  }
  if (tool === "list-query-history") {
    return { sessions: listSessions() };
  }
  if (tool === "load-query-session") {
    return { session: loadSession(args.sessionId) };
  }
  if (tool === "compare-query-sessions") {
    return compareSessions(args, workspacePath);
  }
  if (tool === "clone-query-session") {
    return cloneSession(args, workspacePath);
  }
  if (tool === "create-failed-session") {
    return createFailedSession(args, workspacePath);
  }
  if (tool === "create-query-handoff") {
    return createQueryProviderHandoff(args, workspacePath);
  }
  if (tool === "select-query-provider") {
    return selectQueryProvider(args, workspacePath);
  }
  if (tool === "record-provider-execution") {
    return recordProviderExecution(args, workspacePath);
  }
  if (tool === "update-knowledge-fields-from-query") {
    return updateKnowledgeFieldsFromQuery(args, workspacePath);
  }
  if (tool === "run-quality-gate") {
    return runQualityGate(args, workspacePath);
  }
  if (tool === "import-provider-artifacts") {
    return importProviderArtifacts(args, workspacePath);
  }
  if (tool === "import-bairong-artifacts") {
    return importBairongArtifacts(args, workspacePath);
  }
  if (tool === "run-benchmark") {
    return runBenchmark(args, workspacePath);
  }
  if (tool === "share-bi-asset") {
    return createAndExecuteShareAction(args, workspacePath);
  }
  if (tool === "sync-shared-metrics") {
    return syncTeamSharedMetrics(args, workspacePath);
  }
  if (tool === "request-drill-down" || tool === "drill-down-query") {
    return requestDrillDown(args, workspacePath);
  }
  if (tool === "register-query-provider") {
    return registerProvider(args.provider || args, workspacePath);
  }
  if (tool === "smoke-test-provider") {
    return smokeTestProvider(args, workspacePath);
  }
  if (tool === "scan-backend-project") {
    return scanBackendProject(args, workspacePath);
  }
  if (tool === "render-bi-dashboard") {
    return { url: "/dashboard" };
  }
  throw new Error(`未知工具：${tool}`);
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    const indexPath = path.join(publicDir, "index.html");
    return sendText(res, fs.readFileSync(indexPath, "utf8"), 200, "text/html; charset=utf-8");
  }

  if (url.pathname === "/inspector") {
    return sendText(res, `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>Agent BI Inspector</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 24px;">
    <h1>Agent BI 调试页</h1>
    <p>工作区：${workspacePath}</p>
    <ul>
      <li><a href="/dashboard">看板</a></li>
      <li><a href="/api/status">/api/status</a></li>
      <li><a href="/api/current-dashboard">/api/current-dashboard</a></li>
      <li><a href="/mcp">/mcp</a></li>
    </ul>
  </body>
</html>`, 200, "text/html; charset=utf-8");
  }

  if (url.pathname.startsWith("/sessions/")) {
    const sessionId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[1] || "");
    const session = loadSession(sessionId);
    if (!session) {
      return sendText(res, "未找到 session", 404);
    }
    return sendText(res, `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=/dashboard" />
    <title>${sessionId}</title>
  </head>
  <body>正在打开看板：${sessionId}</body>
</html>`, 200, "text/html; charset=utf-8");
  }

  if (url.pathname === "/mcp-use/widgets/bi-dashboard") {
    const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
    const session = current.currentSessionId ? loadSession(current.currentSessionId) : null;
    const title = session?.metadata?.question || session?.sessionId || "当前 BI 分析";
    const columns = session?.preview?.columns || [];
    const previewRows = (session?.preview?.rows || []).slice(0, 5);
    const queryPlan = typeof session?.queryPlan === "string" ? session.queryPlan : JSON.stringify(session?.queryPlan || {}, null, 2);
    const metricCalculation = [
      session?.confirmation?.metricDefinition ? `指标定义：${session.confirmation.metricDefinition}` : "",
      session?.confirmation?.calculationLogic ? `计算口径：${session.confirmation.calculationLogic}` : "",
      session?.confirmation?.dedupLogic ? `去重规则：${session.confirmation.dedupLogic}` : "",
      session?.confirmation?.fallbackPolicy ? `Fallback：${session.confirmation.fallbackPolicy}` : ""
    ].filter(Boolean).join("\n") || session?.metricPlan || "暂无";
    return sendText(res, `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><link rel="stylesheet" href="/styles.css" /></head>
  <body style="margin:0;background:#ffffff;">
    <div style="padding:14px;font-family:Aptos,'Avenir Next','Segoe UI',sans-serif;color:#202426;">
      <div style="font-size:12px;color:#287271;font-weight:700;">Agent BI 组件</div>
      <h1 style="font-size:18px;margin:4px 0 8px;">${escapeHtml(title)}</h1>
      <div style="font-size:12px;color:#687074;">当前查询记录：${escapeHtml(session?.sessionId || "无")} · 状态：${escapeHtml(session?.metadata?.status || "未知")} · 查询源：${escapeHtml(session?.metadata?.providerId || "未知")}</div>
      <h2 style="font-size:13px;margin:12px 0 6px;">数据预览</h2>
      <div style="max-height:180px;overflow:auto;border:1px solid #d8d3c9;border-radius:7px;">
        <table style="border-collapse:collapse;width:100%;font-size:12px;">
          <thead><tr>${columns.map((column) => `<th style="text-align:left;padding:6px;border-bottom:1px solid #d8d3c9;background:#f2efe8;">${escapeHtml(column)}</th>`).join("")}</tr></thead>
          <tbody>${previewRows.map((row) => `<tr>${columns.map((column) => `<td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <h2 style="font-size:13px;margin:12px 0 6px;">指标计算口径</h2>
      <pre style="max-height:110px;overflow:auto;font-size:11px;white-space:pre-wrap;">${escapeHtml(metricCalculation)}</pre>
      <h2 style="font-size:13px;margin:12px 0 6px;">查询计划</h2>
      <pre style="max-height:110px;overflow:auto;font-size:11px;white-space:pre-wrap;">${escapeHtml(queryPlan || "暂无")}</pre>
      <p><a href="/dashboard" target="_blank">打开完整看板</a></p>
    </div>
  </body>
</html>`, 200, "text/html; charset=utf-8");
  }

  if (url.pathname === "/api/status") {
    const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
    return sendJson(res, {
      ok: true,
      workspacePath,
      currentSessionId: current.currentSessionId || null,
      updatedAt: current.updatedAt || null
    });
  }

  if (url.pathname === "/api/share-targets") {
    return sendJson(res, getShareTargets(workspacePath));
  }

  if (url.pathname === "/api/share-profile") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, profile: saveSharingProfile(body) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, getSharingProfile());
  }

  if (url.pathname === "/api/share-mcp-config") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, config: saveDingTalkMcpConfig(body, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message, code: error.code || "failed_mcp_config_invalid" }, 400);
      }
    }
    return sendJson(res, getDingTalkMcpConfigStatus(workspacePath));
  }

  if (url.pathname === "/api/share-actions") {
    return sendJson(res, { actions: getShareActions({}, workspacePath) });
  }

  if (url.pathname === "/api/shared-metrics") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: await syncTeamSharedMetrics(body, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, getSharedMetrics(workspacePath));
  }

  if (url.pathname === "/api/current-dashboard") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: setCurrentDashboard(body.sessionId, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
    const session = current.currentSessionId ? loadSession(current.currentSessionId) : null;
    return sendJson(res, { current, session });
  }

  if (url.pathname === "/api/sessions") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        if (body.analysis || body.kind === "analysis") {
          return sendJson(res, { ok: true, result: createAnalysisSession(body, workspacePath) });
        }
        if (body.status === "failed" || body.failed) {
          return sendJson(res, { ok: true, result: createFailedSession(body, workspacePath) });
        }
        return sendJson(res, { ok: false, error: "暂仅支持创建 failed session" }, 400);
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, { sessions: listSessions() });
  }

  if (url.pathname === "/api/sessions/compare" && req.method === "POST") {
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, result: compareSessions(body, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname === "/api/quality-gate" && req.method === "POST") {
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, result: runQualityGate(body, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname === "/api/benchmarks/run" && req.method === "POST") {
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, result: runBenchmark(body, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/sessions/")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const sessionId = decodeURIComponent(parts[2] || "");
    if (parts.length === 3 && req.method === "DELETE") {
      try {
        return sendJson(res, { ok: true, result: deleteSessionLocal(sessionId) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "revisions" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: createRevision({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "confirmation" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: saveExecutionConfirmation({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "confirm-execution" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: confirmSessionForExecution({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "drill-down" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: requestDrillDown({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if ((parts[3] === "save-metric" || parts[3] === "save-metric-request") && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: saveSessionMetric(sessionId, body) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "share" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const result = createShareAssetAction({ ...body, shareType: "dataset", sessionId }, workspacePath);
        if (!result.reused && result.action?.shareId) {
          runShareAction({ shareId: result.action.shareId }, workspacePath).catch((error) => console.error(error));
        }
        return sendJson(res, { ok: true, result });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "clone" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: cloneSession({ ...body, sourceSessionId: sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "query-handoff" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: createQueryProviderHandoff({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "provider-execution" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: recordProviderExecution({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "import-artifacts" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: importProviderArtifacts({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    if (parts[3] === "import-bairong-artifacts" && req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: importBairongArtifacts({ ...body, sessionId }, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    const session = loadSession(sessionId);
    return session ? sendJson(res, { session }) : sendJson(res, { error: "未找到 session" }, 404);
  }

  if (url.pathname === "/api/metrics") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: saveMetricDefinition(body.metric || body, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, { metrics: listMetrics(), sharedMetrics: getSharedMetrics(workspacePath), rawIndex: safeReadText(path.join(workspacePath, "metrics", "_index.yaml")) });
  }

  if (url.pathname.startsWith("/api/metrics/") && req.method === "DELETE") {
    try {
      const metricId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] || "");
      return sendJson(res, { ok: true, result: deleteMetricLocal(metricId) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/shared-metrics/") && url.pathname.endsWith("/copy-local") && req.method === "POST") {
    try {
      const parts = url.pathname.split("/").filter(Boolean);
      const metricId = decodeURIComponent(parts[2] || "");
      const body = await readBody(req);
      return sendJson(res, { ok: true, result: copyTeamSharedMetricToLocal({ ...body, metricId }, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/metrics/") && url.pathname.endsWith("/history")) {
    try {
      const metricId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] || "");
      return sendJson(res, { ok: true, result: getMetricHistory(metricId, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/metrics/") && url.pathname.endsWith("/share") && req.method === "POST") {
    try {
      const metricId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] || "");
      const body = await readBody(req);
      const result = createShareAssetAction({ ...body, shareType: "metric", metricId }, workspacePath);
      if (!result.reused && result.action?.shareId) {
        runShareAction({ shareId: result.action.shareId }, workspacePath).catch((error) => console.error(error));
      }
      return sendJson(res, { ok: true, result });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname === "/api/providers") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: registerProvider(body.provider || body, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, {
      raw: safeReadText(path.join(workspacePath, "config", "query-providers.yaml")),
      providers: listProviders()
    });
  }

  if (url.pathname === "/api/providers/select" && req.method === "POST") {
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, result: selectQueryProvider(body, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/providers/") && url.pathname.endsWith("/smoke-test")) {
    try {
      const providerId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[2] || "");
      return sendJson(res, { ok: true, result: smokeTestProvider({ providerId }, workspacePath) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  if (url.pathname === "/api/backend-projects") {
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, result: scanBackendProject(body, workspacePath) });
      } catch (error) {
        return sendJson(res, { ok: false, error: error.message }, 400);
      }
    }
    return sendJson(res, listBackendProjects());
  }

  if (url.pathname === "/api/source-catalog") {
    return sendJson(res, loadSourceCatalog());
  }

  if (url.pathname === "/api/pending-actions") {
    return sendJson(res, { actions: listPendingActions(workspacePath) });
  }

  if (url.pathname === "/mcp") {
    if (req.method === "GET") {
      return sendJson(res, {
        name: "agent-bi",
        version: "0.1.0",
        transport: "local-json",
        tools: mcpTools(),
        dashboard: "/dashboard"
      });
    }
    try {
      const body = await readBody(req);
      const tool = body.tool || body.name || body.method;
      const args = body.arguments || body.args || body.params || {};
      return sendJson(res, { ok: true, tool, result: await runMcpTool(tool, args) });
    } catch (error) {
      return sendJson(res, { ok: false, error: error.message }, 400);
    }
  }

  const staticPath = path.normalize(path.join(publicDir, url.pathname.replace(/^\/+/, "")));
  if (staticPath.startsWith(publicDir) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    return sendText(res, fs.readFileSync(staticPath), 200, contentType(staticPath));
  }

  return sendJson(res, { error: "未找到" }, 404);
}

function listen(port) {
  const server = http.createServer(route);
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      listen(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    console.log(`Agent BI Dashboard：http://${host}:${port}/dashboard`);
    console.log(`工作区：${workspacePath}`);
  });
}

listen(startPort);
