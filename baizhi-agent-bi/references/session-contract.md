# 查询 Session 文件约定

每次 BI 查询创建目录：`sessions/YYYY/MM/<session-id>/`。

必需文件：

- `request.md`：用户原始自然语言需求。
- `interpretation.md`：Agent 对指标、维度、过滤条件、时间范围和假设的解析。
- `confirmation.json`：执行前确认单。未确认前只能保存草稿，不能执行生产查询或生成 provider handoff。
- `metric-plan.yaml`：结构化指标计划。
- `query-plan.sql` 或 `query-plan.json`：SQL 或 provider 调用计划。
- `result.aggregate.json`：用于图表和 KPI 的聚合结果。
- `result.preview.json`：provider 返回的 preview 结果；Dashboard 不主动截断行数。
- `chart-spec.json`：Dashboard 图表和表格配置。
- `audit.md`：provider、数据源、证据、假设、风险和执行说明。
- `metadata.json`：session 状态、provider、指标 id、时间戳和 revision 索引。

可选目录：

- `revisions/<revision-id>/`：同一 session 下的修订版指标计划、查询计划和审计说明。
- `pending-actions/<action-id>.json`：Dashboard 发起、等待 Agent 处理的动作，例如下钻。
- `attachments/`：从 provider 或 `@bairong-data-query` 导入的 JSON/SVG/PNG 审计附件。
- `attachments.json`：附件索引，记录来源路径、类型、导入时间和说明。
- `dashboards/comparisons/*.json`：两个 session 的对比结果，包括状态、provider、结果行数和计划 diff。

查询完成后的知识库更新确认：

- 每次查询产物导入或 provider 执行记录为 `completed` 后，session 应生成 `pending-actions/knowledge-update-review.json`。
- 该 action 的作用是提醒 Agent 在对话中询问用户：是否根据本次查询逻辑更新知识库字段说明。
- 用户未确认前不得修改 `knowledge/field-meanings/`。
- 用户确认后，使用 `scripts/update_knowledge_fields_from_query.mjs` 写入详细字段含义，并把 action 状态更新为 `completed`。

查询完成后的 Agent Dashboard 同步：

- 查询任务完成、失败 session 创建、provider 产物导入或 `dashboards/current.json` 更新后，Agent 必须在 Codex 右侧 Agent 内置浏览器打开或刷新 `browserUrl`，默认路径为 `http://127.0.0.1:3000/dashboard`。
- 若右侧浏览器已经在同端口 Dashboard 页面，刷新当前 tab；若未打开或停留在其他页面，导航到脚本返回的 `browserUrl`。
- Dashboard 通过 `dashboards/current.json` 定位当前查询 session；Agent 只需要确保当前 session 已写入 current，再打开或刷新 `/dashboard`。
- 禁止用 macOS `open`、系统默认浏览器、外部 Chrome 窗口来完成查询后的默认同步。`/mcp-use/widgets/bi-dashboard` 只是备用 widget 路由，不是查询完成后的默认目标。
- 该动作由 Agent 对话环境执行，不能放到 Dashboard server 或生产查询 provider 内部；脚本返回的 `browserAction=open_or_refresh_agent_dashboard_browser` 是提醒 Agent 使用右侧内置浏览器执行打开/刷新。

复制为新查询：

- 使用 `node scripts/clone_session.mjs --source <session-id>` 或 `/mcp` 工具 `clone-query-session`。
- 新 session 必须写入 `metadata.linkedFrom` 和 `metadata.copyReason`。
- 新 session 默认状态为 `planned`，避免把历史结果误认为新查询已执行。
- `audit.md` 必须追加源 session、复制时间和复制原因。

修订和新 session 的边界：

- 同一 session 的 `revisions/<revision-id>/` 用于保存尚未重新执行的口径、数据源、计算逻辑或查询计划修订。
- 每个 revision 应至少包含 `change.md`，并尽量包含 `metric-plan.yaml`、`query-plan.json` 或 `query-plan.sql`、`audit.md`。
- 如果修订后的口径已经执行并产生新的 `result.aggregate.json`、`result.preview.json` 或 `chart-spec.json`，必须创建新 session，不能覆盖原 session 结果。
- 新 session 必须通过 `metadata.linkedFrom` 指向来源 session，并在 `audit.md` 说明新旧口径差异。
- Dashboard 应展示 revision 时间线；已执行结果之间的对比使用 `dashboards/comparisons/*.json`。

