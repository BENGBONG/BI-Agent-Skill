#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  mkdirp,
  logSkillRun,
  nowIso,
  parseArgs,
  resolveWorkspacePath,
  sessionDir,
  writeJson,
  writeText
} from "./lib/workspace.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();
const now = new Date();
const defaultSessionId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-001`;
const sessionId = args["session-id"] || defaultSessionId;
const dir = sessionDir(workspacePath, sessionId);
const sample = Boolean(args.sample);
const question = args.question || (sample ? "查看最近 30 天各渠道授信通过率趋势。" : "新的 BI 分析问题");
const createdAt = nowIso();

mkdirp(dir);

writeText(path.join(dir, "request.md"), `# 原始需求

${question}
`);

writeText(path.join(dir, "interpretation.md"), `# Agent 解析

- 指标：credit_approval_rate
- 时间范围：最近 30 天
- 维度：日期、渠道
- 过滤条件：无
- Provider：internal_data_query
- 假设：使用授信申请创建时间作为时间口径
`);

writeText(path.join(dir, "metric-plan.yaml"), `question: ${JSON.stringify(question)}
time_range:
  type: relative
  value: last_30_days
dimensions:
  - date
  - channel
metrics:
  - id: credit_approval_rate
    source: metrics/credit_approval_rate.yaml
filters: []
assumptions:
  - 使用授信申请创建时间作为时间口径。
risks:
  - 需要确认渠道字段使用注册渠道还是落地页渠道。
`);

writeText(path.join(dir, "query-plan.sql"), `-- Provider: internal_data_query
-- 这是用于 Dashboard 验证的示例 SQL，不代表已执行的生产查询。
select
  date(apply_time) as apply_date,
  channel,
  count(distinct case when credit_status = 'APPROVED' then user_id end) / nullif(count(distinct user_id), 0) * 100 as approval_rate
from credit_apply
where apply_time >= current_date - interval '30' day
group by 1, 2
order by 1, 2;
`);

const rows = sample
  ? [
      { apply_date: "2026-05-29", channel: "organic", approval_rate: 41.2, applicants: 842 },
      { apply_date: "2026-05-29", channel: "paid", approval_rate: 36.4, applicants: 621 },
      { apply_date: "2026-06-05", channel: "organic", approval_rate: 43.8, applicants: 901 },
      { apply_date: "2026-06-05", channel: "paid", approval_rate: 38.1, applicants: 677 },
      { apply_date: "2026-06-12", channel: "organic", approval_rate: 45.3, applicants: 930 },
      { apply_date: "2026-06-12", channel: "paid", approval_rate: 39.9, applicants: 702 },
      { apply_date: "2026-06-19", channel: "organic", approval_rate: 44.6, applicants: 918 },
      { apply_date: "2026-06-19", channel: "paid", approval_rate: 40.7, applicants: 711 },
      { apply_date: "2026-06-26", channel: "organic", approval_rate: 46.1, applicants: 955 },
      { apply_date: "2026-06-26", channel: "paid", approval_rate: 41.4, applicants: 735 }
    ]
  : [];

const result = {
  columns: ["apply_date", "channel", "approval_rate", "applicants"],
  rows,
  summary: {
    primaryMetric: "approval_rate",
    primaryValue: rows.length ? rows[rows.length - 1].approval_rate : null,
    unit: "%",
    rowCount: rows.length
  }
};

writeJson(path.join(dir, "result.aggregate.json"), result);
writeJson(path.join(dir, "result.preview.json"), {
  columns: result.columns,
  rows,
  truncated: false,
  maxPreviewRows: null
});

writeJson(path.join(dir, "chart-spec.json"), {
  version: "0.1",
  sessionId,
  title: "授信通过率趋势",
  charts: [
    {
      id: "approval_rate_trend",
      type: "line",
      title: "各渠道授信通过率趋势",
      description: "按申请日期和渠道分组。",
      x: "apply_date",
      y: "approval_rate",
      series: "channel",
      unit: "%",
      dataRef: "result.aggregate.json"
    },
    {
      id: "latest_channel_bar",
      type: "bar",
      title: "最新一期各渠道通过率",
      x: "channel",
      y: "approval_rate",
      filterLatestBy: "apply_date",
      unit: "%",
      dataRef: "result.aggregate.json"
    },
    {
      id: "applicant_mix",
      type: "pie",
      title: "申请人数渠道占比",
      label: "channel",
      value: "applicants",
      filterLatestBy: "apply_date",
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
});

writeText(path.join(dir, "audit.md"), `# 审计说明

- Session id：${sessionId}
- 创建时间：${createdAt}
- Provider id：internal_data_query
- Provider 名称：内部数据查询
- 执行状态：${sample ? "sample_data" : "planned"}
- 数据源说明：仅使用示例数据，未执行生产查询。
- 风险提示：将该口径视为 validated 前，需要确认渠道字段语义。
`);

writeJson(path.join(dir, "metadata.json"), {
  sessionId,
  createdAt,
  updatedAt: createdAt,
  agent: "codex",
  status: sample ? "sample_data" : "planned",
  question,
  metrics: ["credit_approval_rate"],
  providerId: "internal_data_query"
});

writeJson(path.join(workspacePath, "dashboards", "current.json"), {
  currentSessionId: sessionId,
  updatedAt: createdAt
});

const runLogPath = logSkillRun(workspacePath, "session.created", {
  sessionId,
  status: sample ? "sample_data" : "planned",
  providerId: "internal_data_query"
});

console.log(JSON.stringify({ ok: true, workspacePath, sessionId, sessionPath: dir, runLogPath }, null, 2));
