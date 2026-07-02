# `@bairong-data-query` 集成规则

内部生产数据查询必须使用已登记的查询 provider。当前兼容 `@bairong-data-query`，本 Skill 不替代它，也不绕过它直连数据库。

强制执行规则：

1. 查询必须通过用户已配置的 DMS MCP server：`aliyun-dms-mcp-server`。
2. DMS tool 名称必须为 `executeScript`。
3. 参数必须使用 snake_case：`database_id` 和 `script`。
4. `script` 必须是单条 `SELECT` 或 `WITH ... SELECT`。
5. 禁止 `SHOW`、`DESCRIBE`、`EXPLAIN`、`USE`、`SET`、DDL、DML、权限变更和任何写操作。
6. `database_id` 必须来自插件生产数据库 registry。
7. 不允许降级到本地测试库、集成库或未登记 MySQL MCP 服务。
8. 优先执行聚合查询，只保存受限 preview。

查询计划前按以下优先级读取事实：

1. `config/data-domains.yaml`
2. 相关 `references/domain-*.md`
3. `config/chronos-table-metadata.yaml`
4. `config/query-templates.yaml`
5. 后端代码证据路径

当文档和代码证据冲突时，代码证据优先。必须在 `audit.md` 记录冲突和最终采用的依据。

每个使用该 provider 的 session 都必须在 `audit.md` 中包含数据源确认语句，例如生产库名称、schema 和 DMS `database_id`。

## 指标意图优先与候选策略

`@bairong-data-query` 的执行上下文必须把用户确认的指标意图放在首位。`query-plan.json` 中的表、字段和 SQL 片段是候选实现，不是唯一锁定路径，除非用户明确要求“只查某张表/只用某字段”。

执行规则：

1. 先读取 `metricIntent`、`calculationLogic`、`dedupLogic`、`implementationStrategies` 和 `fallbackPolicy`。
2. 按策略优先级尝试候选表、候选字段或多表组合。
3. 若第一候选表不存在、字段不可查、结果为空或覆盖明显不足，不得直接返回 0；应尝试下一候选或组合查询。
4. 若历史知识库扫描、后端代码证据和生产 schema 冲突，应重新检查后端仓库逻辑或 provider schema，并在 `audit.md` 记录冲突。
5. 执行完成后必须回填实际采用逻辑：最终使用的表/字段、放弃的候选、放弃原因、覆盖范围和不覆盖范围。

## 执行前 readiness 检查

真实查询前可先运行只读检查：

```bash
node scripts/check_external_readiness.mjs
```

该脚本只验证本机是否能发现：

- `config/query-providers.yaml` 中的 `bairong_data_query` provider。
- `@bairong-data-query/natural-language-data-query` Skill。
- 插件生产库 registry 和业务域 registry。
- 工作区 `config/mcp-servers.json` 中的 `aliyun-dms-mcp-server` / `executeScript` 非敏感提示。
- Codex-only DMS fallback 脚本。

检查结果写入 `logs/external-readiness/`。它不会执行生产 DMS 查询，也不会读取或保存 token。若 readiness 不通过，Agent 仍可继续做本地 BI 编排、产物导入和 Dashboard 展示，但不能声称生产数据查询链路已实际可执行。

## 查询执行交接与回填

在调用 `@bairong-data-query` 前，为当前 session 生成交接包：

```bash
node scripts/create_query_handoff.mjs \
  --session-id 2026-06-27-001 \
  --provider-id bairong_data_query
```

交接包写入：

- `sessions/.../provider-handoff/handoff.json`
- `sessions/.../provider-handoff/handoff.md`

它包含原始需求、Agent 解析、指标计划、查询计划、DMS-only 规则、产物导入目标和回填命令。该文件可作为交给 `@bairong-data-query/natural-language-data-query` 的执行上下文。

真实查询完成或失败后，记录 provider 执行元数据：

```bash
node scripts/record_provider_execution.mjs \
  --session-id 2026-06-27-001 \
  --provider-id bairong_data_query \
  --status completed \
  --database-id 75306458 \
  --schema ares \
  --source-statement "本次查询使用 Ares 生产库，DMS database_id=75306458（schema=ares）"
```

规则：

- `status=completed` 且 provider 为 `bairong_data_query` 时，必须提供 `--source-statement`。
- 执行记录写入 `provider-execution.json`，并追加到 `audit.md`。
- 失败时使用 `--status failed --error "<错误原因>"`，不得伪造成功结果。

## 产物互操作

`@bairong-data-query` 生成的 JSON / SVG / PNG 产物应位于当前 workspace root 的 `bairong-data-output/`。本 Skill 不把该目录作为长期审计源，而是把产物导入当前 session：

- 原始产物路径写入 `audit.md`。
- JSON / SVG / PNG 复制到 `sessions/.../attachments/`。
- 附件索引保存为 `sessions/.../attachments.json`。
- 命名包含 `aggregate` 或 `summary` 的 JSON 同步为 `result.aggregate.json`。
- 命名包含 `preview` 的 JSON 同步为 `result.preview.json`。
- 命名包含 `chart` 或 `spec` 的 JSON 同步为 `chart-spec.json`。
- 如果导入了聚合 JSON 但没有 chart spec，会生成兜底柱状图配置，避免 Dashboard 使用旧字段渲染新数据。

命令：

```bash
node scripts/import_bairong_artifacts.mjs \
  --session-id 2026-06-27-001 \
  --source-dir ~/Documents/AgentBI/agent-bi-workspace/bairong-data-output
```

等价入口：

- Dashboard 按钮：`导入百融产物`
- API：`POST /api/sessions/:sessionId/import-bairong-artifacts`
- `/mcp` 工具：`import-bairong-artifacts`

Dashboard 会在当前分析页展示 `attachments.json` 中的审计附件，并允许打开 SVG / PNG / JSON 静态备份。

导入产物或记录查询完成后，Agent 必须同步右侧 Agent 内置浏览器：如果 `/dashboard` 已打开则刷新；否则导航到脚本返回的 `browserUrl`，默认 `http://127.0.0.1:3000/dashboard`。Dashboard 会根据 `dashboards/current.json` 定位当前查询 session。不要调用 macOS `open`、系统默认浏览器或外部 Chrome 窗口，也不要只输出 URL 等用户手动刷新。`/mcp-use/widgets/bi-dashboard` 只是备用 widget 路由，不是查询完成后的默认目标。
