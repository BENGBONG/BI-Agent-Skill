#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  findSessionDir,
  listSessionIds,
  logSkillRun,
  mkdirp,
  nowIso,
  readJson,
  resolveWorkspacePath,
  safeReadText,
  writeJson
} from "./lib/workspace.mjs";

const workspacePath = resolveWorkspacePath();
const auditedAt = nowIso();
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

function exists(relativePath) {
  return fs.existsSync(path.join(workspacePath, relativePath));
}

function pass(id, label, evidence = {}) {
  return { id, label, status: "pass", evidence };
}

function fail(id, label, reason, evidence = {}) {
  return { id, label, status: "fail", reason, evidence };
}

function check(id, label, ok, evidence = {}, reason = "未满足 PRD 验收条件。") {
  return ok ? pass(id, label, evidence) : fail(id, label, reason, evidence);
}

function sessionFilesComplete(sessionId) {
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    return { ok: false, missing: ["session_dir"], dir: null };
  }
  const required = [
    "request.md",
    "interpretation.md",
    "metric-plan.yaml",
    "result.aggregate.json",
    "result.preview.json",
    "chart-spec.json",
    "audit.md"
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(dir, file)));
  const hasQueryPlan = fs.existsSync(path.join(dir, "query-plan.sql")) || fs.existsSync(path.join(dir, "query-plan.json"));
  if (!hasQueryPlan) {
    missing.push("query-plan.sql|query-plan.json");
  }
  return { ok: missing.length === 0, missing, dir };
}

function chartTypesForSession(sessionId) {
  const dir = findSessionDir(workspacePath, sessionId);
  if (!dir) {
    return [];
  }
  const chartSpec = readJson(path.join(dir, "chart-spec.json"), {});
  const preview = readJson(path.join(dir, "result.preview.json"), {});
  const types = new Set((chartSpec.charts || []).map((chart) => chart.type).filter(Boolean));
  if ((chartSpec.tables || []).length || (preview.columns || []).length || (preview.rows || []).length) {
    types.add("table");
  }
  return [...types].sort();
}

function listMetricFiles() {
  const metricsDir = path.join(workspacePath, "metrics");
  if (!fs.existsSync(metricsDir)) {
    return [];
  }
  return fs.readdirSync(metricsDir)
    .filter((file) => file.endsWith(".yaml") && file !== "_index.yaml")
    .map((file) => path.join(metricsDir, file));
}

function hasRevisionEvidence(sessionIds) {
  return sessionIds.some((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    if (!dir) {
      return false;
    }
    const metadata = readJson(path.join(dir, "metadata.json"), {});
    return (Array.isArray(metadata.revisions) && metadata.revisions.length > 0)
      || fs.existsSync(path.join(dir, "revisions"));
  });
}

function hasFailedSession(sessionIds) {
  return sessionIds.some((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    if (!dir) {
      return false;
    }
    const metadata = readJson(path.join(dir, "metadata.json"), {});
    return metadata.status === "failed";
  });
}

function hasProviderHandoff(sessionIds) {
  return sessionIds.some((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    return Boolean(dir && fs.existsSync(path.join(dir, "provider-handoff", "handoff.json")) && fs.existsSync(path.join(dir, "provider-handoff", "handoff.md")));
  });
}

function hasProviderExecutionRecord(sessionIds) {
  return sessionIds.some((sessionId) => {
    const dir = findSessionDir(workspacePath, sessionId);
    return Boolean(dir && fs.existsSync(path.join(dir, "provider-execution.json")));
  });
}

