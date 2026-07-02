#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  cloneSession,
  createFailedSession,
  createQueryProviderHandoff,
  createRevision,
  registerProvider,
  recordProviderExecution,
  requestDrillDown,
  runBenchmark,
  runQualityGate,
  saveExecutionConfirmation,
  saveMetricDefinition,
  scanBackendProject,
  selectQueryProvider
} from "./lib/operations.mjs";
import {
  findSessionDir,
  listSessionIds,
  mkdirp,
  nowIso,
  parseArgs,
  readJson,
  resolveWorkspacePath,
  safeReadText,
  writeJson
} from "./lib/workspace.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();
const evaluatedAt = nowIso();

function pass(id, label, evidence) {
  return { id, label, passed: true, evidence };
}

function fail(id, label, error) {
  return { id, label, passed: false, error: error.message || String(error) };
}

async function runCase(id, label, fn) {
  try {
    return pass(id, label, await fn());
  } catch (error) {
    return fail(id, label, error);
  }
}

function currentSessionId() {
  const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
  const ids = [current.currentSessionId, ...listSessionIds(workspacePath)].filter(Boolean);
  const id = ids.find((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    const chartSpec = dir ? readJson(path.join(dir, "chart-spec.json"), {}) : {};
    return (chartSpec.charts || []).some((chart) => chart.type === "line");
  }) || ids[0];
  if (!id) {
    throw new Error("没有可评估的 session，请先创建 sample session。");
  }
  return id;
}

function sessionEvidence(sessionId) {
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    throw new Error(`未找到 session：${sessionId}`);
  }
  return { sessionId, sessionPath: dir };
}

const baseSessionId = currentSessionId();
const baseSession = sessionEvidence(baseSessionId);
const metricPlanFile = path.join(baseSession.sessionPath, "metric-plan.yaml");
const queryPlanFile = fs.existsSync(path.join(baseSession.sessionPath, "query-plan.sql"))
  ? path.join(baseSession.sessionPath, "query-plan.sql")
  : path.join(baseSession.sessionPath, "query-plan.json");

const results = [];

results.push(await runCase("single_metric_trend", "单指标趋势查询", () => {
  const chartSpec = readJson(path.join(baseSession.sessionPath, "chart-spec.json"), {});
  const hasLine = (chartSpec.charts || []).some((chart) => chart.type === "line");
  if (!hasLine) throw new Error("当前 session 没有折线图。");
  return { sessionId: baseSessionId, chartTypes: (chartSpec.charts || []).map((chart) => chart.type) };
}));

results.push(await runCase("multi_dimension_grouping", "多维度分组查询", () => {
  const metricPlan = safeReadText(metricPlanFile);
  const dimensions = metricPlan.match(/dimensions:\s*\n([\s\S]*?)(?=\n\S|$)/)?.[1]?.match(/^\s*-/gm)?.length || 0;
  if (dimensions < 2) throw new Error("维度数量不足 2 个。");
  return { sessionId: baseSessionId, dimensions };
}));

results.push(await runCase("metric_save", "指标保存", () => {
  return saveMetricDefinition({
    id: "evaluation_metric",
    name: "评估指标",
    status: "draft",
    definition: "用于评估指标保存链路。"
  }, workspacePath);
}));

results.push(await runCase("query_history_load", "历史查询读取", () => {
  const ids = listSessionIds(workspacePath);
  if (!ids.includes(baseSessionId)) throw new Error("历史列表未包含当前 session。");
  return { count: ids.length, current: baseSessionId };
}));

results.push(await runCase("revision", "结果 revision", () => {
  return createRevision({ sessionId: baseSessionId, reason: "评估 revision 链路" }, workspacePath);
}));

results.push(await runCase("backend_scan", "后端逻辑扫描", () => {
  return scanBackendProject({
    repoPath: path.resolve("."),
    domain: "evaluation",
    keywords: "provider,status,metric",
    maxFiles: 40,
    maxMatches: 60
  }, workspacePath);
}));

