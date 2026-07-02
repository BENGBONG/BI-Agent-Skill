---
name: agent-bi
description: 通用本地 Agent-native 可视化 BI 工作流。用于初始化或打开共享 BI 工作区、分析业务指标、保存指标口径、创建或修订 BI 查询 session、登记查询 provider、导入外部查询服务或 MCP 查询结果、在本地 Dashboard 查看图表和审计信息。
---

# Agent BI

## 概览

使用本 Skill 将 Agent 对话沉淀为可追溯的本地 BI 资产：共享工作区、指标口径、查询 provider registry、查询 session、图表配置、preview 数据、聚合结果和 localhost Dashboard。

Agent 负责业务理解、指标定义、provider 选择、查询计划审核和外部查询 provider 调用。本地 Dashboard 读取工作区文件并展示当前 session，不直接解释自然语言、不执行生产 SQL、不保存密钥。Dashboard 只允许写入本地指标资产和用户确认后的团队共享资产。

## 快速开始

在 Skill 目录执行：

```bash
node scripts/ensure_workspace.mjs
node scripts/create_session.mjs --sample
node scripts/start_dashboard.mjs
```

工作区路径按以下优先级解析：

1. `AGENT_BI_WORKSPACE`
2. `BAIZHI_BI_WORKSPACE`（legacy 兼容旧配置）
3. `~/.agent-bi/config.json`
4. `~/.baizhi-bi/config.json`（legacy 兼容旧工作区）
5. `~/Documents/AgentBI/agent-bi-workspace`
6. `~/Documents/BaizhiBI/agent-bi-workspace`（legacy 兼容旧工作区）

初始化会创建 PRD 约定的共享工作区骨架，包括 `config/`、`app/`、`knowledge/`、`metrics/`、`sessions/`、`dashboards/`、`logs/` 和 `tmp/`。当前可运行 Dashboard 由 Skill 内置 `assets/dashboard/` 提供；工作区内 `app/` 保留 mcp-use App 契约和后续适配 scaffold。

初始化会自动执行本地 MCP readiness 探测，检查 Codex 本地配置中是否可发现默认查询能力：

- `internal_data_query` 需要 `aliyun-dms-mcp-server`（legacy alias：`aliyun_dms`）和 `executeScript`。
- `online_logs` 需要 `alibaba_cloud_observability` 及 SLS/CMS 查询工具。

探测结果写入 `logs/mcp-readiness/latest.json`，并在 `ensure_workspace.mjs` 输出中提醒缺失的 MCP。该检查只读取本地 server 名、transport 和非敏感命令元数据，不保存 URL、Authorization、token、AccessKey 或密码；工具列表是否真实可调用仍以 MCP runtime 和后续 provider 调用为准。

共享工作区 `app/` 同时提供 `index.mjs` 本地入口和 `npm start` 脚本，可从工作区内启动同一个 Dashboard。当前 App 无外部 npm 依赖；如果未来加入依赖，必须通过 `scripts/ensure_app.mjs` 检查安装状态，且 `app/node_modules/` 保持 gitignore。

## 工作流

