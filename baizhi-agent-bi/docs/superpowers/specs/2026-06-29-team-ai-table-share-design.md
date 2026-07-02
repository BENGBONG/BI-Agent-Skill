# Agent BI 团队 AI 表格共享设计

日期：2026-06-29
状态：待评审

## 背景

Agent BI 当前把查询结果、指标口径、字段说明和审计信息沉淀在本地工作区。用户希望在本地找到可复用的数据或指标后，可以在 Dashboard 上点击共享，直接贡献到团队公共 AI 表格。团队成员各自配置自己的钉钉 AI 表格 MCP，公共 AI 表格由团队负责人创建并授权。

本设计采用方案 B：页面确认后，由本地共享执行器调用钉钉 AI 表格 MCP 写入指定公共文档。Dashboard 不向 Codex 对话注入消息，也不依赖浏览器模拟粘贴。

## 目标

1. Dashboard 支持共享当前查询数据和指标库指标。
2. 用户在页面内完成共享确认，确认后直接执行共享。
3. 共享目标固定为配置好的团队公共 AI 表格，优先使用 `base_id`，名称只作为查找和展示 fallback。
4. 每次共享都写入本地审计，Dashboard 自动刷新共享状态。
5. 不保存钉钉账号密码，不保存生产数据源密钥，不绕过敏感字段确认。
6. 指标库区分本地指标库和共享指标库；共享指标库读取团队公共 AI 表格中大家贡献的指标。

## 非目标

1. 不实现网页向 Codex 当前对话自动发送消息。
2. 不实现无人值守定时同步。
3. 不把 Dashboard 变成生产数据查询入口。
4. 不默认共享原始明细数据；原始明细必须显式确认。
5. 不在 Skill 中内置任何团队钉钉 token。

## 架构

新增五个边界清晰的模块：

1. `config/share-targets.yaml`
   - 保存共享目标配置。
   - 支持 `dingtalk_ai_table_mcp` 目标类型。
   - 保存 `base_id`、`base_name`、表名映射、数据行数阈值和敏感字段策略。

2. Dashboard 共享入口
   - 当前分析页和历史详情页提供「共享数据」。
   - 指标详情页提供「共享指标」。
   - 点击后弹出确认弹窗，展示目标、字段、行数、共享范围、敏感字段、来源 session 和口径摘要。
   - 用户确认后调用本地只写共享 API，不直接调用钉钉。

3. 本地共享执行器
   - 脚本名建议为 `scripts/execute_share_action.mjs`。
   - 读取共享目标配置和 session/metric 文件。
   - 生成标准共享包。
   - 通过 MCP client 调用钉钉 AI 表格 MCP。
   - 回写 session/metric 审计和共享状态。

4. 共享审计与状态
   - session 内新增 `share-actions/<share-id>.json`。
   - 指标保存共享记录到 `metrics/_shares/<metric-id>.jsonl`。
   - 工作区级共享日志写入 `logs/share-runs.jsonl`。
   - Dashboard 读取这些文件展示已共享、失败、目标链接和最近共享时间。
   - 共享执行中写入进度状态，Dashboard 展示进度条并锁定当前共享上下文。

5. 共享指标读取器
   - 脚本名建议为 `scripts/sync_shared_metrics.mjs`。
   - 通过钉钉 AI 表格 MCP 从 `共享指标库` 表读取团队指标。
   - 将最近一次读取结果缓存到 `knowledge/shared-metrics/index.json`。
   - Dashboard 展示共享指标时优先读取缓存，并提供页面内「刷新共享指标」动作。
   - MCP 不可用时显示最近缓存时间和失败原因，不影响本地指标库展示。

## 目标表结构

公共 AI 表格 Base 默认包含三张管理表，并按需要创建数据明细表。

1. `共享指标库`
   - `metric_id`
   - `name`
   - `status`
   - `version`
   - `definition`
   - `grain`
   - `time_field`
   - `dimensions`
   - `source_tables`
   - `field_meanings`
   - `related_sessions`
   - `shared_by`
   - `shared_at`
   - `local_metric_path`
   - `source_workspace`
   - `source_agent`
   - `share_status`
   - `last_updated_at`

