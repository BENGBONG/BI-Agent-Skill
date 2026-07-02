# Query Provider Registry

Provider 声明保存在 `config/query-providers.yaml`。

Provider 状态：

- `enabled`：Agent 可在路由证据匹配时自动选择。
- `draft`：执行前必须向用户确认。
- `disabled`：不可执行。

Provider 选择顺序：

1. 用户显式指定的 provider。
2. 根据业务域、指标、表名和关键词匹配到的 enabled provider。
3. 已复用指标中记录的 provider。
4. `default_provider`。

如果多个 provider 可能返回不同数据源，必须停止自动执行并请用户选择。

本地路由检查：

- CLI：`node scripts/select_provider.mjs --question "最近 30 天授信通过率" --keywords "credit,channel"`
- API：`POST /api/providers/select`
- MCP 工具面：`select-query-provider`
- 返回值中的 `requiresConfirmation` 为 `true` 时，Agent 必须在真实执行前向用户确认。

必需字段示例：

```yaml
id: internal_data_query
type: dms_sql
display_name: 内部数据查询
status: enabled
aliases:
  - bairong_data_query
routing_keywords:
  - 生产业务库
  - DMS
  - SQL
safety_policy:
  read_only: true
  allow_detail_dump: false
  require_source_statement: true
  max_preview_rows: unlimited
output_mapping:
  aggregate_result: sessions/{session_id}/result.aggregate.json
  preview_result: sessions/{session_id}/result.preview.json
```

`mcp_tool` provider 还需要记录：

- MCP server hint。
- Tool name。
- 可选 `tool_names`：同一个 MCP server 暴露多个辅助工具时，记录完整工具清单；`tool_name` 保留主查询工具。
- Input schema 引用。
- Output schema 引用。
- Output mapping。
- 安全假设。

Dashboard 当前分析页必须展示当前 session 的查询源摘要：

- Provider id 和 display name。
- Provider type、status。
- MCP server hint 和 tool name（如有）。
- Legacy skill entrypoint（如旧环境使用的特定查询 Skill，可选）。
- Routing keywords。
- Safety policy 摘要。

未登记 provider 不可用于自动 BI 查询执行。

线上日志 MCP 约定：

- Provider id：`online_logs`。legacy alias：`baizhi_online_logs`。
- MCP server hint：`alibaba_cloud_observability`。
- 主查询工具：`sls_execute_sql`。
- 辅助工具：`sls_list_projects`、`sls_list_logstores`、`sls_get_context_logs`、`cms_execute_promql`、`sls_execute_spl`。
- 适用场景：线上日志、SLS、LogStore、APP token 活跃、行为日志、错误日志、PromQL 和 SPL。
- Agent 必须在用户确认指标、数据源、计算口径和时间范围后才调用；Dashboard 不得直接调用该 MCP。

Smoke test：

- `node scripts/smoke_test_provider.mjs --id <provider-id>` 只验证本地 registry 和 schema 文件。
- smoke test 不执行真实数据查询。
- 结果写入 `knowledge/query-providers/<provider-id>/smoke-test-*.json`。
- `draft` provider 即使 smoke test 通过，真实执行前仍需用户确认。

Benchmark：

- `node scripts/run_benchmark.mjs` 使用 `evaluations/benchmark-cases.json`。
- benchmark 只检查 provider 路由、期望指标和确认提示样例，不执行真实数据查询。
- 结果写入 `logs/benchmarks/benchmark-*.json`。

CLI 登记：

```bash
node scripts/register_provider.mjs \
  --id custom_mcp_query_service \
  --name "自定义 MCP 查询服务" \
  --mcp-server custom-query-mcp \
  --tool query \
  --keywords "自定义查询,mcp query"
```

Dashboard/API 登记：

```http
POST /api/providers
content-type: application/json

{
  "id": "custom_mcp_query_service",
  "type": "mcp_tool",
  "displayName": "自定义 MCP 查询服务",
  "status": "draft",
  "mcpServerHint": "custom-query-mcp",
  "toolName": "query",
  "routingKeywords": ["自定义查询"]
}
```