1. 用 `scripts/ensure_workspace.mjs` 确保共享工作区存在。
2. 查询前读取 `source-catalog`、`metrics/`、`knowledge/` 和 `config/query-providers.yaml`，但不得只按已沉淀知识库做机械匹配；必须结合用户需求、业务语义、后端库表/字段线索和 provider 能力主动推测可能的查询实现路径。
3. 先做自然语言理解，只生成 `interpretation.md`、候选 `metric-plan.yaml`、候选 `query-plan.json` 和 `confirmation.json` 草稿；不得直接执行生产查询。自然语言理解阶段确认的是指标意图、业务口径和期望效果，不是把某一张表或某一个字段定死为唯一执行方案。
4. 和用户确认执行前确认单。确认单必须覆盖指标意图、数据源/provider、候选源表或产物、计算口径、时间范围、时间字段候选、维度、过滤、去重、join、后端证据、假设、风险、候选查询策略和空结果/不可用 fallback 规则。
5. 用户确认后，将 `confirmation.json.status` 写为 `confirmed`，并在 `audit.md` 记录确认时间、确认人、provider 和指标。
6. 执行质量门检查，至少确认指标、时间范围、维度、假设、风险、查询计划、provider 状态、确认单状态、候选查询策略和 fallback 规则。
7. 质量门通过后才能生成查询源执行交接包，明确 provider、DMS 规则、候选策略顺序、空结果/字段不可用处理、导入目标和回填要求。
8. 通过已登记 provider 执行查询，不通过 Dashboard server 执行。生产数据查询必须遵循 `references/dms-data-query-integration.md` 或兼容的 DMS provider 规则；legacy `references/bairong-data-query-integration.md` 只作为旧环境适配。执行时以核心指标口径为准选择实现策略；某个候选表查不到、字段不存在或结果明显为空时，不应直接把空结果作为最终答案，必须评估其他候选表、日志/业务表组合、补充分类表或降级统计路径，并把最终实际采用的查询逻辑写入 `query-plan.json.actualExecution`、`audit.md` 和结果说明。
9. 导入 provider 产物并保存标准化 session 文件到 `sessions/YYYY/MM/<session-id>/`。
10. 记录 provider 执行元数据；生产查询完成时必须写入数据源确认语句。
11. 查询完成后必须询问用户：是否根据本次查询逻辑更新知识库字段说明。脚本会先写入 `pending-actions/knowledge-update-review.json`，Agent 只能在用户确认后调用 `scripts/update_knowledge_fields_from_query.mjs`，把字段含义、计算角色、来源表、去重/时间口径和 session 证据写入 `knowledge/field-meanings/`。
12. 如用户确认更新知识库，字段说明必须写得足够详细，便于后续自然语言匹配和查询复用；不得写“待确认/TBD/unknown”这类占位内容。写入后重跑 `node scripts/build_source_catalog.mjs`，让 Dashboard 知识库展示最新字段含义。
13. 更新 `dashboards/current.json`。
14. 启动或刷新 Dashboard server，并在 Agent 右侧内置浏览器默认打开 `browserUrl`（完整 `/dashboard` 页面）；如果右侧 Agent 浏览器已经打开同一 Dashboard，则刷新该 tab，并依赖 `dashboards/current.json` 定位到当前查询 session，让用户无需手动刷新。

硬性边界：

- 用户未确认 `confirmation.json` 前，不得调用生产 provider，不得生成 provider handoff，不得把结果导入为正式查询结果。
- Dashboard 是可视化结果面板，只展示当前结果、历史、指标库、查询源、后端知识、确认单和审计；页面允许把当前查询口径直接保存为指标库资产，也允许用户二次确认后删除本地历史查询 session，但不得在页面里保存确认单、确认执行、运行质量门、生成交接包、导入产物或触发生产查询。
- 保存确认单、运行质量门、生成交接包、导入 provider 产物、更新当前 Dashboard 等动作只能由 Agent 对话中的脚本或本地 MCP 工具执行，并且必须写入 session/audit。
- 确认单中的 `sourceTables`、`timeField` 和字段线索是候选实现依据，不是唯一执行锁定。除非用户明确要求“只查某张表/只用某字段”，Agent 不得因为第一候选为空或不可用就停止；必须继续按已确认指标口径寻找满足核心需求的可审计实现路径。
- 待确认草稿 session 不得替换 `dashboards/current.json`；只有执行完成、失败结果落盘，或用户明确要求打开某个历史 session 时，才更新当前可视化结果。
- 下钻请求必须回到 Agent 对话和同一确认流程：先生成待处理动作或新分析草稿，再确认指标、数据源和口径。
- 知识库字段说明更新必须回到 Agent 对话确认，Dashboard 不提供直接写入入口。用户未确认前，只能保留 `knowledge_update_review` 待处理动作，不能修改 `knowledge/field-meanings/`。
- 查询任务结束、失败结果落盘、导入 provider 产物或切换当前 session 后，Agent 必须使用 Codex 右侧 Agent 内置浏览器打开或刷新完整 `/dashboard`；不得调用 macOS `open`、系统默认浏览器、Chrome 外部窗口，也不得只让用户复制 URL 或手动刷新页面。若右侧浏览器未打开，打开脚本返回的 `browserUrl`；若已打开同一 Dashboard URL，执行刷新；若打开的是其他页面，导航到 `browserUrl`。`/mcp-use/widgets/bi-dashboard` 只是备用 widget 路由，不是查询完成后的默认目标。

