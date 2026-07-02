# Agent BI 设计规范

## 设计基因
来源: Linear + PostHog + Notion

Agent BI 是 Agent 对话后的只读可视化工作台，不是传统 Web BI 操作台。视觉基调采用 Linear 的精密、低噪声和键盘友好信息密度；数据图表采用 PostHog 的 IBM Plex Sans 数据气质与高辨识序列色；审计、指标口径、查询计划等长文本区域采用 Notion 的温和阅读边界和轻量折叠方式。整体目标是“清楚、克制、可审计”，避免营销感和装饰性仪表盘。

## 色彩体系
### 品牌色
- Primary Indigo: `#5e6ad2`。用于当前选中、主要高亮、图表主序列和关键交互。
- Accent Violet: `#7170ff`。用于 hover、focus、链接和次级高亮。
- Accent Hover: `#828fff`。用于高亮 hover，不作为大面积背景。

### 中性色
- Page Background: `#f7f8f8`。来自 Linear light background。
- Surface: `#ffffff`。卡片、表格、审计块主表面。
- Surface Subtle: `#f3f4f5`。侧栏、辅助分区、表头。
- Text Primary: `#202426`。接近 Linear 深色正文。
- Text Secondary: `#62666d`。元信息、说明文案。
- Text Muted: `#8a8f98`。时间戳、空状态、辅助标签。
- Border: `#d0d6e0`。Linear light border。
- Whisper Border: `rgba(0,0,0,0.1)`。Notion 式内容边界。

### 语义色
- Success: `#10b981`，状态完成、自动刷新可用。
- Warning: `#F7A501`，自动刷新、待处理、提示。
- Error: `#b24b43`，失败状态和风险提示。
- Info: `#0075de`，链接、附件打开、信息性提示。

### 图表色
图表使用 PostHog/数据密集风格的高辨识但不过饱和序列：
- `#5e6ad2`, `#F7A501`, `#10b981`, `#7a7fad`, `#F54E00`, `#62666d`, `#7170ff`, `#b17816`

## 字体规范
### 字体族
- UI 字体: `Inter Variable`, `Inter`, `PingFang SC`, `Microsoft YaHei`, `SF Pro Display`, `-apple-system`, `system-ui`, `Segoe UI`, `sans-serif`
- 图表/数据字体: 同 UI 字体，数字可用 590/700 字重强化。
- 代码/审计: `Berkeley Mono`, `SF Mono`, `ui-monospace`, `Menlo`, `Consolas`, `monospace`
- OpenType: UI 字体启用 `font-feature-settings: "cv01", "ss03"`；长文本和中文不使用负字距。

### 字号层级表
| 角色 | 字号 | 字重 | 行高 | 说明 |
|---|---:|---:|---:|---|
| 页面标题 | 24px | 590 | 1.2 | 当前问题标题 |
| 卡片标题 | 17px | 590 | 1.35 | 图表标题、内容块标题 |
| 分区标题 | 13px | 590 | 1.4 | 侧栏、审计 summary |
| 正文 | 13px | 400 | 1.5 | 列表、表格、说明 |
| 元信息 | 12px | 510 | 1.4 | pill、badge、时间戳 |
| KPI 数字 | 30px | 590 | 1.08 | 首屏关键数字 |
| 审计代码 | 12px | 400 | 1.55 | 查询计划、JSON、SQL |

## 组件规范
### 按钮
- 主按钮: `#5e6ad2` 背景，白色文字，6px 圆角，hover `#828fff`。
- 次按钮: 白底，`#d0d6e0` 边框，`#202426` 文字，hover 提升到 `#7170ff` 边框。
- Ghost: 透明背景，hover 使用 `#f3f4f5`。
- 禁用: `#f3f4f5` 背景，`#8a8f98` 文字。

### 卡片
- 背景 `#ffffff`，边框 `1px solid #d0d6e0`，圆角 8px。
- 阴影使用 Notion 式低透明多层阴影，不使用厚重投影。
- KPI 卡片使用左侧 4px 色条区分，不用大面积彩色背景。

### 输入框
- 背景 `#ffffff`，边框 `#d0d6e0`，圆角 6px。
- Focus: `0 0 0 3px rgba(113,112,255,0.16)`。
- Placeholder 使用 `#8a8f98`。