2. `共享数据集目录`
   - `dataset_id`
   - `session_id`
   - `title`
   - `metric_definition`
   - `data_scope`
   - `row_count`
   - `columns`
   - `target_table_name`
   - `target_table_id`
   - `source_statement`
   - `sensitivity_level`
   - `shared_by`
   - `shared_at`
   - `local_session_path`

3. `共享记录审计`
   - `share_id`
   - `share_type`
   - `target_id`
   - `target_base_id`
   - `target_table`
   - `status`
   - `row_count`
   - `mcp_server`
   - `mcp_tools`
   - `error_message`
   - `created_at`
   - `completed_at`

4. 数据明细表
   - 小数据可直接写入以 `dataset_<date>_<short-id>` 命名的数据表。
   - 大数据通过导入文件创建或追加到数据表。
   - 字段类型由共享包推断，优先使用 `text`、`number`、`date`、`url`、`richText`。

## 配置格式

示例：

```yaml
default_target: team_ai_table
targets:
  - id: team_ai_table
    type: dingtalk_ai_table_mcp
    enabled: true
    mcp_server: aitable
    base_id: ""
    base_name: "团队 Agent BI 共享库"
    folder_id: ""
    tables:
      metrics: "共享指标库"
      datasets: "共享数据集目录"
      audit: "共享记录审计"
    data_policy:
      default_scope: aggregate
      require_confirmation: true
      allow_raw_detail: false
      direct_record_limit: 500
      import_file_limit: 50000
      sensitive_field_patterns:
        - token
        - authorization
        - phone
        - id_card
        - 身份证
        - 手机号
```

`base_id` 是推荐配置。若只配置 `base_name`，执行器必须调用 `search_bases` 或 `list_bases` 查找；命中多个时共享失败并要求用户补充 `base_id`。

## 数据共享流程

1. 用户在 Dashboard 点击「共享数据」。
2. Dashboard 从当前 session 读取 `metadata.json`、`metric-plan.yaml`、`result.aggregate.json`、`result.preview.json`、`chart-spec.json` 和 `audit.md` 摘要。
3. 页面生成共享预览：
   - 共享范围：默认 `aggregate`。
   - 字段列表和行数。
   - 敏感字段命中结果。
   - 目标 Base 和目标表。
   - 数据来源确认语句。
4. 用户点击「确认共享」。
5. Dashboard server 写入 `share-actions/<share-id>.json`，状态为 `confirmed`.
6. Dashboard server 调用 `execute_share_action.mjs --share-id <share-id>`。
7. 执行器把共享任务状态更新为 `running`，并持续写入 `progress`。
8. 执行器确认目标 Base、创建或补齐管理表。
9. 执行器按行数选择写入方式：
   - `row_count <= direct_record_limit`：使用 `create_records`。
   - 更大数据：生成 CSV/XLSX，使用 `prepare_import_upload` 和 `import_data`。
10. 执行器写入 `共享数据集目录` 和 `共享记录审计`。
11. 执行器回写本地审计，Dashboard 自动刷新。

## 指标共享流程

1. 用户在指标详情页点击「共享指标」。
2. Dashboard 展示指标口径、版本、状态、字段含义、关联 session 和 source tables。
3. 用户确认。
4. 执行器查找或创建 `共享指标库`。
5. 执行器通过 `query_records` 按 `metric_id` 查重。
6. 已存在则 `update_records` 更新版本和口径；不存在则 `create_records` 新增。
7. 本地写入 `metrics/_shares/<metric-id>.jsonl` 并刷新 Dashboard。

## 指标库双来源

Dashboard 的指标模块必须明确分成两个来源：

1. 本地指标库
   - 来源：本地工作区 `metrics/*.yaml`。
   - 作用：当前用户在本机沉淀、修订和复用的指标。
   - 写入方式：现有「保存指标」动作直接写入本地指标库。
   - 状态：支持 `draft`、`reviewed`、`validated`、`deprecated`。

