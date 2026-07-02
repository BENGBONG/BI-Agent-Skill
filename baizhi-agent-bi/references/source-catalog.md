# Source Capability Catalog

`knowledge/source-catalog/` 保存数据源能力索引，用于让 Agent 在自然语言理解阶段先知道“能查什么、字段是否可用、字段背后的后端逻辑证据是什么”。

构建命令：

```bash
node scripts/build_source_catalog.mjs
```

构建输入：

- `config/query-providers.yaml`
- `config/mcp-servers.json`
- `knowledge/query-providers/*/input-schema.json`
- `knowledge/query-providers/*/tools/*.input-schema.json`
- `knowledge/backend-projects.yaml`
- `knowledge/code-scans/*.md`
- `knowledge/field-mappings/*.yaml`
- `knowledge/field-meanings/*.json`

输出文件：

- `index.json`：构建时间、数量摘要和文件路径。
- `services.json`：后端项目、MCP 服务和扫描证据。
- `query-capabilities.json`：provider 类型、工具、路由关键词、schema 字段和安全策略。
- `field-lineage.json`：字段名、领域、provider hints、证据、可查询状态和敏感级别。
- `metric-candidates.json`：根据字段和服务推断的候选指标、所需字段和风险。

使用规则：

- Agent 创建确认单前必须读取 source catalog。
- source catalog 只能作为候选证据，不替代用户、研发确认或新的后端复核。不能全信历史扫描出的后端逻辑。
- 如果字段 `queryable` 为 `unknown`，不得假设它能直接用于生产查询。
- `sensitivity=secret` 的字段不能进入结果明细、preview 或 Dashboard。
- 如果指标依赖 token、Authorization、cookie 等敏感字段，必须优先寻找脱敏后的 `resolved_user_id` 或后端聚合视图。
- source catalog 过期、结果为空、字段含义不符合业务常识、生产 schema 与扫描结果冲突、或用户质疑后端逻辑时，应先重跑后端扫描、检查相关仓库代码或执行 provider smoke test，再重建 catalog。
- 自然语言理解阶段应从指标意图出发，结合 source catalog 推测多个查询假设；执行阶段按候选策略验证，不得把 catalog 中的某张表/某个字段当成唯一答案。

## 查询沉淀字段说明

每次查询完成后，Agent 必须询问用户是否把本次查询逻辑沉淀到知识库。用户确认后，使用：

```bash
node scripts/update_knowledge_fields_from_query.mjs \
  --session-id <session-id> \
  --confirm-update-knowledge \
  --confirmed-by <user-or-owner> \
  --updates-json /tmp/field-updates.json
```

`updates-json` 可以是数组，也可以是 `{ "updates": [...] }`：

```json
{
  "updates": [
    {
      "field": "resolved_user_id",
      "meaning": "脱敏后的用户唯一标识，用于 APP 活跃用户去重。该字段不能反推原始 token，在本次活跃用户指标中按天 count(distinct resolved_user_id) 计算。",
      "role": "dedup_key",
      "sourceTables": ["online_logs:app_access_log"],
      "calculationUsage": "作为活跃用户去重键；同一用户同一天多次访问只计 1 个活跃用户。",
      "evidence": ["sessions/2026/06/<session-id>/metric-plan.yaml"]
    }
  ]
}
```

要求：

- `meaning` 必须是可复用的业务解释，至少说明字段代表什么、如何产生或脱敏、在本次指标中如何使用。
- 不得写 `TBD`、`unknown`、`待确认` 这类占位内容。
- 写入后重跑 `node scripts/build_source_catalog.mjs`，让 `field-lineage.json` 和 Dashboard 知识库刷新。
