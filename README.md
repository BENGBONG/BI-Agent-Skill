# BI Agent Skill

面向内部用户的本地 Agent-native 可视化 BI Skill。它把一次自然语言指标分析沉淀成可审计的本地资产：共享工作区、指标口径、查询计划、查询结果、图表配置、后端代码线索和 Dashboard。

仓库内已经包含可直接安装的 Skill 目录 `baizhi-agent-bi/`，以及一个打包好的 GitHub 共享压缩包：

```text
baizhi-agent-bi-skill-no-backend-20260702.tgz
```

注意：GitHub 版本不包含任何后端仓库源码，也不包含从后端仓库生成的完整快照。需要后端代码辅助分析时，请内部同事按权限在本地工作区自行配置或克隆。

## 核心能力

- 自然语言指标分析：先生成指标理解、确认单和查询计划，用户确认后才执行生产查询。
- 本地 Dashboard：展示当前分析、历史查询、指标库、查询源、后端知识和审计信息。
- 指标沉淀：把复用指标保存到本地 `metrics/*.yaml`，保留 actual SQL 和口径说明。
- 知识库沉淀：用户确认后，把字段含义、去重口径、时间字段和后端证据写入知识库。
- MCP readiness 检查：初始化时自动检查默认数据查询 MCP 和线上日志 MCP 是否可用。
- 共享数据/共享指标：首次使用时提示配置钉钉 AI 表格 MCP，配置保存到用户本地，不进入仓库。
- 后端代码扫描：支持扫描用户本地有权限访问的后端仓库，用于推理字段来源、状态枚举和业务逻辑。

## 目录说明

```text
baizhi-agent-bi/
  SKILL.md                         # Skill 主说明
  agents/openai.yaml               # Skill 元信息
  assets/dashboard/                # 本地 Dashboard
  assets/knowledge-seeds/          # 初始化知识库种子
  references/                      # Session、指标、Provider 等规范
  scripts/                         # 初始化、查询编排、Dashboard、共享等脚本

baizhi-agent-bi-skill-no-backend-20260702.tgz
  # 不含后端源码的可分发压缩包
```

GitHub 版本只包含 Skill 运行逻辑、Dashboard、脚本、规范文档和知识库种子。后端仓库、生产配置、内部脚本和任何可能包含密钥的工程文件都不应提交到本仓库。

## 安装方式

### 方式一：从仓库目录安装

把 `baizhi-agent-bi/` 放到 Codex Skill 目录，例如：

```bash
mkdir -p ~/.codex/skills
cp -R baizhi-agent-bi ~/.codex/skills/agent-bi
```

重启或刷新 Codex 后，可通过 `$agent-bi` 使用。

### 方式二：从压缩包安装

```bash
tar -xzf baizhi-agent-bi-skill-no-backend-20260702.tgz
mkdir -p ~/.codex/skills
cp -R baizhi-agent-bi ~/.codex/skills/agent-bi
```

## 初次使用准备

进入 Skill 目录后运行：

```bash
node scripts/ensure_workspace.mjs
node scripts/start_dashboard.mjs
```

`ensure_workspace.mjs` 会创建或更新共享 BI 工作区，默认路径按以下优先级解析：

1. `AGENT_BI_WORKSPACE`
2. `BAIZHI_BI_WORKSPACE`
3. `~/.agent-bi/config.json`
4. `~/.baizhi-bi/config.json`
5. `~/Documents/AgentBI/agent-bi-workspace`
6. `~/Documents/BaizhiBI/agent-bi-workspace`

初始化时会自动检查本地 MCP 配置：

- `internal_data_query`：需要 `aliyun-dms-mcp-server` 和 `executeScript`。
- `online_logs`：需要 `alibaba_cloud_observability` 及 SLS/CMS 查询工具。

如果缺少默认 MCP，脚本会在输出和 `logs/mcp-readiness/latest.json` 中提示。Skill 不会把 token、Authorization、AccessKey、密码或 endpoint 凭据写入仓库或共享工作区。

## 钉钉 MCP 配置

使用 Dashboard 的“共享数据”“共享指标”或“刷新共享指标”时，需要钉钉 AI 表格 MCP。

如果用户还没有配置，Dashboard 会弹出配置窗口，要求粘贴 MCP JSON。配置会保存到用户级位置：

```text
~/.agent-bi/mcp-servers.json
```

也可以通过环境变量指定：

```bash
export AGENT_BI_MCP_CONFIG=/path/to/mcp-servers.json
```

钉钉 MCP 配置属于个人本地配置，不会进入 Skill 包、共享工作区或 GitHub。

## 查询运行逻辑

一次标准分析流程如下：

1. 读取数据源能力索引、指标库、字段知识库和后端线索。
2. 生成指标理解、候选口径、候选数据源和查询计划。
3. 输出执行前确认单，等待用户确认。
4. 用户确认后，运行质量门检查。
5. 调用已登记的数据查询 provider 或 MCP 执行查询。
6. 导入聚合结果、preview、图表配置和审计信息。
7. 更新 `dashboards/current.json`。
8. 刷新本地 Dashboard。
9. 询问是否把本次字段和口径沉淀到知识库。

硬性边界：

- 用户未确认前，不执行生产查询。
- Dashboard 不执行 SQL，不调用生产 MCP 查询 provider。
- 生产明细、token、Authorization、Cookie、AccessKey、密码等敏感内容不得写入结果、Dashboard 或 Git。

## Dashboard

启动：

```bash
node scripts/start_dashboard.mjs
```

默认访问：

```text
http://127.0.0.1:3001/dashboard
```

Dashboard 支持：

- 当前分析结果
- KPI、柱状图、折线图、饼图和 preview 表格
- 查询历史
- 本地指标库和共享指标库
- 查询源/provider 信息
- 后端代码知识
- 确认单、风险和审计信息
- 保存指标、删除本地历史、共享数据、共享指标

## 后端仓库说明

GitHub 版本不包含后端仓库。Skill 仍然支持扫描后端代码，但后端代码必须由内部同事在本地按权限准备，例如放在共享工作区：

```text
~/Documents/AgentBI/agent-bi-workspace/knowledge/backend-repos/<repo-name>
```

扫描示例：

```bash
node scripts/scan_backend.mjs --repo ~/Documents/AgentBI/agent-bi-workspace/knowledge/backend-repos/<repo-name> --domain <业务域> --keywords "user_id,status,login"
```

不要把后端仓库、环境配置、数据库密码、AccessKey、Webhook token 或生产密钥提交到 GitHub。

## 常用脚本

```bash
node scripts/ensure_workspace.mjs
node scripts/check_mcp_readiness.mjs
node scripts/build_source_catalog.mjs
node scripts/create_session.mjs --sample
node scripts/start_dashboard.mjs
node scripts/validate_workspace.mjs
```

## 验证

发布前已执行：

```bash
python3 /Users/admin/.codex/skills/.system/skill-creator/scripts/quick_validate.py baizhi-agent-bi
```

结果：

```text
Skill is valid!
```

压缩包校验：

- 不包含嵌套 `.git`
- 不包含 macOS AppleDouble 元数据
- 不包含 `baizhi-agent-bi/assets/backend/`
- 包含 Dashboard 修复和初始化知识库种子

## 使用建议

内部同事首次使用时，建议先运行初始化和 MCP readiness 检查，再进行真实指标查询。遇到查询不可用时，优先检查本地 MCP 是否安装、provider registry 是否启用、以及用户是否已确认执行口径。