2. 共享指标库
   - 来源：团队公共 AI 表格中的 `共享指标库` 表。
   - 作用：查看团队成员贡献的指标口径、字段含义、来源 session 和版本。
   - 写入方式：本地指标点击「共享指标」后，通过共享执行器写入钉钉 AI 表格。
   - 读取方式：通过 `sync_shared_metrics.mjs` 调用钉钉 AI 表格 MCP 的 `query_records`，并缓存到 `knowledge/shared-metrics/index.json`。
   - 状态：展示共享表中的 `share_status` 和指标原始 `status`，不能把共享指标自动当成本地 `validated` 指标。

共享指标库默认只读。用户若想复用共享指标，Dashboard 提供「复制到本地」动作，写入新的本地 `metrics/*.yaml`，并保留 `source_shared_metric_id`、`source_base_id`、`source_record_id` 和复制时间。复制到本地后，后续修订遵循本地指标版本历史规则。

自然语言指标匹配时，Agent 应同时读取本地指标库和共享指标缓存，但优先级为：

1. 本地 `validated` 指标。
2. 本地 `reviewed` 指标。
3. 共享指标库中最近同步且状态可用的指标。
4. 本地 `draft` 指标。

当匹配到共享指标时，确认单必须说明该口径来自共享指标库，并展示共享人、共享时间、来源说明和当前本地是否已复制。

## 共享指标同步流程

1. Dashboard 指标模块打开时读取本地缓存 `knowledge/shared-metrics/index.json`。
2. 若用户点击「刷新共享指标」，Dashboard server 调用 `sync_shared_metrics.mjs`。
3. 同步脚本读取 `share-targets.yaml`，定位 `共享指标库`。
4. 同步脚本调用钉钉 AI 表格 MCP：
   - `search_bases` 或 `list_bases` 确认目标 Base。
   - `get_tables` 确认 `共享指标库` 表。
   - `query_records` 分页读取全部共享指标。
5. 同步脚本标准化字段，写入 `knowledge/shared-metrics/index.json` 和 `logs/share-runs.jsonl`。
6. Dashboard 自动刷新共享指标 tab。

缓存文件必须包含：

```json
{
  "version": 1,
  "targetId": "team_ai_table",
  "baseId": "",
  "tableName": "共享指标库",
  "syncedAt": "2026-06-29T00:00:00+08:00",
  "status": "ok",
  "records": []
}
```

## 共享进度和操作锁

共享动作执行期间必须展示进度条，并锁定会改变共享上下文的操作，避免用户在共享未完成时切换对象、重复点击或修改本地文件导致审计错乱。

共享任务文件的 `progress` 推荐结构：

```json
{
  "status": "running",
  "percent": 45,
  "currentStep": "write_records",
  "steps": [
    {"id": "prepare_payload", "label": "准备共享包", "status": "completed"},
    {"id": "resolve_target", "label": "确认目标 AI 表格", "status": "completed"},
    {"id": "ensure_schema", "label": "检查共享表结构", "status": "running"},
    {"id": "write_records", "label": "写入共享数据", "status": "pending"},
    {"id": "write_audit", "label": "写入共享审计", "status": "pending"}
  ],
  "updatedAt": "2026-06-29T00:00:00+08:00"
}
```

Dashboard 进度规则：

1. 共享确认后弹窗不关闭，切换为执行中状态。
2. 弹窗展示进度条、当前步骤、已写入行数和最近一次状态更新时间。
3. 共享执行中禁用当前对象的「共享数据」「共享指标」「保存指标」「复制到本地」等会改变共享上下文的按钮。
4. 不阻止用户滚动和查看 Dashboard，但若用户切换到其他 session 或指标，页面必须保留执行中浮层或顶部状态条。
5. 同一 `share_id` 只能执行一次；重复点击必须返回当前进度，而不是新建第二个任务。
6. 共享脚本每完成一个阶段都原子写入 `share-actions/<share-id>.json`，避免 Dashboard 读到半写入状态。
7. 执行失败时进度条停在失败步骤，展示错误原因和「重试」入口；重试必须复用原 `share_id` 并追加 attempt 记录。
8. 执行成功后进度条显示完成状态，2 秒后收起为共享状态摘要。

## MCP 调用策略

