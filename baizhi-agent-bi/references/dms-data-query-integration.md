# DMS 数据查询 Provider 集成规则

生产数据查询必须通过已登记的只读查询 provider 执行。默认通用 provider id 为 `internal_data_query`，旧环境中的 `bairong_data_query` 仅作为 legacy alias 兼容。

## 执行边界

- 只允许单条 `SELECT` 或 `WITH ... SELECT`。
- 禁止 `SHOW`、`DESCRIBE`、`EXPLAIN`、`USE`、`SET`、DDL、DML、权限变更和长事务。
- 必须先完成 Agent 对话确认单，确认指标、数据源、计算口径、时间范围、去重和 fallback。
- Dashboard 只展示结果，不执行生产查询。
- 不保存 token、Authorization、Cookie、密码、密钥或未限制范围的生产明细。

## 查询前

在调用 DMS/MCP provider 前，为当前 session 生成交接包：

```bash
node scripts/create_query_handoff.mjs \
  --session-id <session-id> \
  --provider-id internal_data_query
```

交接包包含原始需求、Agent 解析、指标计划、查询计划、安全规则、产物导入目标和回填命令。`query-plan.json` 中的表、字段和 SQL 片段是候选实现，不是唯一锁定路径；执行时以用户确认的指标意图和核心口径为准。

## 查询后

查询完成后必须记录 provider 执行信息和数据源确认语句：

```bash
node scripts/record_provider_execution.mjs \
  --session-id <session-id> \
  --provider-id internal_data_query \
  --status completed \
  --source-statement "本次查询使用 <环境/库/schema/table/provider>，只读聚合，不含敏感明细。"
```

如果 provider 产出 JSON / SVG / PNG 文件，默认放入 `provider-output/` 并导入当前 session：

```bash
node scripts/import_provider_artifacts.mjs \
  --session-id <session-id> \
  --source-dir ~/Documents/AgentBI/agent-bi-workspace/provider-output
```

导入产物或记录查询完成后，Agent 必须同步右侧 Agent 内置浏览器：如果 `/dashboard` 已打开则刷新；否则导航到脚本返回的 `browserUrl`，默认 `http://127.0.0.1:3000/dashboard`。

## Fallback

如果第一候选表不存在、字段不可查、结果为空或覆盖明显不足，不能直接返回空结果。必须按 `implementationStrategies` / `fallbackPolicy` 尝试其他候选表、日志/业务表组合、多表融合，或明确记录当前 provider 无法支撑该指标。