执行前质量门：

1. 指标定义明确。
2. 比率类指标的分子和分母明确。
3. 时间字段和时间范围明确。
4. 聚合粒度明确。
5. 维度字段明确。
6. 涉及用户或申请去重时，去重逻辑明确。
7. 涉及多表时，join 逻辑明确。
8. 已引用后端证据或已有指标口径。
9. Provider 选择理由已记录。
10. Provider 已登记且未禁用。
11. `confirmation.json.status` 已由用户确认并写为 `confirmed`。
12. 关键不确定项已确认，或已写入 assumptions。
13. 已区分指标意图和具体实现字段：`metricIntent` 或等价说明必须表达业务对象、统计单位和期望效果。
14. `query-plan.json` 必须包含候选查询策略：`queryHypotheses` / `implementationStrategies` / `candidatePlans` 至少一种，不能只给单表单字段 SQL。
15. 必须包含 fallback 规则：第一候选表为空、字段不存在或覆盖不足时，如何切换候选表、组合多表或记录不可支撑。
16. 查询完成后必须回填 `actualExecution` 或在 `audit.md` 说明最终实际采用逻辑、放弃的候选和覆盖限制。

`confirmation.json` 最小结构：

```json
{
  "version": 1,
  "status": "draft",
  "confirmedAt": null,
  "confirmedBy": "",
  "question": "最近 7 天 Agent 执行的任务类型分布统计",
  "providerId": "internal_data_query",
  "metrics": ["agent_task_execution_count"],
  "metricIntent": {
    "businessObject": "Agent 任务执行事件",
    "measurementGoal": "衡量最近 7 天不同任务类型的执行分布，而不是验证某张表是否有记录。",
    "statisticalUnit": "一次可去重的 Agent 执行 / run_key",
    "successCriteria": "能解释最终结果覆盖哪些执行来源，不覆盖哪些执行来源。"
  },
  "metricDefinition": "Agent 执行事件数，按任务类型聚合。",
  "sourceTables": ["候选：任务明细表、会话消息表、调度执行表、权益流水表、线上日志"],
  "calculationLogic": "count(*) grouped by task_type",
  "timeRange": "最近 7 天",
  "timeField": "候选：created_at / timestamp / start_time",
  "dimensions": ["task_type"],
  "filters": [],
  "dedupLogic": "按执行事件唯一记录计数，不按用户去重。",
  "joinLogic": "无",
  "queryHypotheses": [
    {
      "id": "task_fact_table",
      "description": "任务明细表可能记录细粒度 task_type。",
      "coverage": "覆盖写入任务明细的执行，不保证覆盖纯会话或无扣减任务。",
      "risk": "表为空或 task_type 缺失时需要 fallback。"
    }
  ],
  "backendRecheckPolicy": "知识库扫描结果只是证据缓存。若用户质疑、结果为空、字段/表不可查、生产 schema 与代码扫描冲突或字段含义不符合业务常识，必须重新检查后端代码、provider schema 或领域文档。",
  "implementationStrategies": [
    {
      "id": "multi_candidate_union",
      "priority": 1,
      "goal": "以满足任务执行分布指标为核心，组合多个候选后端表构造 run_key 后去重。",
      "candidateSources": ["task_details", "scheduled_task_execution", "quota_usage_log"],
      "abandonWhen": "关键字段不存在、生产 schema 无表或结果无法解释核心指标。",
      "fallbackTo": ["online_logs", "session_message", "provider_schema_scan"]
    }
  ],
  "fallbackPolicy": "第一候选为空、字段不存在或覆盖不足时，不直接返回 0；继续尝试其他候选表或多表融合。只有所有候选不可用时才记录失败。",
  "backendEvidence": [],
  "assumptions": [],
  "risks": []
}
```

`query-plan.json` 推荐结构：