钉钉 AI 表格 MCP 市场信息显示其 serverName 为 `aitable`，支持创建 Base、表、字段、记录、导入数据、查询记录、仪表盘和图表。共享执行器只依赖以下最小工具集：

1. `search_bases` 或 `list_bases`
2. `get_tables`
3. `create_table`
4. `create_fields`
5. `query_records`
6. `create_records`
7. `update_records`
8. `prepare_import_upload`
9. `import_data`

第一版不主动创建团队 Base，除非配置显式允许 `allow_create_base: true`。默认要求团队负责人先创建公共 AI 表格并授权团队成员。

## 安全和确认

1. 共享执行必须来自用户点击后的页面确认，不能静默触发。
2. 默认共享聚合数据，不共享 `result.full.json` 或 `raw/`。
3. 命中敏感字段时弹窗必须突出展示，用户需要再次确认。
4. `allow_raw_detail` 默认为 `false`；启用后仍需要单次确认。
5. 本地日志只记录 MCP 工具名、目标表、行数和错误摘要，不记录 MCP token。
6. 共享失败不得删除本地结果，不得重试超过配置上限。
7. 每个成员通过自己的钉钉 AI 表格 MCP 权限写入，权限不足时显示失败原因。

## 错误处理

1. 未配置目标：Dashboard 禁用共享按钮，并提示配置 `share-targets.yaml`。
2. MCP 不可用：共享任务状态变为 `failed_mcp_unavailable`。
3. Base 未找到：状态变为 `failed_target_not_found`，提示补充 `base_id`。
4. 表或字段创建失败：状态变为 `failed_schema_setup`。
5. 写入部分成功：状态变为 `partial_success`，记录成功行数、失败行数和可重试建议。
6. 大文件导入超时：状态变为 `pending_import_completion`，允许用户在页面重试检查或重新执行。
7. 用户在共享期间切换页面或刷新浏览器：Dashboard 必须根据 `share_id` 恢复进度展示。
8. 检测到同一 session 或 metric 已有运行中的共享任务：拒绝创建新任务，并显示已有任务进度。

## Dashboard 体验

1. 当前分析页和历史详情页显示「共享数据」按钮。
2. 指标详情页显示「共享指标」按钮。
3. 指标模块使用 tabs 或 segmented control 区分「本地指标库」和「共享指标库」。
4. 共享指标库 tab 显示最近同步时间、目标 Base、刷新按钮和 MCP 错误状态。
5. 共享指标详情展示口径、字段含义、共享人、共享时间、来源 session、目标 record id 和「复制到本地」动作。
6. 共享按钮旁展示目标名称和最近一次共享状态。
7. 共享确认弹窗必须展示字段、行数、范围、敏感字段和目标文档。
8. 共享执行中展示进度条、当前步骤和已写入行数。
9. 共享执行中锁定当前共享对象相关操作，防止重复共享或上下文错乱。
10. 共享完成后显示目标 Base、目标表和共享时间。
11. 共享失败后显示可执行建议，而不是只显示错误码。

## 验证

实现后需要验证：

1. 无共享配置时 Dashboard 不允许执行共享。
2. 只配置 `base_name` 且命中多个 Base 时，要求补 `base_id`。
3. 指标共享可新增、可更新、可写本地历史。
4. 小数据集走 `create_records`。
5. 大数据集走导入文件路径。
6. 敏感字段命中时需要二次确认。
7. MCP 权限失败会回写本地审计。
8. Dashboard 自动刷新共享状态。
9. `validate_workspace.mjs` 能检查共享配置和日志目录。
10. 指标模块能区分本地指标和共享指标。
11. 共享指标同步失败时，本地指标库仍可正常使用。
12. 共享指标复制到本地后保留来源记录。
13. Agent 指标匹配能读取共享指标缓存，但不会把共享指标自动标记为本地 validated。
14. 共享执行中 Dashboard 展示进度条并能在刷新后恢复。
15. 同一 session 或 metric 的运行中共享任务不能被重复创建。
16. 共享失败重试复用原 `share_id` 并保留 attempt 记录。
17. 系统 `quick_validate.py` 通过。
