# Agent BI 闭环 MVP 设计

日期：2026-06-27
状态：已批准实现

## 范围

在当前仓库中实现 PRD 的本地闭环版本。MVP 需要提供可安装的 `baizhi-agent-bi` Skill，初始化共享本地 BI 工作区，保存标准化查询 session，维护指标库和 provider registry，并运行一个读取工作区文件的 localhost Dashboard。

本 MVP 不直接执行生产 SQL，也不替代 `@bairong-data-query`。查询执行仍由 Agent 根据已登记 provider 完成。本地 Dashboard 只负责文件工作区展示和轻量写入，不保存数据库凭据。

## 架构

Skill 包含四层：

1. `SKILL.md`：Agent 工作流、安全边界和资源路由。
2. `scripts/`：工作区、session、指标、provider、后端扫描、Dashboard 和验证脚本。
3. `references/`：session、指标、provider 和 `@bairong-data-query` 的文件契约。
4. `assets/dashboard/`：无外部依赖的 Node server 和静态 UI，用于展示当前分析、历史、指标、provider、后端知识和审计信息。
5. 共享工作区内的 `app/`：保留 mcp-use App 契约、widget 类型和后续适配 scaffold；当前可运行实现仍由 Skill 内置 Dashboard server 提供。

工作区路径按 `AGENT_BI_WORKSPACE`、`~/.agent-bi/config.json`、旧配置 fallback 的优先级解析。

## 数据流

1. Agent 运行 `ensure_workspace.mjs`。
2. Agent 读取已有指标、后端知识和 provider registry。
3. Agent 通过已登记 provider 规划并执行查询。
4. Agent 保存标准化 session 文件。
5. Agent 更新 `dashboards/current.json`。
6. Dashboard 通过本地 API 读取 session 文件，渲染图表、preview 表格、审计文本和 provider 信息。
7. Dashboard 可写入轻量动作，例如保存指标草稿、创建 revision、请求下钻、登记 provider、选择查询源、运行质量门、导入 provider 产物和记录失败查询；这些动作不会直接查询生产数据。
8. Benchmark 样例用于检查 provider 路由和指标计划提示，不访问生产数据。
9. 图表交互仅写入 pending action，不绕过 Agent 自动执行生产查询。
10. 历史查询可复制为 linked 新查询，保留 `metadata.linkedFrom` 以便审计来源。
11. 当前分析页展示指标计划和结构化 provider 安全摘要。
12. `@bairong-data-query` 产物可从 `bairong-data-output/` 导入为 session 标准结果和审计附件。
13. PRD 8.3 功能评估通过 `scripts/run_evaluations.mjs` 落地，结果写入 `logs/evaluations/`。

## 安全

Dashboard 不直连数据库，也不直接调用生产 MCP 查询工具。工作区 `.gitignore` 默认排除 `.env`、日志、临时文件、`node_modules`、完整明细结果和 raw 结果目录。`draft` provider 执行前必须确认。内部生产查询必须继续遵循已登记 provider 的 DMS-only 规则。

## 验证

验证使用：

- `node scripts/ensure_workspace.mjs`
- `node scripts/create_session.mjs --sample`
- `node scripts/validate_workspace.mjs`
- Dashboard `/api/status`、`/api/current-dashboard`、`/mcp` smoke test
- `scripts/create_revision.mjs`
- `scripts/request_drill_down.mjs`
- `scripts/register_provider.mjs`
- `scripts/select_provider.mjs`
- `scripts/quality_gate.mjs`
- `scripts/import_provider_artifacts.mjs`
- `scripts/import_bairong_artifacts.mjs`
- `scripts/run_benchmark.mjs`
- `scripts/run_evaluations.mjs`
- `scripts/scan_backend.mjs`
- 系统 `quick_validate.py`