## Session 约定

每次查询 session 必须包含：

- `request.md`
- `interpretation.md`
- `confirmation.json`
- `metric-plan.yaml`
- `query-plan.sql` 或 `query-plan.json`
- `result.aggregate.json`
- `result.preview.json`
- `chart-spec.json`
- `audit.md`
- `metadata.json`

可选目录：

- `revisions/<revision-id>/`：保存同一 session 的修订计划、查询计划和审计说明。
- `pending-actions/<action-id>.json`：保存 Dashboard 发起、等待 Agent 处理的下钻请求。
- `share-actions/<share-id>.json`：保存 Dashboard 发起、用户确认后的团队共享任务、进度和审计状态。

具体格式见 `references/session-contract.md`。

修订和新 session 规则：

- 只改变理解、指标口径、候选数据源或查询计划，且没有产生新的正式结果时，写入同一 session 的 `revisions/<revision-id>/`。
- 修订口径已经重新执行并产生新结果时，创建新的 linked session，保留 `metadata.linkedFrom`、`metadata.copyReason`，原 session 结果不得覆盖。
- Dashboard 必须展示当前 session 的 revision 时间线；用户要对比两个已执行口径时，使用 `compare_sessions.mjs` 或 linked session 历史。

默认保存 provider 返回的完整聚合结果和 preview 结果，不在 Dashboard 层截断行数。只有用户明确要求保存未聚合原始明细时，才写入 `result.full.json` 或 `raw/`，且 `sessions/**/result.full.json` 和 `sessions/**/raw/` 必须保持 gitignore。

## 指标口径

复用指标保存到本地 `metrics/*.yaml`。`id` 用稳定英文/拼音标识，`name` 必须使用面向用户的中文指标名。团队共享指标缓存保存到 `knowledge/shared-metrics/index.json`，只读展示，用户点击“复制到本地”后才会写入本地指标库。状态只允许：

- `draft`：Agent 初步推导，未确认。
- `reviewed`：用户或研发看过，但仍可能调整。
- `validated`：已确认，可默认复用。
- `deprecated`：不再使用。

不要在缺少用户或领域负责人确认时将指标标记为 `validated`。脚本层会强制 `validated` 指标必须传入 `--confirm-validated` 和非 `agent` 的 `--validated-by`。创建或更新指标前阅读 `references/metric-format.md`。

## Query Provider

Provider registry 位于 `config/query-providers.yaml`。每个 provider 必须声明 id、type、status、routing hints、safety policy 和 output mapping。`draft` provider 执行前必须确认；`disabled` provider 不可使用。

选择或登记 provider 前阅读 `references/provider-registry.md`。

已支持的线上日志 provider：

- `online_logs`：指向 `alibaba_cloud_observability` MCP，覆盖 `sls_list_projects`、`sls_list_logstores`、`sls_execute_sql`、`sls_get_context_logs`、`cms_execute_promql` 和 `sls_execute_spl`。legacy alias：`baizhi_online_logs`。
- 适用线上日志、SLS、LogStore、APP token 活跃、行为日志、错误日志、PromQL 和 SPL 分析。
- 必须遵守 Agent 对话确认流程；未确认前不得调用线上日志 MCP，Dashboard 也不得直接调用。

## 后端逻辑扫描