function secretFindings() {
  const files = [
    "config/workspace.json",
    "config/agents.json",
    "config/mcp-servers.json",
    "config/query-providers.yaml",
    "config/app.json"
  ].filter(exists);
  const suspicious = [];
  const pattern = /\b(token|password|passwd|secret|cookie|authorization|api[_-]?key)\b\s*[:=]\s*["']?[^"'\s{},]+/i;
  for (const relativePath of files) {
    const text = safeReadText(path.join(workspacePath, relativePath));
    const match = text.match(pattern);
    if (match) {
      suspicious.push({ file: relativePath, match: match[0].slice(0, 80) });
    }
  }
  return suspicious;
}

function localhostOk() {
  const appConfig = readJson(path.join(workspacePath, "config", "app.json"), {});
  const host = appConfig.host || "127.0.0.1";
  return { ok: ["127.0.0.1", "localhost", "::1"].includes(host), host };
}

function latestJsonIn(relativeDir, prefix) {
  const dir = path.join(workspacePath, relativeDir);
  if (!fs.existsSync(dir)) {
    return null;
  }
  const file = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort()
    .at(-1);
  if (!file) {
    return null;
  }
  const fullPath = path.join(dir, file);
  return { path: fullPath, value: readJson(fullPath, null) };
}

const current = readJson(path.join(workspacePath, "dashboards", "current.json"), {});
const sessionIds = listSessionIds(workspacePath);
const currentSessionId = current.currentSessionId || sessionIds[0] || null;
const sessionCompleteness = currentSessionId ? sessionFilesComplete(currentSessionId) : { ok: false, missing: ["current_session"], dir: null };
const currentChartTypes = currentSessionId ? chartTypesForSession(currentSessionId) : [];
const gitignore = safeReadText(path.join(workspacePath, ".gitignore"));
const registry = safeReadText(path.join(workspacePath, "config", "query-providers.yaml"));
const requiredGitignore = [
  ".env",
  "logs/",
  "tmp/",
  "app/node_modules/",
  "sessions/**/result.full.json",
  "sessions/**/raw/"
];
const missingGitignore = requiredGitignore.filter((item) => !gitignore.includes(item));
const appHost = localhostOk();
const secrets = secretFindings();
const skillRunsPath = path.join(workspacePath, "logs", "skill-runs.jsonl");
const appPackage = readJson(path.join(workspacePath, "app", "package.json"), {});
const widgetText = safeReadText(path.join(workspacePath, "app", "resources", "bi-dashboard", "widget.tsx"));
const externalReadiness = latestJsonIn("logs/external-readiness", "external-readiness-");
const appCheck = fs.existsSync(path.join(workspacePath, "app", "index.mjs"))
  ? spawnSync(process.execPath, ["index.mjs", "--check"], {
      cwd: path.join(workspacePath, "app"),
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BI_WORKSPACE: workspacePath,
        BAIZHI_BI_WORKSPACE: workspacePath
      }
    })
  : { status: 1, stdout: "", stderr: "app/index.mjs 不存在" };

const acceptance = [
  check("workspace.default_path", "Skill 可定位默认共享工作区", workspacePath.endsWith(path.join("Documents", "AgentBI", "agent-bi-workspace")) || workspacePath.endsWith(path.join("Documents", "BaizhiBI", "agent-bi-workspace")) || Boolean(process.env.AGENT_BI_WORKSPACE) || Boolean(process.env.BAIZHI_BI_WORKSPACE), { workspacePath }),
  check("workspace.structure", "Skill 可初始化工作区目录结构", ["config", "app", "knowledge", "metrics", "sessions", "dashboards", "logs", "tmp"].every(exists), { workspacePath }),
  check("workspace.gitignore", "工作区包含安全 .gitignore", missingGitignore.length === 0, { missingGitignore }, "`.gitignore` 缺少必要规则。"),
  check("providers.registry", "工作区包含 Query Provider Registry", exists("config/query-providers.yaml"), { path: path.join(workspacePath, "config", "query-providers.yaml") }),
  check("app.scaffold", "本地 BI App scaffold 已生成", exists("app/package.json") && exists("app/index.ts") && exists("app/resources/bi-dashboard/widget.tsx"), {}),
  check("app.widget_template", "mcp-use Widget 模板可展示当前分析摘要", widgetText.includes("BiDashboardWidget") && widgetText.includes("数据预览") && !widgetText.includes("return null"), {}, "widget.tsx 仍是空组件或缺少中文展示内容。"),
  check("app.runnable_entrypoint", "共享工作区 App 可作为本地入口启动", appPackage.scripts?.start === "node index.mjs" && appCheck.status === 0, { start: appPackage.scripts?.start, stdout: appCheck.stdout?.trim(), stderr: appCheck.stderr?.trim() }, "app/index.mjs 自检失败或 package start 未指向本地入口。"),
  check("dashboard.current", "Dashboard 当前状态可读取", exists("dashboards/current.json"), current),
  check("session.create", "可创建查询 session", Boolean(currentSessionId), { currentSessionId }),
  check("session.files", "session 保存完整标准文件", sessionCompleteness.ok, { currentSessionId, missing: sessionCompleteness.missing, sessionPath: sessionCompleteness.dir }),
  check("metrics.saved", "可保存至少一个指标 YAML", listMetricFiles().length > 0, { metricFiles: listMetricFiles() }),
  check("providers.read", "可读取并使用 Query Provider Registry", /providers:\s*\n/.test(registry), {}),
  check("providers.internal_data_default", "通用内部数据查询 provider 已登记", /default_provider:\s*internal_data_query/.test(registry) && /id:\s*internal_data_query/.test(registry), {}),
  check("providers.handoff", "可生成查询源执行交接包", fs.existsSync(path.join(scriptsDir, "create_query_handoff.mjs")) && hasProviderHandoff(sessionIds), { sessionCount: sessionIds.length }, "缺少 provider-handoff/handoff.json 或 CLI 脚本。"),
  check("providers.execution_record", "可记录查询源执行结果和数据源说明", fs.existsSync(path.join(scriptsDir, "record_provider_execution.mjs")) && hasProviderExecutionRecord(sessionIds), { sessionCount: sessionIds.length }, "缺少 provider-execution.json 或 CLI 脚本。"),
  check("providers.custom_template", "普通 MCP provider 有登记模板和 schema 存储位置", /id:\s*custom_mcp_query_service/.test(registry) && exists("knowledge/query-providers/custom_mcp_query_service/input-schema.json") && exists("knowledge/query-providers/custom_mcp_query_service/output-schema.json"), {}),
  check("frontend.current_session", "前端可展示当前 session 的数据基础已存在", currentChartTypes.length > 0 && sessionCompleteness.ok, { currentSessionId, chartTypes: currentChartTypes }),
  check("frontend.chart_types", "前端可展示至少三类图表/表格", currentChartTypes.length >= 3, { chartTypes: currentChartTypes }),
  check("revision.evidence", "Agent 可基于历史 session 二次修订", hasRevisionEvidence(sessionIds), { sessionCount: sessionIds.length }),
  check("full_result.ignored", "默认不提交完整明细结果", gitignore.includes("sessions/**/result.full.json"), {}),
  check("failure.session", "查询失败时仍保存失败 session 和错误原因", hasFailedSession(sessionIds), { sessionCount: sessionIds.length })
];

