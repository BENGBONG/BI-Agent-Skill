# 指标口径格式

复用指标保存为 `metrics/<metric-id>.yaml`。`metric-id` 使用小写字母、数字和下划线；`name` 是页面展示名，必须使用中文指标名。

推荐字段：

```yaml
id: credit_approval_rate
name: 授信通过率
status: draft
version: 1
description: 授信通过人数占发起授信人数的比例
definition: 授信通过人数 / 发起授信人数
grain: user_day
time_field:
  field: apply_time
  description: 使用授信申请发起时间作为时间口径
numerator:
  name: 授信通过人数
  logic: count(distinct user_id) where credit_status in ('APPROVED')
denominator:
  name: 发起授信人数
  logic: count(distinct user_id) where apply_id is not null
dimensions:
  - channel
  - product
source_tables:
  - table: credit_apply
    role: 授信申请主表
actual_sql: |
  SELECT ...
backend_evidence:
  - path: services/credit
    summary: 后端 APPROVED 状态映射
validation:
  validated_by: agent
  validated_at: "2026-06-27T00:00:00+08:00"
  human_confirmed: false
  confidence: medium
notes:
  - 标记 validated 前需要确认重复申请处理方式。
```

状态：

- `draft`：Agent 初步推导，未确认。
- `reviewed`：用户或研发已看过，但仍可能调整。
- `validated`：已确认，可默认复用。
- `deprecated`：不再使用。

规则：

- 没有明确确认时，不要将指标标记为 `validated`。
- 若状态为 `validated`，`validated_by` 必须是用户或研发标识，不能是 `agent`，且 `human_confirmed` 必须为 `true`。
- 使用脚本保存 validated 指标时必须传入 `--confirm-validated --validated-by <用户或研发标识>`。
- 从查询 session 保存指标时必须写入 `actual_sql`，内容为本次最终实际执行的 SQL 或等价查询语句；共享指标优先同步该字段。
- 修改指标时递增 `version`，并在 `notes` 说明原因。
- 用户问题语义匹配时，优先复用 `validated` 指标。

版本历史：

- 每次覆盖已有 `metrics/<metric-id>.yaml` 时，旧版本会归档到 `metrics/_history/<metric-id>/`。
- 同步生成 `*-diff.md`，用于审计口径变更。
- 可用 `node scripts/metric_history.mjs --id <metric-id>` 查看历史。