当用户要求理解后端字段、状态映射、计算口径或数据产生链路时，使用：

```bash
node scripts/scan_backend.mjs --repo <backend-repo-path> --domain <业务域> --keywords "授信,approval,credit_status"
```

GitHub 共享版不内置后端仓库源码。需要后端代码辅助分析时，用户必须按内部权限在本地准备后端仓库路径，例如共享工作区的 `knowledge/backend-repos/<repo-name>`，再作为 `--repo` 参数传入。

扫描结果写入：

- `knowledge/code-scans/<date>-<domain>.md`
- `knowledge/backend-projects.yaml`

扫描结果是辅助证据，不替代人工审查。若文档和代码证据冲突，代码事实优先，并在 `audit.md` 记录冲突。

## 数据源能力索引

当新增或更新后端仓库、数据查询插件、MCP 服务或 provider registry 后，运行：

```bash
node scripts/build_source_catalog.mjs
```

该脚本只读取本地 registry、MCP schema、provider schema、后端扫描和字段映射，不执行生产查询。输出：

- `knowledge/source-catalog/index.json`：能力索引摘要。
- `knowledge/source-catalog/services.json`：后端仓库和 MCP 服务清单。
- `knowledge/source-catalog/query-capabilities.json`：每个 provider 支持的查询能力、工具、参数和安全策略。
- `knowledge/source-catalog/field-lineage.json`：字段线索、领域、provider hint、敏感级别和证据。
- `knowledge/source-catalog/metric-candidates.json`：可候选复用的指标类型、所需字段和风险。

后续自然语言指标分析前，Agent 必须优先读取 `source-catalog`、`metrics/`、`knowledge/field-mappings/` 和 `knowledge/field-meanings/`，再生成确认单和查询计划。若能力索引显示字段不可查询、缺少索引或涉及敏感 token/Authorization，必须在确认单风险中提前说明。

自然语言指标推理规则：

- 先定义 `metricIntent`：用户真正要衡量的业务对象、事件边界、统计单位、期望效果和不可接受的遗漏。
- 再列 `queryHypotheses`：哪些事实表、日志、业务流水、会话表或组合路径可能承载这个指标，每个假设说明证据、覆盖范围和风险。
- 再设计 `implementationStrategies`：至少包含主策略和 fallback 策略；每个策略写清楚候选表/字段、join/去重、时间口径、覆盖范围、何时采用和何时放弃。
- 不得全信历史知识库扫描出的后端逻辑。若用户质疑、证据过期、字段含义缺失、查询为空、生产 schema 与扫描结果冲突，或结果不符合业务常识，必须重新检查后端仓库代码、provider schema 或相关领域文档，再修订候选策略。
- 执行后回填 `actualExecution`：最终实际用了哪些表、哪些字段、为什么放弃其他候选、结果覆盖什么、不覆盖什么。
- 如果所有候选都不可用，才记录失败；失败说明必须指向“指标口径仍成立，但当前 provider/库表无法支撑”，不能把第一候选为空误报为业务结果为 0。

查询沉淀字段说明：

- `knowledge/field-meanings/*.json` 只保存用户确认后的字段说明补充。
- 每条补充必须关联 session、指标口径、计算逻辑、来源表/日志产物、字段角色和证据。
- `scripts/build_source_catalog.mjs` 会把这些说明合并进 `field-lineage.json.meanings`，并优先展示最近一次用户确认的 `meaning`。
- 如果本次查询发现字段旧含义不完整，Agent 应在结果汇报后明确询问用户是否更新知识库；用户确认后再写入。

## Dashboard

Dashboard server 位于 `assets/dashboard/`，读取工作区文件。可视化页面只使用只读接口：

- `/dashboard`
- `/inspector`
- `/sessions/:sessionId`
- `/mcp-use/widgets/bi-dashboard`
- `/api/status`
- `/api/current-dashboard`
- `/api/sessions`
- `/api/sessions/:sessionId`
- `/api/metrics`
- `/api/providers`
- `/api/backend-projects`