results.push(await runCase("field_ambiguity", "字段歧义处理", () => {
  const quality = runQualityGate({
    providerId: "internal_data_query",
    metricPlanFile,
    queryPlanFile
  }, workspacePath);
  const hasAssumption = quality.checks.some((check) => check.id === "assumptions_recorded" && check.ok);
  const hasRisk = quality.checks.some((check) => check.id === "risks_recorded" && check.ok);
  if (!hasAssumption || !hasRisk) throw new Error("质量门未证明 assumptions/risks。");
  return { outputPath: quality.outputPath, blockers: quality.blockers };
}));

results.push(await runCase("provider_handoff", "查询源执行交接包", () => {
  saveExecutionConfirmation({
    sessionId: baseSessionId,
    status: "confirmed",
    confirmedBy: "evaluation",
    confirmedAt: evaluatedAt,
    question: readJson(path.join(baseSession.sessionPath, "metadata.json"), {}).question || "评估查询源执行交接包",
    providerId: "internal_data_query",
    metrics: ["credit_approval_rate"],
    metricDefinition: "评估用授信通过率口径。",
    sourceTables: ["credit_apply"],
    calculationLogic: "count(distinct approved user_id) / count(distinct user_id) * 100",
    timeRange: "最近 30 天",
    timeField: "apply_time",
    dimensions: ["apply_date", "channel"],
    filters: [],
    dedupLogic: "按 user_id 去重。",
    joinLogic: "无。",
    backendEvidence: ["功能评估确认单"],
    assumptions: ["评估用例不执行生产查询。"],
    risks: ["仅验证 handoff 生成链路。"]
  }, workspacePath);
  return createQueryProviderHandoff({
    sessionId: baseSessionId,
    providerId: "internal_data_query"
  }, workspacePath);
}));

let providerFailureSession = null;
results.push(await runCase("provider_failure", "Query Provider 查询失败", () => {
  providerFailureSession = createFailedSession({
    question: "评估 provider 失败处理",
    providerId: "internal_data_query",
    error: "评估用模拟错误"
  }, workspacePath);
  return providerFailureSession;
}));

results.push(await runCase("provider_execution_record", "查询源执行记录", () => {
  if (!providerFailureSession?.sessionId) {
    throw new Error("缺少失败 session，无法记录执行结果。");
  }
  return recordProviderExecution({
    sessionId: providerFailureSession.sessionId,
    providerId: "internal_data_query",
    status: "failed",
    error: "评估用模拟错误",
    note: "功能评估只记录失败执行元数据，不执行生产查询。"
  }, workspacePath);
}));

results.push(await runCase("new_mcp_provider", "新 MCP 服务 provider 登记", () => {
  const providerId = `evaluation_mcp_${Date.now()}`;
  return registerProvider({
    id: providerId,
    displayName: "评估 MCP 查询服务",
    status: "draft",
    routingKeywords: ["evaluation", "mcp"],
    inputSchema: { type: "object", properties: { question: { type: "string" } } },
    outputSchema: { type: "object", properties: { rows: { type: "array" } } }
  }, workspacePath);
}));

results.push(await runCase("multi_provider_confirmation", "多 provider 匹配时确认流程", () => {
  const selected = selectQueryProvider({ question: "custom query evaluation", keywords: ["custom query"] }, workspacePath);
  if (!selected.requiresConfirmation) throw new Error("draft provider 未要求确认。");
  return selected;
}));

results.push(await runCase("drill_down_pending", "下钻 pending action", () => {
  return requestDrillDown({ sessionId: baseSessionId, dimension: "channel", value: "paid", reason: "评估下钻动作" }, workspacePath);
}));

results.push(await runCase("clone_history_query", "历史查询复制为新查询", () => {
  return cloneSession({ sourceSessionId: baseSessionId, reason: "评估复制为新查询" }, workspacePath);
}));

results.push(await runCase("benchmark_cases", "Benchmark 样例", () => runBenchmark({}, workspacePath)));

const summary = {
  evaluatedAt,
  workspacePath,
  baseSessionId,
  total: results.length,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed).length,
  results
};
summary.ok = summary.failed === 0;

const outputDir = path.join(workspacePath, "logs", "evaluations");
mkdirp(outputDir);
const outputPath = path.join(outputDir, `functional-evaluation-${evaluatedAt.replace(/[:.]/g, "-")}.json`);
writeJson(outputPath, summary);
console.log(JSON.stringify({ ...summary, outputPath }, null, 2));
process.exit(summary.ok ? 0 : 1);