### 导航栏
- 顶部栏使用 `rgba(247,248,248,0.96)` sticky + blur。
- 左侧资产导航使用 segment control，选中态为 Primary Indigo。
- 右侧审计使用 `details/summary`，默认只展开关键块。

### 徽章/标签
- 状态 pill 使用 full pill 或 7px 圆角。
- 成功 `#10b981` 浅底；警告 `#F7A501` 浅底；错误 `#b24b43` 浅底。

### 图表
- 图表卡片需要大留白，标签允许倾斜但不得互相覆盖。
- 图表类型切换是展示层交互，不改变 session 文件。
- 移动端图表在卡片内部横向滚动，不撑破页面。

### 审计块
- 使用 Notion 式低噪声折叠卡片。
- `summary` 高度 40px，内容使用 monospace 12px/1.55。
- 长查询计划默认折叠，避免压迫当前结果。

## 间距 & 布局
### 间距刻度
- 基础单位 8px。
- 常用刻度: 4px, 6px, 8px, 10px, 12px, 14px, 16px, 18px, 24px, 32px。

### 栅格系统
- 桌面: 316px 左栏 + 中间弹性结果区 + 392px 审计栏。
- 中屏: 左栏 + 主内容，审计块下移成两列。
- 移动: 当前结果优先，其次资产导航，再审计记录。

### 留白哲学
- 操作型数据页面保持中高密度，但当前图表区必须有充足留白。
- 列表和审计不抢主图表视觉优先级。

## 深度 & 阴影
### 阴影层级
- Level 0: 无阴影，页面背景。
- Level 1: `1px solid #d0d6e0`，常规卡片。
- Level 2: `rgba(0,0,0,0.04) 0px 4px 18px, rgba(0,0,0,0.027) 0px 2px 8px, rgba(0,0,0,0.02) 0px 1px 3px`，当前结果卡片。
- Level 3: 仅用于弹层，当前 MVP 不使用。

## 圆角规范
- Segment / button / input: 6px。
- Card / panel / table container: 8px。
- Pill / badge: 9999px。
- 不使用 12px 以上圆角，避免营销卡片感。

## 响应式策略
- `>1240px`: 三栏完整布局。
- `860px-1240px`: 左栏 + 主内容，审计下移两列。
- `<860px`: 单列，顺序为顶部、当前结果、资产导航、审计。
- `<560px`: 顶部按钮单列，session 元信息单列，图表内部横向滚动。

## 设计护栏
### Do
- 保持 Agent 对话为主流程，页面只展示结果和资产。
- 使用 Primary Indigo 表示当前选中和关键交互。
- 使用折叠审计块降低认知负担。
- 使用 sticky 表头、列表 hover 和清晰 focus 状态提高可用性。
- 所有按钮/切换必须只影响展示层，不能触发查询执行。

### Don't
- 不做营销式大 hero、渐变大背景、装饰图形或大圆角卡片。
- 不把查询确认、执行、导入、质量门放回页面。
- 不用纯暖色 PostHog 风格覆盖整个 BI 工作台。
- 不用暗色 Linear 全量照搬，当前产品需要长时间阅读和审计，默认保持亮色。
- 不在图表标签和表格文本上使用负字距。

## AI Agent 快速参考
### 颜色速查
- `--bg`: `#f7f8f8`
- `--panel`: `#ffffff`
- `--panel-soft`: `#f3f4f5`
- `--text`: `#202426`
- `--muted`: `#62666d`
- `--line`: `#d0d6e0`
- `--brand`: `#5e6ad2`
- `--brand-hover`: `#828fff`
- `--success`: `#10b981`
- `--warning`: `#F7A501`
- `--danger`: `#b24b43`

### 示例组件提示词
- “设计一个 Linear 风格的只读数据工作台，浅色背景 `#f7f8f8`，白色卡片，`#d0d6e0` 细边框，Primary Indigo `#5e6ad2` 只用于选中态和主要图表序列。”
- “右侧审计信息使用 Notion 式折叠卡片，summary 13px/590，内容用 monospace 12px/1.55，默认只展开原始需求、Agent 解析、指标计划和风险。”
- “图表区域保留 PostHog 的数据感：IBM/Inter 字体、清晰序列色、紧凑控件，但不要引入插画或暖色全局背景。”