Dashboard 不解析自然语言、不运行 SQL、不调用生产 MCP 查询 provider、不保存 token。页面只允许直接保存指标口径资产，以及在用户确认后创建并执行团队共享任务；其他写入型能力保留在 `/mcp` 本地工具面或脚本中，供 Agent 对话流程调用，不作为页面交互入口。

Dashboard 支持：

- 查询历史、指标库、查询源、后端知识和审计栏只读展示。
- 当前分析页展示 KPI、折线图、柱状图、饼图、preview 表格、指标计划、确认单摘要、查询计划、风险提示和审计说明。
- 图例开关、维度/指标选择和表格排序只改变本地展示，不改变 session 文件、不触发查询。
- 历史查询页点击“保存指标”会直接写入 `metrics/*.yaml`，并在 session 审计中记录来源；保存状态默认为 `draft`，不会自动标记为 `validated`。保存指标时必须同步保存本次查询的 `actual_sql`，共享指标时直接使用指标库中的 SQL 字段。
- 历史查询页点击“删除历史”必须二次确认，只删除本地 `sessions/YYYY/MM/<session-id>/` 查询数据；已保存指标、共享指标缓存和 `metrics/*.yaml` 不受影响。若删除当前 session，Dashboard 自动切换到剩余最近执行的一条历史。
- 历史查询页点击“共享数据”会先要求指定共享用户名（保存到用户级 `~/.agent-bi/profile.json`，不写入项目仓库），再展示目标、字段、行数和敏感字段确认，创建 `share-actions/<share-id>.json` 并调用共享执行器写入团队公共 AI 表格；共享期间显示进度条并锁定重复共享。
- 指标页区分“本地指标库”和“共享指标库”。本地指标可点击“共享指标”写入团队公共 AI 表格；共享表头使用中文，记录共享人、共享时间和实际执行 SQL；共享指标从 `knowledge/shared-metrics/index.json` 读取，可刷新同步，也可复制到本地指标库。
- 首次使用“共享数据”“共享指标”或“刷新共享指标”时，Dashboard 必须先检查用户级钉钉 AI 表格 MCP 配置。若未配置，展示配置弹窗，要求用户粘贴 MCP JSON，并保存到 `~/.agent-bi/mcp-servers.json` 或 `AGENT_BI_MCP_CONFIG` 指向的用户级文件；不得把 endpoint、Authorization 或 token 写入 Skill 包、共享工作区或 git。
- 可复制工作区路径和当前 session 路径，便于用户回到 Agent 对话继续处理。
- 当前分析页展示结构化查询源详情，包括 provider id、类型、状态、MCP server、tool、路由关键词和安全策略。
- 页面会轮询 `/api/status` 和当前 session；当 Agent 更新 `dashboards/current.json`、查询结果或数据源登记后，已打开的页面必须自动刷新展示，无需用户手动刷新。
- Agent 查询流程完成后必须主动同步 Codex 右侧 Agent 内置浏览器：优先刷新已打开的 `/dashboard` tab；没有打开时导航到脚本返回的 `browserUrl`。这是 Agent 运行步骤，不是 Dashboard 页面按钮；不要用外部浏览器打开 `dashboardUrl`。

## 脚本