```json
{
  "providerId": "internal_data_query",
  "metricIntent": {
    "businessObject": "Agent 任务执行事件",
    "measurementGoal": "统计任务类型分布",
    "statisticalUnit": "run_key"
  },
  "queryHypotheses": [
    {
      "id": "session_message_fact",
      "description": "会话消息表可能最接近全量 Agent 运行事实。",
      "evidence": ["后端 Entity 或 source-catalog 线索"],
      "coverage": "覆盖会话消息落库的运行。",
      "risk": "生产库 schema 可能未暴露该表。"
    }
  ],
  "implementationStrategies": [
    {
      "id": "primary_fact",
      "priority": 1,
      "candidateSources": ["session_message", "session", "users"],
      "timeFields": ["timestamp", "created_at"],
      "dedupLogic": "COALESCE(run_id, thread_id + message_id)",
      "adoptWhen": "表和关键字段可查且结果覆盖核心执行事实。",
      "abandonWhen": "表不存在、关键字段不存在或结果只覆盖局部事实。",
      "fallbackTo": ["backend_candidate_union"]
    },
    {
      "id": "backend_candidate_union",
      "priority": 2,
      "candidateSources": ["t_task_details", "t_scheduled_task_execution", "t_user_quota_usage_log", "t_users"],
      "dedupLogic": "各来源构造 run_key 后 UNION ALL，再按优先级归类去重。",
      "coverage": "覆盖当前 DMS schema 可查询后端候选表，不声明为全量。"
    }
  ],
  "backendRecheckPolicy": "不能全信历史 source-catalog。证据冲突、schema 不一致、字段含义不确定或用户质疑时，重新检查后端逻辑。",
  "fallbackPolicy": "按 priority 尝试候选；某策略为空或不可用时继续下一策略，并在 audit 记录放弃原因。",
  "actualExecution": null
}
```

确认状态：

- `draft`：Agent 或 Dashboard 生成的草稿，必须等待用户确认。
- `confirmed`：用户已确认指标、数据源和计算口径，可进入质量门。
- `confirmed_blocked`：用户已确认，但质量门发现阻断项，不能生成 provider handoff。

本地质量门命令：

```bash
node scripts/quality_gate.mjs \
  --metric-plan-file sessions/2026/06/2026-06-27-001/metric-plan.yaml \
  --query-plan-file sessions/2026/06/2026-06-27-001/query-plan.sql \
  --provider-id internal_data_query
```

Dashboard/API 等价入口：

- `POST /api/quality-gate`
- `/mcp` 工具：`run-quality-gate`

导入 provider 产物：

```bash
node scripts/import_provider_artifacts.mjs \
  --session-id 2026-06-27-001 \
  --aggregate-path /tmp/result.aggregate.json \
  --preview-path /tmp/result.preview.json \
  --chart-spec-path /tmp/chart-spec.json \
  --query-plan-path /tmp/query-plan.sql \
  --query-plan-type sql \
  --audit-path /tmp/audit.md
```

默认禁止导入完整明细结果。若用户明确要求导入 `result.full.json`，必须显式加 `--allow-full-result`，且该文件仍受工作区 `.gitignore` 保护。

`result.aggregate.json` 示例：

```json
{
  "columns": ["date", "channel", "approval_rate"],
  "rows": [
    {"date": "2026-06-01", "channel": "organic", "approval_rate": 42.1}
  ],
  "summary": {
    "primaryMetric": "approval_rate",
    "primaryValue": 42.1,
    "unit": "%"
  }
}
```

`chart-spec.json` 示例：

```json
{
  "version": "0.1",
  "sessionId": "2026-06-27-001",
  "charts": [
    {
      "id": "trend",
      "type": "line",
      "title": "授信通过率趋势",
      "x": "date",
      "y": "approval_rate",
      "series": "channel",
      "unit": "%",
      "dataRef": "result.aggregate.json"
    }
  ],
  "tables": [
    {"id": "preview", "title": "结果预览", "dataRef": "result.preview.json"}
  ]
}
```

Revision 示例：

```json
{
  "revisionId": "rev-001",
  "createdAt": "2026-06-27T00:00:00.000Z",
  "reason": "渠道改用落地页渠道，而不是注册渠道"
}
```

待处理下钻动作示例：

```json
{
  "actionId": "drill-001",
  "type": "drill_down",
  "status": "pending",
  "sessionId": "2026-06-27-001",
  "chartId": "approval_rate_trend",
  "dimension": "channel",
  "value": "paid",
  "filters": {},
  "reason": "Dashboard 下钻请求"
}
```

失败 session 要求：

- `metadata.status` 必须为 `failed`。
- `audit.md` 必须记录失败原因、provider、诊断建议。
- 即使没有结果，也必须保留空的 `result.aggregate.json`、`result.preview.json` 和 `chart-spec.json`。
- 不得伪造空图表作为成功结果。