const security = [
  check("security.no_secrets", "配置文件未发现明文 token/password/cookie", secrets.length === 0, { suspicious: secrets }, "配置文件疑似包含敏感字段。"),
  check("security.localhost", "Local server 默认绑定 localhost", appHost.ok, appHost, "config/app.json host 不是本机地址。"),
  check("security.gitignore_required", "Git 安全忽略规则齐全", missingGitignore.length === 0, { missingGitignore }),
  check("security.provider_readonly", "默认 provider 声明只读和禁止明细 dump", /read_only:\s*true/.test(registry) && /allow_detail_dump:\s*false/.test(registry), {}),
  check("security.run_log", "运行日志已落地", fs.existsSync(skillRunsPath), { skillRunsPath }),
  check("security.no_app_dependencies", "本地 App 无需联网安装依赖即可启动", Object.keys(appPackage.dependencies || {}).length === 0, { dependencies: Object.keys(appPackage.dependencies || {}) }, "若新增依赖，必须通过 app/node_modules/ gitignore 和 ensure_app.mjs 安装检查。")
];

const externalVerification = [
  {
    id: "external.bairong_live_dms",
    label: "生产 DMS 查询执行准备度",
    status: externalReadiness?.value?.readyForLiveQuery ? "readiness_passed" : "manual_required",
    evidence: externalReadiness ? { outputPath: externalReadiness.path, passed: externalReadiness.value.passed, total: externalReadiness.value.total } : null,
    reason: externalReadiness?.value?.readyForLiveQuery
      ? "只读 readiness 已通过；真实业务查询仍需用户提出具体问题后由 Agent 调用已登记 DMS/MCP provider 执行。"
      : "未发现通过的 external-readiness 报告；真实生产 DMS 查询需要用户已配置的 DMS/MCP provider 环境。"
  },
  {
    id: "external.literal_mcp_use_runtime",
    label: "字面 mcp-use React runtime",
    status: appPackage.scripts?.start === "node index.mjs" && appCheck.status === 0 ? "local_entrypoint_ready" : "scaffolded",
    reason: "工作区已生成 mcp-use App/Widget scaffold，并提供 app/index.mjs 本地入口启动同一个 Dashboard；完整第三方 mcp-use React runtime 仍可在后续接入。"
  }
];

const acceptancePassed = acceptance.filter((item) => item.status === "pass").length;
const securityPassed = security.filter((item) => item.status === "pass").length;
const summary = {
  auditedAt,
  workspacePath,
  ok: acceptancePassed === acceptance.length && securityPassed === security.length,
  acceptance: {
    passed: acceptancePassed,
    total: acceptance.length,
    checks: acceptance
  },
  security: {
    passed: securityPassed,
    total: security.length,
    checks: security
  },
  externalVerification
};

const outputDir = path.join(workspacePath, "logs", "evaluations");
mkdirp(outputDir);
const outputPath = path.join(outputDir, `prd-audit-${auditedAt.replace(/[:.]/g, "-")}.json`);
writeJson(outputPath, summary);
logSkillRun(workspacePath, "prd_audit.run", {
  ok: summary.ok,
  acceptancePassed,
  acceptanceTotal: acceptance.length,
  securityPassed,
  securityTotal: security.length,
  outputPath
});

console.log(JSON.stringify({ ...summary, outputPath }, null, 2));
process.exit(summary.ok ? 0 : 1);