- `scripts/ensure_workspace.mjs`：创建或更新共享 BI 工作区。
- `scripts/ensure_app.mjs`：检查共享工作区 `app/` 入口、依赖和 Widget scaffold。
- `scripts/create_session.mjs`：创建标准 session 骨架或示例 session。
- `scripts/save_metric.mjs`：写入指标 YAML 并更新 `_index.yaml`。
- `scripts/metric_history.mjs`：读取指标当前版本、历史版本和 diff。
- `scripts/set_current_dashboard.mjs`：将某个 session 设置为当前展示。
- `scripts/create_revision.mjs`：在现有 session 下创建 revision。
- `scripts/compare_sessions.mjs`：对比两个查询 session 的计划、查询和结果行数。
- `scripts/clone_session.mjs`：复制历史 session 为 linked 新查询，保留来源关系。
- `scripts/create_failed_session.mjs`：保存失败查询 session，保留错误原因和诊断建议。
- `scripts/create_query_handoff.mjs`：为当前 session 生成查询源执行交接包。
- `scripts/record_provider_execution.mjs`：记录真实 provider 执行元数据、数据源确认语句和失败原因。
- `scripts/update_knowledge_fields_from_query.mjs`：在用户确认后，把本次查询沉淀出的详细字段含义和计算角色写入 `knowledge/field-meanings/`。
- `scripts/request_drill_down.mjs`：写入待 Agent 处理的下钻请求。
- `scripts/register_provider.mjs`：登记 MCP 或文件查询 provider。
- `scripts/check_mcp_readiness.mjs`：检查本地 Codex MCP 配置是否具备默认 DMS 和线上日志查询 MCP，缺失时输出安装/启用提醒。
- `scripts/smoke_test_provider.mjs`：验证本地 provider registry 和 schema 文件是否可用。
- `scripts/select_provider.mjs`：根据显式 provider、问题、指标和关键词选择查询 provider。
- `scripts/quality_gate.mjs`：对指标计划、查询计划和 provider 状态运行执行前质量门。
- `scripts/import_provider_artifacts.mjs`：把外部 provider 生成的聚合、preview、图表和审计产物导入 session。
- `scripts/import_provider_artifacts.mjs`：从 `provider-output/` 导入 provider JSON/SVG/PNG 产物并记录来源。旧环境可继续使用 `scripts/import_bairong_artifacts.mjs` 兼容入口。
- `scripts/run_benchmark.mjs`：运行本地 benchmark cases，验证 provider 路由和指标计划检查样例。
- `scripts/run_evaluations.mjs`：运行 PRD 8.3 功能评估套件，结果写入 `logs/evaluations/`。
- `scripts/check_external_readiness.mjs`：只读检查已登记 DMS/MCP provider、生产库 registry、业务域 registry 和 DMS MCP 提示是否具备，不执行生产查询。
- `scripts/run_prd_audit.mjs`：按 PRD MVP Acceptance Checklist 和安全要求生成覆盖审计报告。
- `scripts/scan_backend.mjs`：扫描后端 repo 并写入知识摘要。
- `scripts/build_source_catalog.mjs`：汇总 provider、MCP、后端扫描和字段映射，生成数据源能力索引。
- `scripts/execute_share_action.mjs`：执行已确认的团队共享任务，把查询数据或指标写入配置的团队公共 AI 表格。
- `scripts/sync_shared_metrics.mjs`：从团队公共 AI 表格同步共享指标库缓存。
- `scripts/start_dashboard.mjs`：启动本地 Dashboard。
- `scripts/validate_workspace.mjs`：检查工作区结构、当前 dashboard 引用、gitignore、localhost 和 provider 安全声明。

关键脚本会向 `logs/skill-runs.jsonl` 写入运行记录，便于跨 Agent 审计。

## 本地工具面

Dashboard server 在 `/mcp` 暴露轻量本地 JSON 工具面。它只作为 localhost 文件工作区工具，不是生产数据查询执行器。

可用工具名：

- `get-workspace-status`
- `load-current-dashboard`
- `update-current-dashboard`
- `save-metric-definition`
- `get-metric-history`
- `list-metrics`
- `list-query-history`
- `load-query-session`
- `compare-query-sessions`
- `clone-query-session`
- `create-failed-session`
- `create-query-handoff`
- `select-query-provider`
- `record-provider-execution`
- `update-knowledge-fields-from-query`
- `run-quality-gate`
- `import-provider-artifacts`
- `run-benchmark`
- `share-bi-asset`
- `sync-shared-metrics`
- `request-drill-down`
- `drill-down-query`
- `register-query-provider`
- `smoke-test-provider`
- `scan-backend-project`
- `render-bi-dashboard`
