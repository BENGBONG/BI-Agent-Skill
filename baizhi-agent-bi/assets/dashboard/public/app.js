const state = {
  current: null,
  sessions: [],
  metrics: [],
  sharedMetrics: { records: [], status: "not_synced" },
  shareTargets: { targets: [], defaultTarget: "" },
  shareProfile: { configured: false, displayName: "" },
  shareMcpConfig: { configured: false },
  providers: "",
  providerItems: [],
  catalog: { index: null, queryCapabilities: { providers: [] }, fieldLineage: { fields: [] }, metricCandidates: { metrics: [] } },
  backend: { scans: [] },
  workspacePath: "",
  historyFilter: "",
  tableSort: { column: "", direction: "asc" },
  hiddenSeries: [],
  chartOverrides: {},
  selectedChart: 0,
  currentMarker: "",
  viewedSessionId: "",
  sidebarPanel: "history",
  metricSource: "local",
  selectedMetricId: "",
  selectedSharedMetricId: "",
  selectedCatalog: { type: "provider", id: "" },
  selectedProviderId: "",
  selectedBackendId: "",
  selectedKnowledgeFieldId: "",
  auditDetailsOpen: {},
  auditScrollByScope: {},
  tableRenderSignature: "",
  selectedPreviewGroup: "",
  chartDetail: null,
  chartPopover: null,
  showChartValues: false
};

const colors = ["#5e6ad2", "#F7A501", "#10b981", "#7a7fad", "#F54E00", "#62666d", "#7170ff", "#b17816"];
const refreshIntervalMs = 3500;
const fieldLabels = {
  row_type: "结果类型",
  metric_date: "日期",
  dau: "DAU",
  wau: "WAU",
  mau: "MAU",
  daily_login_events: "日登录事件数",
  source_coverage: "数据覆盖",
  deletion_date: "删除日期",
  audio_source_type: "录音来源",
  kb_space_type: "知识库空间",
  pc_active_users_30d: "近30天PC活跃用户",
  pc_users_with_deleted_audio_in_trash: "近30天回收站录音用户",
  deleted_audio_resources: "近30天回收站录音资源",
  pc_users_with_audio_in_current_trash: "当前回收站录音用户",
  current_trash_audio_resources: "当前回收站录音资源",
  users: "用户数",
  resources: "资源数",
  pc_audio_source_users: "PC来源录音用户",
  pc_audio_source_resources: "PC来源录音资源",
  user_ratio_pct: "用户占比",
  pc_audio_source_user_ratio_pct: "PC来源用户占比"
};

const rowTypeLabels = {
  summary_30d_deleted_window: "近30天删除窗口汇总",
  current_trash_stock: "当前回收站存量",
  audio_source_breakdown: "录音来源拆分",
  daily: "按删除日期趋势"
};

function el(id) {
  return document.getElementById(id);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `${url}: ${response.status}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function copyText(value, label) {
  if (!value) {
    window.alert(`暂无${label}`);
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(() => window.alert(`${label}已复制`));
  } else {
    window.prompt(label, value);
  }
}

function showModalDialog(options = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "modal-dialog";

    const title = document.createElement("h3");
    title.textContent = options.title || "确认操作";
    dialog.appendChild(title);

    const message = document.createElement("p");
    message.className = "modal-message";
    message.textContent = options.message || "";
    dialog.appendChild(message);

    let input = null;
    const error = document.createElement("div");
    error.className = "modal-error";
    if (options.inputLabel) {
      const label = document.createElement("label");
      label.className = "modal-field";
      const span = document.createElement("span");
      span.textContent = options.inputLabel;
      input = options.multiline ? document.createElement("textarea") : document.createElement("input");
      input.value = options.defaultValue || "";
      input.placeholder = options.placeholder || "";
      if (options.rows && input.tagName === "TEXTAREA") {
        input.rows = options.rows;
      }
      label.appendChild(span);
      label.appendChild(input);
      dialog.appendChild(label);
      dialog.appendChild(error);
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.className = "tab ghost-tab";
    cancel.textContent = options.cancelText || "取消";
    const confirm = document.createElement("button");
    confirm.className = `tab ${options.danger ? "danger-tab" : ""}`;
    confirm.textContent = options.confirmText || "确认";
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };
    cancel.addEventListener("click", () => close({ confirmed: false, value: "" }));
    confirm.addEventListener("click", () => {
      const value = input ? input.value.trim() : "";
      if (input && !value) {
        error.textContent = options.requiredMessage || "请先填写内容";
        input.focus();
        return;
      }
      if (input && options.validate) {
        const validation = options.validate(value);
        if (validation) {
          error.textContent = validation;
          input.focus();
          return;
        }
      }
      close({ confirmed: true, value });
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close({ confirmed: false, value: "" });
      }
    });
    document.body.appendChild(backdrop);
    if (input) {
      input.focus();
      input.select();
    } else {
      confirm.focus();
    }
  });
}

function safeFileName(value, fallback = "agent-bi-data") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function humanizeFieldName(value) {
  return String(value || "")
    .replace(/_pct$/i, "_percentage")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldLabel(field, options = {}) {
  const label = fieldLabels[field] || humanizeFieldName(field);
  if (!field || options.short || label === field) {
    return label || "";
  }
  return `${label}（${field}）`;
}

function rowTypeLabel(rowType) {
  return rowTypeLabels[rowType] || fieldLabel(rowType, { short: true }) || "未分组数据";
}

function hasCellValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function columnKey(column) {
  if (typeof column === "string") return column;
  return column?.key || column?.field || column?.id || "";
}

function columnKeys(columns = [], rows = []) {
  const declared = (columns || []).map(columnKey).filter(Boolean);
  if (declared.length) {
    return declared;
  }
  return [...new Set((rows || []).flatMap((row) => Object.keys(row || {})))];
}

function columnsWithValues(columns, rows, options = {}) {
  const excluded = new Set(options.exclude || []);
  return columnKeys(columns, rows).filter((column) => {
    if (excluded.has(column)) return false;
    return rows.some((row) => hasCellValue(row?.[column]));
  });
}

function matchesFilter(row, filter) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    const actual = row?.[key];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
}

function detailFilterLabel(filters = []) {
  return filters
    .map((item) => `${fieldLabel(item.column, { short: true })} = ${item.value}`)
    .join("，");
}

function detailDataAttributes(row, spec, options = {}) {
  const filters = [];
  const xKey = options.xKey || (spec.type === "pie" ? spec.label : spec.x);
  if (xKey && hasCellValue(row?.[xKey])) {
    filters.push({ column: xKey, value: row[xKey] });
  }
  if (spec.series && hasCellValue(row?.[spec.series])) {
    filters.push({ column: spec.series, value: row[spec.series] });
  }
  const rowType = row?.row_type || spec.filter?.row_type || "";
  const yKey = options.yKey || (spec.type === "pie" ? spec.value : spec.metric || spec.y);
  const label = [
    filters.length ? detailFilterLabel(filters) : rowTypeLabel(rowType),
    yKey && hasCellValue(row?.[yKey]) ? `${fieldLabel(yKey, { short: true })} ${row[yKey]}` : ""
  ].filter(Boolean).join("，");
  return [
    `data-chart-detail="1"`,
    `data-row-type="${escapeHtml(rowType)}"`,
    `data-detail-filters="${escapeHtml(JSON.stringify(filters))}"`,
    `data-detail-label="${escapeHtml(label)}"`,
    `data-detail-row="${escapeHtml(JSON.stringify(row || {}))}"`,
    `role="button"`,
    `tabindex="0"`,
    `aria-label="${escapeHtml(`查看详细数据：${label || rowTypeLabel(rowType)}`)}"`
  ].join(" ");
}

function tableDataForDownload(session) {
  const preview = session?.preview || {};
  const aggregate = session?.aggregate || {};
  const columns = preview.columns?.length ? preview.columns : aggregate.columns || [];
  const rows = preview.rows?.length ? preview.rows : aggregate.rows || [];
  return { columns, rows, source: preview.rows?.length ? "preview" : "aggregate" };
}

function downloadCurrentData(format = "csv") {
  const session = state.current;
  if (!session?.sessionId) {
    window.alert("暂无可下载的数据");
    return;
  }
  const { columns, rows, source } = tableDataForDownload(session);
  if (!columns.length || !rows.length) {
    window.alert("暂无可下载的数据");
    return;
  }
  const baseName = safeFileName(`${session.sessionId}-${source}`);
  if (format === "json") {
    const payload = {
      sessionId: session.sessionId,
      source,
      downloadedAt: new Date().toISOString(),
      rowCount: rows.length,
      columns,
      rows
    };
    downloadBlob(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" }), `${baseName}.json`);
    return;
  }
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
  downloadBlob(new Blob([`\uFEFF${csv}\n`], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`);
}

function svgText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function currentChartSvgMarkup() {
  const chart = el("chart");
  const title = el("chart-title")?.textContent || "图表";
  if (!chart) {
    throw new Error("暂无可复制的图表");
  }
  const chartRect = chart.getBoundingClientRect();
  const width = Math.max(720, Math.ceil(chartRect.width || 900));
  const height = Math.max(360, Math.ceil(chartRect.height || 360));
  const titleHeight = 42;
  const innerSvg = chart.querySelector("svg");
  const svgStyle = `<style>
    text { font-family: Inter, "PingFang SC", "Microsoft YaHei", -apple-system, system-ui, sans-serif; fill: #202426; font-size: 12px; }
    .axis text { fill: #687074; font-size: 11px; }
  </style>`;
  if (innerSvg) {
    const clone = innerSvg.cloneNode(true);
    clone.setAttribute("x", "0");
    clone.setAttribute("y", String(titleHeight));
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height - titleHeight));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${svgStyle}
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="18" y="27" font-size="18" font-weight="700">${svgText(title)}</text>
      ${clone.outerHTML}
    </svg>`;
  }
  const value = chart.querySelector(".kpi-chart-value")?.textContent || "";
  const label = chart.querySelector(".kpi-chart-label")?.textContent || title;
  const desc = chart.querySelector(".kpi-chart-desc")?.textContent || "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${svgStyle}
    <rect width="100%" height="100%" rx="8" fill="#ffffff"/>
    <rect x="16" y="56" width="${width - 32}" height="${height - 80}" rx="8" fill="#f7f9fc" stroke="#e4e8ef"/>
    <text x="48" y="${Math.round(height / 2) - 34}" font-size="13" font-weight="620" fill="#687074">${svgText(label)}</text>
    <text x="48" y="${Math.round(height / 2) + 24}" font-size="44" font-weight="720" fill="#202426">${svgText(value)}</text>
    ${desc ? `<text x="48" y="${Math.round(height / 2) + 58}" font-size="13" fill="#687074">${svgText(desc.slice(0, 110))}</text>` : ""}
  </svg>`;
}

async function chartAreaPngBlob() {
  const svg = currentChartSvgMarkup();
  const imageUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(image.width * scale);
    canvas.height = Math.ceil(image.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图表图片生成失败")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function copyChartImage() {
  try {
    const blob = await chartAreaPngBlob();
    const fileName = `${safeFileName(state.current?.sessionId || "chart")}-chart.png`;
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      window.alert("图表图片已复制");
    } else {
      downloadBlob(blob, fileName);
      window.alert("当前浏览器不支持直接复制图片，已下载 PNG");
    }
  } catch (error) {
    window.alert(error.message || "复制图表图片失败");
  }
}

function markdownText(value) {
  return String(value || "").replace(/^#\s+/gm, "").trim();
}

function readableInline(value) {
  return escapeHtml(String(value ?? ""))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function readableLine(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([^：:]{2,22})[：:]\s*(.+)$/);
  if (!match) {
    return readableInline(text);
  }
  return `<span class="readable-term">${readableInline(match[1])}</span><span>${readableInline(match[2])}</span>`;
}

function renderReadableMarkdown(value, options = {}) {
  const text = markdownText(value);
  if (!text) {
    return `<p class="audit-help">${escapeHtml(options.emptyText || "暂无内容")}</p>`;
  }
  const blocks = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul class="readable-list">${listItems.map((item) => `<li>${readableLine(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(`<h4>${readableInline(heading[1])}</h4>`);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flushList();
    blocks.push(`<p>${readableLine(line)}</p>`);
  });
  flushList();
  return blocks.join("");
}

function formatNumber(value, unit = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  const formatted = Math.abs(number) >= 1000 ? number.toLocaleString() : number.toFixed(Number.isInteger(number) ? 0 : 1);
  const unitLabels = { users: "人", events: "次", resources: "个" };
  const displayUnit = unitLabels[unit] || unit;
  const separator = displayUnit && /^[A-Za-z]+$/.test(displayUnit) ? " " : "";
  return `${formatted}${separator}${displayUnit}`;
}

function compactLabel(value, max = 10) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(2, max - 2))}...`;
}

function asText(value) {
  if (value === null || value === undefined || value === "") {
    return "未登记";
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(" / ") : "未登记";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function detailRows(rows) {
  return `<dl class="detail-grid">${rows.map((row) => `
    <div>
      <dt>${escapeHtml(row.label)}</dt>
      <dd>${escapeHtml(asText(row.value))}</dd>
    </div>
  `).join("")}</dl>`;
}

function readableValueHtml(value, depth = 0) {
  if (value === null || value === undefined || value === "") {
    return `<span class="muted-text">未登记</span>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return `<span class="muted-text">未登记</span>`;
    }
    const simpleItems = value.every((item) => ["string", "number", "boolean"].includes(typeof item));
    if (simpleItems && value.length <= 5) {
      return `<div class="readable-tags">${value.map((item) => `<span>${readableInline(item)}</span>`).join("")}</div>`;
    }
    return `<ul class="readable-list compact-list">${value.map((item) => `<li>${readableValueHtml(item, depth + 1)}</li>`).join("")}</ul>`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "");
    if (!entries.length) {
      return `<span class="muted-text">未登记</span>`;
    }
    if (depth > 1) {
      return `<pre class="inline-json">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    }
    return `<dl class="readable-kv">${entries.map(([key, item]) => `
      <div>
        <dt>${escapeHtml(fieldLabel(key, { short: true }))}</dt>
        <dd>${readableValueHtml(item, depth + 1)}</dd>
      </div>
    `).join("")}</dl>`;
  }
  return `<span>${readableLine(value)}</span>`;
}

function readableDetailRows(rows, className = "") {
  return `<dl class="detail-grid readable-detail-grid ${escapeHtml(className)}">${rows.map((row) => `
    <div>
      <dt>${escapeHtml(row.label)}</dt>
      <dd>${readableValueHtml(row.value)}</dd>
    </div>
  `).join("")}</dl>`;
}

function tags(values, emptyText = "未登记") {
  const items = (values || []).filter(Boolean);
  if (!items.length) {
    return `<div class="meta">${escapeHtml(emptyText)}</div>`;
  }
  return `<div class="tag-row">${items.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function auditBlock(title, body, open = true, key = title) {
  return `<details class="audit-block" data-detail-key="audit:${escapeHtml(key)}" ${open ? "open" : ""}>
    <summary>${escapeHtml(title)}</summary>
    ${body}
  </details>`;
}

function currentAuditScopeKey() {
  if (state.sidebarPanel === "history") {
    return `history:${state.current?.sessionId || ""}`;
  }
  if (state.sidebarPanel === "metrics") {
    const metricId = state.metricSource === "shared" ? state.selectedSharedMetricId : state.selectedMetricId;
    return `metrics:${state.metricSource}:${metricId || ""}`;
  }
  if (state.sidebarPanel === "providers") {
    return `providers:${state.selectedProviderId || ""}`;
  }
  if (state.sidebarPanel === "catalog") {
    return `catalog:${state.selectedCatalog?.type || ""}:${state.selectedCatalog?.id || ""}`;
  }
  if (state.sidebarPanel === "backend") {
    return `backend:${state.selectedBackendId || ""}:${state.selectedKnowledgeFieldId || ""}`;
  }
  return state.sidebarPanel || "dashboard";
}

function auditDetailStateKey(scope, detail) {
  const key = detail.dataset.detailKey;
  return key ? `${scope}:${key}` : "";
}

function rememberAuditScrollState() {
  const panel = el("audit-panel");
  if (!panel) return;
  const scope = panel.dataset.auditScope || currentAuditScopeKey();
  state.auditScrollByScope[scope] = {
    top: panel.scrollTop || 0,
    left: panel.scrollLeft || 0
  };
}

function restoreAuditScrollState() {
  const panel = el("audit-panel");
  if (!panel) return;
  const scope = currentAuditScopeKey();
  const scroll = state.auditScrollByScope[scope];
  if (!scroll) return;
  panel.scrollTop = scroll.top;
  panel.scrollLeft = scroll.left;
  window.requestAnimationFrame(() => {
    panel.scrollTop = scroll.top;
    panel.scrollLeft = scroll.left;
  });
}

function rememberAuditDetailsState() {
  const panel = el("audit-panel");
  if (!panel) return;
  const scope = panel.dataset.auditScope || currentAuditScopeKey();
  panel.querySelectorAll("details[data-detail-key]").forEach((detail) => {
    const key = auditDetailStateKey(scope, detail);
    if (key) {
      state.auditDetailsOpen[key] = detail.open;
    }
  });
}

function restoreAuditDetailsState() {
  const panel = el("audit-panel");
  if (!panel) return;
  const scope = currentAuditScopeKey();
  panel.dataset.auditScope = scope;
  panel.querySelectorAll("details[data-detail-key]").forEach((detail) => {
    const key = auditDetailStateKey(scope, detail);
    if (key && Object.prototype.hasOwnProperty.call(state.auditDetailsOpen, key)) {
      detail.open = state.auditDetailsOpen[key];
    }
    if (!detail.dataset.detailStateBound) {
      detail.addEventListener("toggle", () => {
        const liveKey = auditDetailStateKey(panel.dataset.auditScope || scope, detail);
        if (liveKey) {
          state.auditDetailsOpen[liveKey] = detail.open;
        }
      });
      detail.dataset.detailStateBound = "true";
    }
  });
}

function uniqueValues(values = []) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null && String(value).trim() !== ""))];
}

function mergeProviderRecords(records = []) {
  const byId = new Map();
  records.forEach((record) => {
    if (!record?.id) {
      return;
    }
    const existing = byId.get(record.id) || {};
    byId.set(record.id, {
      ...existing,
      ...record,
      displayName: existing.displayName || record.displayName,
      description: existing.description || record.description,
      type: existing.type || record.type,
      status: existing.status || record.status,
      mcpServerHint: existing.mcpServerHint || record.mcpServerHint,
      toolName: existing.toolName || record.toolName,
      skillEntrypoint: existing.skillEntrypoint || record.skillEntrypoint,
      routingGuide: existing.routingGuide || record.routingGuide,
      inputSchemaRef: existing.inputSchemaRef || record.inputSchemaRef,
      outputSchemaRef: existing.outputSchemaRef || record.outputSchemaRef,
      safetyPolicy: { ...(record.safetyPolicy || {}), ...(existing.safetyPolicy || {}) },
      capabilities: uniqueValues([...(existing.capabilities || []), ...(record.capabilities || [])]),
      queryScope: uniqueValues([...(existing.queryScope || []), ...(record.queryScope || [])]),
      routingKeywords: uniqueValues([...(existing.routingKeywords || []), ...(record.routingKeywords || [])]),
      knownData: uniqueValues([...(existing.knownData || []), ...(record.knownData || [])]),
      limitations: uniqueValues([...(existing.limitations || []), ...(record.limitations || [])]),
      toolNames: uniqueValues([...(existing.toolNames || []), ...(record.toolNames || [])]),
      toolSchemas: uniqueValues([...(existing.toolSchemas || []), ...(record.toolSchemas || [])].map((tool) => JSON.stringify(tool))).map((tool) => JSON.parse(tool))
    });
  });
  return [...byId.values()];
}

function canonicalProviders(records = []) {
  return mergeProviderRecords(records).filter((provider) => {
    if (provider.legacyReplacedBy) {
      return false;
    }
    if (provider.status === "disabled" && ["bairong_data_query", "baizhi_online_logs"].includes(provider.id)) {
      return false;
    }
    return true;
  });
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label || "处理中";
    button.classList.add("busy");
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
    button.classList.remove("busy");
    delete button.dataset.originalText;
  }
}

function preBlock(value) {
  return `<pre>${escapeHtml(asText(value))}</pre>`;
}

function historyContentTemplate() {
  return `
    <section class="chart-toolbar">
      <div class="toolbar-row">
        <div class="field-controls">
          <label>维度/分组 <select id="dimension-select"></select></label>
          <label>指标/数值 <select id="metric-select"></select></label>
          <label class="toggle-control"><input id="chart-value-toggle" type="checkbox" ${state.showChartValues ? "checked" : ""}> 显示数值</label>
        </div>
        <div class="chart-actions">
          <button id="metric-save-btn" class="tab ghost-tab">保存指标</button>
          <button id="share-data-btn" class="tab ghost-tab">共享数据</button>
          <button id="delete-session-btn" class="tab ghost-tab danger-tab">删除历史</button>
          <button id="download-csv-btn" class="tab ghost-tab">下载 CSV</button>
          <button id="download-json-btn" class="tab ghost-tab">下载 JSON</button>
          <button id="copy-chart-btn" class="tab ghost-tab">复制图表</button>
        </div>
      </div>
      <div id="chart-tabs" class="chart-tabs"></div>
    </section>
    <div id="share-progress-slot"></div>
        <section class="chart-area">
          <div id="chart-title" class="chart-title"></div>
          <div id="legend-controls" class="legend-controls"></div>
          <div id="chart" class="chart"></div>
          <div id="chart-popover" class="chart-popover" hidden></div>
        </section>
    <section class="table-area">
      <div class="section-head">
        <h2>数据预览</h2>
        <span id="row-count"></span>
      </div>
      <div id="preview-tabs" class="preview-tabs"></div>
      <div id="chart-detail" class="chart-detail" hidden></div>
      <div id="preview-table" class="table-wrap"></div>
    </section>
  `;
}

function historyAuditTemplate() {
  return `
    ${auditBlock("原始需求", `<div id="request" class="audit-readable"></div>`)}
    ${auditBlock("Agent 解析", `<div id="interpretation" class="audit-readable"></div>`)}
    ${auditBlock("指标计算口径", `<div id="metric-plan"></div>`)}
    ${auditBlock("确认与风险", `<div id="confirmation-summary" class="audit-readable"></div>`)}
    ${auditBlock("查询源详情", `<pre id="provider-summary"></pre>`, false)}
    ${auditBlock("查询计划", `<pre id="query-plan"></pre>`, false)}
    ${auditBlock("审计说明", `<div id="audit" class="audit-readable"></div>`, false)}
    ${auditBlock("关联记录", `<div id="lineage" class="list compact"></div>`)}
    ${auditBlock("修订记录", `<div id="revisions" class="list compact"></div>`)}
    ${auditBlock("待 Agent 处理", `<p class="audit-help">这里记录必须回到 Agent 对话确认后才能执行的请求，例如下钻分析或知识库字段说明更新。保存指标会直接写入指标库，但页面不会执行生产查询。</p><div id="pending-actions" class="list compact"></div>`, false)}
  `;
}

function assetHero(kind, title, subtitle, stats = []) {
  return `
    <section class="asset-hero">
      <div>
        <div class="eyebrow">${escapeHtml(kind)}</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle || "")}</p>
      </div>
      ${stats.length ? `<div class="asset-stat-grid">${stats.map((stat) => `
        <div class="asset-stat">
          <span>${escapeHtml(stat.label)}</span>
          <strong>${escapeHtml(asText(stat.value))}</strong>
        </div>
      `).join("")}</div>` : ""}
    </section>
  `;
}

function setAssetAudit(title, blocks) {
  el("audit-panel").innerHTML = blocks.map((block) => auditBlock(block.title, block.body, block.open !== false, block.key || block.title)).join("");
}

function zhStatus(status) {
  const map = {
    sample_data: "示例数据",
    planned: "已计划",
    completed: "已完成",
    failed: "失败",
    pending: "待处理",
    pending_confirmation: "待确认",
    confirmed: "已确认",
    running: "执行中",
    completed: "已完成",
    failed_mcp_unavailable: "MCP 不可用",
    failed_target_not_configured: "目标未配置",
    failed_target_not_found: "目标未找到",
    failed_schema_setup: "表结构失败",
    partial_success: "部分成功",
    pending_import_completion: "导入待确认",
    confirmed_blocked: "确认后阻断",
    ready_for_provider: "待查询源执行",
    draft: "草稿",
    enabled: "已启用",
    disabled: "已禁用",
    unknown: "未知"
  };
  return map[status] || status || "";
}

function runningShareAction(actions = []) {
  return actions.find((action) => ["confirmed", "running", "pending_import_completion"].includes(action.status)) || null;
}

function latestShareAction(actions = []) {
  return [...actions].sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0] || null;
}

function renderShareProgress(action) {
  if (!action) {
    return "";
  }
  const progress = action.progress || {};
  const percent = Number(progress.percent || (action.status === "completed" ? 100 : 0));
  const steps = progress.steps || [];
  return `
    <section class="share-progress ${action.status === "completed" ? "done" : action.status?.startsWith?.("failed") ? "failed" : ""}">
      <div class="share-progress-head">
        <div>
          <strong>${escapeHtml(action.shareType === "metric" ? "共享指标" : "共享数据")}</strong>
          <span>${escapeHtml(zhStatus(action.status) || action.status)} · ${escapeHtml(action.shareId || "")}</span>
        </div>
        <span>${escapeHtml(Math.round(percent))}%</span>
      </div>
      <div class="progress-track"><div style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>
      ${steps.length ? `<div class="progress-steps">${steps.map((step) => `
        <span class="${escapeHtml(step.status)}">${escapeHtml(step.label)}</span>
      `).join("")}</div>` : ""}
      ${action.error ? `<div class="share-error">${escapeHtml(action.error)}</div>` : ""}
      ${action.target?.tableName ? `<div class="meta">目标：${escapeHtml(action.target.baseId || "")} / ${escapeHtml(action.target.tableName)}</div>` : ""}
    </section>
  `;
}

function shareTargetsReady() {
  return (state.shareTargets.targets || []).some((target) => target.enabled);
}

function targetLabel() {
  const target = (state.shareTargets.targets || []).find((item) => item.id === state.shareTargets.defaultTarget) || (state.shareTargets.targets || [])[0];
  if (!target) {
    return "未配置共享目标";
  }
  return `${target.base_name || target.base_id || target.id}${target.enabled ? "" : "（未启用）"}`;
}

function dingTalkMcpExample(config = state.shareMcpConfig || {}) {
  return JSON.stringify(config.example || {
    mcpServers: {
      "钉钉 AI 表格": {
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer <token>"
        }
      }
    }
  }, null, 2);
}

async function refreshShareMcpConfig() {
  state.shareMcpConfig = await fetchJson("/api/share-mcp-config");
  return state.shareMcpConfig;
}

async function promptDingTalkMcpConfig(config = state.shareMcpConfig || {}) {
  const result = await showModalDialog({
    title: "配置钉钉 AI 表格 MCP",
    message: `首次使用共享指标或共享数据前，需要配置钉钉 AI 表格 MCP。配置会保存到用户级文件：${config.configPath || "~/.agent-bi/mcp-servers.json"}，不会写入 Skill 包或共享工作区。`,
    inputLabel: "MCP 配置 JSON",
    defaultValue: dingTalkMcpExample(config),
    placeholder: "{ \"mcpServers\": { ... } }",
    multiline: true,
    rows: 12,
    confirmText: "保存配置",
    requiredMessage: "请粘贴钉钉 MCP 配置 JSON",
    validate: (value) => {
      try {
        JSON.parse(value);
        return "";
      } catch (error) {
        return `JSON 格式不正确：${error.message}`;
      }
    }
  });
  if (!result.confirmed) {
    return false;
  }
  const payload = await postJson("/api/share-mcp-config", { configJson: result.value });
  state.shareMcpConfig = payload.config || { configured: true };
  return Boolean(state.shareMcpConfig.configured);
}

async function ensureShareMcpConfig() {
  const config = await refreshShareMcpConfig();
  if (config.configured) {
    return true;
  }
  return promptDingTalkMcpConfig(config);
}

async function handleShareError(error, fallbackMessage) {
  if (/MCP|endpoint|不可用|failed_mcp_unavailable/i.test(error.message || "")) {
    const configured = await promptDingTalkMcpConfig(state.shareMcpConfig);
    if (configured) {
      window.alert("钉钉 MCP 配置已保存，请重新执行共享操作。");
    }
    return;
  }
  window.alert(fallbackMessage);
}

async function ensureShareProfile() {
  if (state.shareProfile?.configured && state.shareProfile.displayName) {
    return state.shareProfile.displayName;
  }
  const result = await showModalDialog({
    title: "设置共享用户名",
    message: "首次共享前需要指定用户名，团队共享指标和数据会记录这个共享人。",
    inputLabel: "用户名",
    placeholder: "例如：张三 / Codex",
    confirmText: "保存并继续"
  });
  if (!result.confirmed) {
    return "";
  }
  const displayName = result.value;
  const payload = await postJson("/api/share-profile", { displayName });
  state.shareProfile = payload.profile || { configured: true, displayName };
  return state.shareProfile.displayName || displayName;
}

async function shareCurrentSession(session) {
  if (!session?.sessionId) {
    window.alert("暂无可共享的数据");
    return;
  }
  const data = tableDataForDownload(session);
  const latest = latestShareAction(session.shareActions || []);
  const running = runningShareAction(session.shareActions || []);
  if (running) {
    window.alert("该查询已有共享任务执行中，页面会继续显示当前进度。");
    return;
  }
  if (!await ensureShareMcpConfig()) return;
  if (!shareTargetsReady()) {
    window.alert("共享目标未启用。请先在 config/share-targets.yaml 配置公共 AI 表格并启用。");
    return;
  }
  const sharedBy = await ensureShareProfile();
  if (!sharedBy) return;
  const sensitive = data.columns.filter((column) => /token|authorization|phone|mobile|id_card|身份证|手机号/i.test(column));
  const ok = await showModalDialog({
    title: "共享当前查询数据",
    message: `目标：${targetLabel()}\n共享人：${sharedBy}\nSession：${session.sessionId}\n范围：${data.source}\n行数：${data.rows.length}\n字段：${data.columns.join(", ")}\n敏感字段：${sensitive.join(", ") || "无"}`,
    confirmText: "确认共享"
  });
  if (!ok.confirmed) return;
  const button = el("share-data-btn");
  setButtonBusy(button, true, "共享中");
  try {
    await postJson(`/api/sessions/${encodeURIComponent(session.sessionId)}/share`, {
      dataScope: data.source,
      sensitiveFieldsConfirmed: sensitive.length > 0,
      sharedBy,
      confirmedBy: sharedBy
    });
    await load({ keepChartState: true });
  } catch (error) {
    await handleShareError(error, `共享任务创建失败：${error.message}`);
    setButtonBusy(button, false);
    if (latest?.shareId) console.warn(latest);
  }
}

async function shareMetric(metric) {
  if (!metric?.id) {
    window.alert("请选择本地指标");
    return;
  }
  const running = runningShareAction(metric.shareActions || []);
  if (running) {
    window.alert("该指标已有共享任务执行中。");
    return;
  }
  if (!await ensureShareMcpConfig()) return;
  if (!shareTargetsReady()) {
    window.alert("共享目标未启用。请先在 config/share-targets.yaml 配置公共 AI 表格并启用。");
    return;
  }
  const sharedBy = await ensureShareProfile();
  if (!sharedBy) return;
  const ok = await showModalDialog({
    title: "共享指标",
    message: `目标：${targetLabel()}\n共享人：${sharedBy}\n指标：${metric.name || metric.id}\n状态：${metric.status}\n口径：${metric.definition || metric.description || ""}`,
    confirmText: "确认共享"
  });
  if (!ok.confirmed) return;
  const button = el("share-metric-btn");
  setButtonBusy(button, true, "共享中");
  try {
    await postJson(`/api/metrics/${encodeURIComponent(metric.id)}/share`, { sensitiveFieldsConfirmed: true, sharedBy, confirmedBy: sharedBy });
    await load({ keepChartState: true });
  } catch (error) {
    await handleShareError(error, `共享指标失败：${error.message}`);
    setButtonBusy(button, false);
  }
}

async function refreshSharedMetrics() {
  try {
    if (!await ensureShareMcpConfig()) return;
    await postJson("/api/shared-metrics", {});
    await load({ keepChartState: true });
  } catch (error) {
    await handleShareError(error, `刷新共享指标失败：${error.message}`);
  }
}

async function copySharedMetric(metric) {
  if (!metric?.id && !metric?.recordId) {
    window.alert("请选择共享指标");
    return;
  }
  const ok = window.confirm(`复制共享指标到本地指标库？\n\n指标：${metric.name || metric.id}\n来源：${metric.sharedBy || "团队共享"}`);
  if (!ok) return;
  try {
    const payload = await postJson(`/api/shared-metrics/${encodeURIComponent(metric.id || metric.recordId)}/copy-local`, {});
    state.metricSource = "local";
    state.selectedMetricId = payload.result.id;
    await load({ keepChartState: true });
  } catch (error) {
    window.alert(`复制失败：${error.message}`);
  }
}

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `${url}: ${response.status}`);
  }
  return payload;
}

async function deleteCurrentSession(session) {
  if (!session?.sessionId) {
    window.alert("暂无可删除的历史查询");
    return;
  }
  const ok = window.confirm(`确认删除本地历史查询？\n\nSession：${session.sessionId}\n问题：${session.metadata?.question || ""}\n\n只会删除本地 sessions 下的查询数据、图表和审计记录；已保存到指标库的指标不会删除。`);
  if (!ok) return;
  const second = window.confirm("请再次确认删除。该操作会移除本地查询历史数据，不能从 Dashboard 恢复。");
  if (!second) return;
  try {
    await deleteJson(`/api/sessions/${encodeURIComponent(session.sessionId)}`);
    state.viewedSessionId = "";
    await load({ keepChartState: false });
  } catch (error) {
    window.alert(`删除历史失败：${error.message}`);
  }
}

async function deleteMetric(metric) {
  if (!metric?.id) {
    window.alert("请选择本地指标");
    return;
  }
  const ok = window.confirm(`确认删除本地指标？\n\n指标：${metric.name || metric.id}\nID：${metric.id}\n\n只会删除本地 metrics/${metric.id}.yaml；历史查询记录和共享指标缓存不受影响。`);
  if (!ok) return;
  const second = window.confirm("请再次确认删除该指标。本操作不能从 Dashboard 恢复。");
  if (!second) return;
  const button = el("delete-metric-btn");
  setButtonBusy(button, true, "删除中");
  try {
    await deleteJson(`/api/metrics/${encodeURIComponent(metric.id)}`);
    state.selectedMetricId = "";
    await load({ keepChartState: true });
  } catch (error) {
    window.alert(`删除指标失败：${error.message}`);
    setButtonBusy(button, false);
  }
}

function zhChartType(type) {
  const map = { line: "折线图", bar: "柱状图", pie: "饼图", table: "表格", kpi: "KPI" };
  return map[type] || type;
}

function actionTypeLabel(type) {
  const map = {
    drill_down: "下钻分析请求",
    save_metric: "保存指标请求",
    knowledge_update_review: "知识库更新确认"
  };
  return map[type] || type || "待处理动作";
}

function latestRows(rows, key) {
  if (!key || !rows.length) {
    return rows;
  }
  const max = rows.map((row) => row[key]).sort().at(-1);
  return rows.filter((row) => row[key] === max);
}

function getChartSpec(session) {
  const charts = session?.chartSpec?.charts || [];
  const base = charts[state.selectedChart] || charts[0] || null;
  if (!base) {
    return null;
  }
  const normalized = {
    ...base,
    x: base.x || base.xField,
    y: base.y || base.yField,
    label: base.label || base.labelField || base.xField,
    value: base.value || base.valueField || base.yField
  };
  const overrides = state.chartOverrides[base.id || state.selectedChart] || {};
  if (base.type === "pie") {
    return { ...normalized, label: overrides.x || normalized.label, value: overrides.y || normalized.value };
  }
  return { ...normalized, x: overrides.x || normalized.x, y: overrides.y || normalized.y };
}

function chartSourceRows(session, spec) {
  if (Array.isArray(spec?.data) && spec.data.length) {
    return spec.data;
  }
  return session?.aggregate?.rows || [];
}

function seriesValues(rows, spec) {
  const key = spec?.series;
  if (!key) {
    return [];
  }
  return [...new Set(rows.map((row) => row[key]))].filter((value) => value !== undefined && value !== null);
}

function visibleRows(rows, spec) {
  const filter = spec?.filter || {};
  const filteredRows = Object.entries(filter).length
    ? rows.filter((row) => matchesFilter(row, filter))
    : rows;
  const hidden = new Set(state.hiddenSeries);
  if (!spec?.series || !hidden.size) {
    return filteredRows;
  }
  return filteredRows.filter((row) => !hidden.has(String(row[spec.series])));
}

function renderLegendControls(session, spec) {
  const rows = chartSourceRows(session, spec);
  const values = seriesValues(rows, spec);
  const yFields = !values.length && spec?.type === "line" ? chartYFields(spec) : [];
  const items = values.length
    ? values.map((value, index) => ({ value, label: value, colorIndex: index }))
    : yFields.map((field, index) => ({ value: field, label: fieldLabel(field, { short: true }), colorIndex: index }));
  if (!items.length) {
    el("legend-controls").innerHTML = "";
    return;
  }
  const hidden = new Set(state.hiddenSeries);
  el("legend-controls").innerHTML = items.map((item) => `
    <button class="legend-toggle ${hidden.has(String(item.value)) ? "off" : ""}" data-series-value="${escapeHtml(item.value)}">
      <span style="color:${colors[item.colorIndex % colors.length]}">■</span> ${escapeHtml(item.label)}
    </button>
  `).join("");
  document.querySelectorAll("[data-series-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.seriesValue;
      const next = new Set(state.hiddenSeries);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      state.hiddenSeries = [...next];
      renderChart(state.current);
    });
  });
}

function renderSessionMeta(session) {
  const metadata = session?.metadata || {};
  const updatedAt = metadata.updatedAt || metadata.createdAt || "";
  const items = [
    { label: "Session", value: session?.sessionId || "未选择" },
    { label: "查询源", value: metadata.providerId || "未知" },
    { label: "更新时间", value: updatedAt ? updatedAt.replace("T", " ").slice(0, 19) : "-" }
  ];
  el("session-meta").innerHTML = items.map((item) => `
    <span title="${escapeHtml(item.value)}"><b>${escapeHtml(item.label)}</b>${escapeHtml(compactLabel(item.value, 32))}</span>
  `).join("");
}

function chartScales(rows, xKey, yKey, width, height, pad) {
  const xValues = [...new Set(rows.map((row) => row[xKey]))];
  const yKeys = Array.isArray(yKey) ? yKey : [yKey];
  const yValues = rows
    .flatMap((row) => yKeys.map((key) => Number(row[key])))
    .filter((value) => Number.isFinite(value));
  const yMax = Math.max(...yValues, 1);
  const xStep = xValues.length > 1 ? (width - pad * 2) / (xValues.length - 1) : 0;
  const xPos = (value) => pad + xValues.indexOf(value) * xStep;
  const yPos = (value) => height - pad - (Number(value) / yMax) * (height - pad * 2);
  return { xValues, yMax, xPos, yPos };
}

function chartYFields(spec) {
  const value = spec?.type === "pie" ? spec.value : spec?.metric || spec?.y;
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function isNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  return Number.isFinite(Number(value));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chartTickValues(values, maxTicks = 9) {
  if (values.length <= maxTicks) {
    return new Set(values.map((_, index) => index));
  }
  const step = Math.ceil(values.length / maxTicks);
  const visible = new Set([0, values.length - 1]);
  values.forEach((_, index) => {
    if (index % step === 0) {
      visible.add(index);
    }
  });
  return visible;
}

function compactAxisLabel(value, dense = false) {
  const text = String(value ?? "");
  const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch && dense) {
    return `${dateMatch[2]}-${dateMatch[3]}`;
  }
  return compactLabel(text, dense ? 8 : 12);
}

function renderKpiChart(rows, spec) {
  const metric = spec.metric || spec.y || spec.value;
  const metricRow = rows.find((row) => isNumericValue(row?.[metric])) || rows[0] || {};
  const rawValue = spec.value ?? metricRow?.[metric] ?? 0;
  return `<div class="kpi-chart chart-mark" ${detailDataAttributes(metricRow, spec, { yKey: metric })}>
    <div>
      <div class="kpi-chart-label">${escapeHtml(spec.title || metric || "KPI")}</div>
      <div class="kpi-chart-value">${formatNumber(rawValue, spec.unit || "")}</div>
      ${spec.description ? `<div class="kpi-chart-desc">${escapeHtml(spec.description)}</div>` : ""}
    </div>
  </div>`;
}

function renderLineChart(rows, spec) {
  const width = 900;
  const height = 340;
  const pad = 48;
  const seriesKey = spec.series;
  const hidden = new Set(state.hiddenSeries);
  const allYFields = chartYFields(spec);
  const yFields = allYFields.filter((field) => !hidden.has(String(field)));
  const activeYFields = yFields.length ? yFields : chartYFields(spec);
  const { xValues, yMax, xPos, yPos } = chartScales(rows, spec.x, activeYFields, width, height, pad);
  const seriesItems = seriesKey
    ? [...new Set(rows.map((row) => row[seriesKey]))]
      .filter((value) => !hidden.has(String(value)))
      .map((value, index) => ({ label: value, yKey: activeYFields[0], seriesValue: value, colorIndex: index }))
    : activeYFields.map((field) => ({ label: fieldLabel(field, { short: true }), yKey: field, seriesValue: null, colorIndex: allYFields.indexOf(field) }));
  const paths = seriesItems.map((item) => {
    const points = rows
      .filter((row) => (seriesKey ? row[seriesKey] === item.seriesValue : true))
      .map((row) => {
        const value = Number(row[item.yKey]);
        return Number.isFinite(value) ? `${xPos(row[spec.x])},${yPos(value)}` : "";
      })
      .filter(Boolean)
      .join(" ");
    return `<polyline points="${points}" fill="none" stroke="${colors[item.colorIndex % colors.length]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />`;
  }).join("");
  const dots = seriesItems.flatMap((item) => rows
    .filter((row) => (seriesKey ? row[seriesKey] === item.seriesValue : true))
    .map((row) => {
      const value = Number(row[item.yKey]);
      if (!Number.isFinite(value)) return "";
      const label = seriesKey ? `${row[spec.x]} ${item.label}` : `${row[spec.x]} ${fieldLabel(item.yKey, { short: true })}`;
      return `<circle class="chart-mark" ${detailDataAttributes(row, spec, { yKey: item.yKey })} cx="${xPos(row[spec.x])}" cy="${yPos(value)}" r="5" fill="${colors[item.colorIndex % colors.length]}"><title>${escapeHtml(`${label}: ${value}${spec.unit || ""}`)}</title></circle>`;
    }))
    .filter(Boolean)
    .join("");
  const valueLabels = state.showChartValues ? seriesItems.flatMap((item) => rows
    .filter((row) => (seriesKey ? row[seriesKey] === item.seriesValue : true))
    .map((row) => {
      const value = Number(row[item.yKey]);
      if (!Number.isFinite(value)) return "";
      const x = xPos(row[spec.x]);
      const y = clampNumber(yPos(value) + (item.colorIndex % 2 ? 16 : -10), 14, height - pad - 8);
      const anchor = x <= pad + 2 ? "start" : x >= width - pad - 2 ? "end" : "middle";
      return `<text class="chart-value-label" x="${x}" y="${y}" text-anchor="${anchor}">${escapeHtml(formatNumber(value, spec.unit || ""))}</text>`;
    }))
    .filter(Boolean)
    .join("") : "";
  const tickIndexes = chartTickValues(xValues, 9);
  const denseAxis = xValues.length > 12;
  const labels = xValues.map((value, index) => {
    if (!tickIndexes.has(index)) {
      return "";
    }
    const anchor = index === 0 ? "start" : index === xValues.length - 1 ? "end" : "middle";
    const label = compactAxisLabel(value, denseAxis);
    const rotation = denseAxis && index !== 0 && index !== xValues.length - 1 ? ` transform="rotate(-28 ${xPos(value)} ${height - 13})"` : "";
    return `<text x="${xPos(value)}" y="${height - 13}" text-anchor="${anchor}"${rotation}><title>${escapeHtml(value)}</title>${escapeHtml(label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(spec.title || "折线图")}">
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#d8d3c9" />
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#d8d3c9" />
    <text x="${pad}" y="${pad - 14}">${formatNumber(yMax, spec.unit || "")}</text>
    ${paths}
    ${dots}
    ${valueLabels}
    <g class="axis">${labels}</g>
  </svg>`;
}

function renderBarChart(rows, spec) {
  const data = latestRows(rows, spec.filterLatestBy);
  const width = 900;
  const height = 340;
  const pad = 42;
  const bottomPad = 82;
  const yMax = Math.max(...data.map((row) => Number(row[spec.y]) || 0), 1);
  const step = (width - pad * 2) / Math.max(data.length, 1);
  const barWidth = Math.max(20, step - 18);
  const bars = data.map((row, index) => {
    const value = Number(row[spec.y]) || 0;
    const x = pad + index * step + 9;
    const h = (value / yMax) * (height - pad - bottomPad);
    const y = height - bottomPad - h;
    const label = String(row[spec.x] ?? "");
    const labelX = x + barWidth / 2;
    const labelY = height - bottomPad + 16;
    const valueLabel = state.showChartValues
      ? `<text class="chart-value-label" x="${x + barWidth / 2}" y="${Math.max(18, y - 7)}" text-anchor="middle">${escapeHtml(formatNumber(value, spec.unit || ""))}</text>`
      : "";
    return `<g>
      <rect class="chart-mark" ${detailDataAttributes(row, spec)} x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="3" fill="${colors[index % colors.length]}"><title>${escapeHtml(`${row[spec.x]}: ${value}${spec.unit || ""}`)}</title></rect>
      <text x="${labelX}" y="${labelY}" text-anchor="end" transform="rotate(-34 ${labelX} ${labelY})"><title>${escapeHtml(label)}</title>${escapeHtml(compactLabel(label, 9))}</text>
      ${valueLabel}
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img">
    <line x1="${pad}" y1="${height - bottomPad}" x2="${width - pad}" y2="${height - bottomPad}" stroke="#d8d3c9" />
    ${bars}
  </svg>`;
}

function renderPieChart(rows, spec) {
  const data = latestRows(rows, spec.filterLatestBy);
  const total = data.reduce((sum, row) => sum + (Number(row[spec.value]) || 0), 0) || 1;
  let start = -Math.PI / 2;
  const cx = 220;
  const cy = 160;
  const r = 110;
  const slices = data.map((row, index) => {
    const value = Number(row[spec.value]) || 0;
    const angle = (value / total) * Math.PI * 2;
    const end = start + angle;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const mid = start + angle / 2;
    const labelX = cx + r * 0.62 * Math.cos(mid);
    const labelY = cy + r * 0.62 * Math.sin(mid);
    const large = angle > Math.PI ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    start = end;
    const valueLabel = state.showChartValues && angle > 0.22
      ? `<text class="chart-value-label pie-label" x="${labelX}" y="${labelY}" text-anchor="middle">${escapeHtml(formatNumber(value, spec.unit || ""))}</text>`
      : "";
    return `<path class="chart-mark" ${detailDataAttributes(row, spec)} d="${path}" fill="${colors[index % colors.length]}"><title>${escapeHtml(`${row[spec.label]}: ${value}`)}</title></path>${valueLabel}`;
  }).join("");
  const legend = data.map((row, index) => `<g transform="translate(420,${80 + index * 30})"><rect width="12" height="12" fill="${colors[index % colors.length]}"></rect><text x="20" y="11">${escapeHtml(row[spec.label])}: ${formatNumber(row[spec.value])}</text></g>`).join("");
  return `<svg viewBox="0 0 900 320" role="img">${slices}${legend}</svg>`;
}

function visibleValuePairs(row, spec) {
  const preferred = [
    spec?.type === "pie" ? spec.label : spec?.x,
    spec?.series,
    ...chartYFields(spec),
    "users",
    "resources",
    "pc_audio_source_users",
    "pc_audio_source_resources",
    "user_ratio_pct",
    "pc_audio_source_user_ratio_pct",
    "pc_active_users_30d",
    "pc_users_with_deleted_audio_in_trash",
    "deleted_audio_resources",
    "pc_users_with_audio_in_current_trash",
    "current_trash_audio_resources"
  ].filter(Boolean);
  const columns = [...new Set(preferred)]
    .filter((column) => hasCellValue(row?.[column]))
    .slice(0, 8);
  return columns.map((column) => ({
    label: fieldLabel(column, { short: true }),
    value: row[column]
  }));
}

function renderChartPopover(popover, spec) {
  const target = el("chart-popover");
  if (!target) return;
  if (!popover) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const pairs = visibleValuePairs(popover.row || {}, spec);
  target.hidden = false;
  target.classList.toggle("below", popover.placement === "below");
  target.style.left = `${popover.x}px`;
  target.style.top = `${popover.y}px`;
  target.innerHTML = `
    <div class="chart-popover-head">
      <strong>${escapeHtml(popover.label || rowTypeLabel(popover.rowType))}</strong>
      <button id="chart-popover-close" type="button" aria-label="关闭浮窗">×</button>
    </div>
    <dl>
      ${pairs.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")}
    </dl>
  `;
  el("chart-popover-close")?.addEventListener("click", () => {
    state.chartPopover = null;
    renderChartPopover(null, spec);
  });
}

function bindChartDetailClicks(spec) {
  document.querySelectorAll("[data-chart-detail]").forEach((mark) => {
    const showDetail = (event) => {
      let filters = [];
      let row = {};
      try {
        filters = JSON.parse(mark.dataset.detailFilters || "[]");
      } catch {
        filters = [];
      }
      try {
        row = JSON.parse(mark.dataset.detailRow || "{}");
      } catch {
        row = {};
      }
      const area = document.querySelector(".chart-area");
      const areaRect = area?.getBoundingClientRect();
      const markRect = mark.getBoundingClientRect();
      const clientX = event?.clientX ?? markRect.left + markRect.width / 2;
      const clientY = event?.clientY ?? markRect.top + markRect.height / 2;
      const rawX = areaRect ? clientX - areaRect.left : 0;
      const rawY = areaRect ? clientY - areaRect.top : 0;
      const x = Math.max(132, Math.min(rawX, (areaRect?.width || 264) - 132));
      const placement = rawY < 118 ? "below" : "above";
      const y = placement === "below" ? rawY + 16 : rawY - 12;
      state.chartPopover = {
        rowType: mark.dataset.rowType || spec?.filter?.row_type || "",
        filters,
        label: mark.dataset.detailLabel || "",
        row,
        x,
        y,
        placement
      };
      renderChartPopover(state.chartPopover, spec);
    };
    mark.addEventListener("click", showDetail);
    mark.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showDetail(event);
      }
    });
  });
}

function renderChart(session) {
  const spec = getChartSpec(session);
  const rows = visibleRows(chartSourceRows(session, spec), spec);
  if (!spec || !rows.length) {
    el("chart-title").textContent = "";
    el("legend-controls").innerHTML = "";
    el("chart").innerHTML = `<div class="empty">暂无图表数据</div>`;
    state.chartPopover = null;
    renderChartPopover(null, spec);
    return;
  }
  el("chart-title").textContent = spec.title || "图表";
  renderLegendControls(session, spec);
  state.chartPopover = null;
  renderChartPopover(null, spec);
  if (spec.type === "kpi") {
    el("chart").innerHTML = renderKpiChart(rows, spec);
  } else if (spec.type === "bar") {
    el("chart").innerHTML = renderBarChart(rows, spec);
  } else if (spec.type === "pie") {
    el("chart").innerHTML = renderPieChart(rows, spec);
  } else {
    el("chart").innerHTML = renderLineChart(rows, spec);
  }
  bindChartDetailClicks(spec);
}

function renderFieldControls(session) {
  const spec = getChartSpec(session);
  const sourceRows = chartSourceRows(session, spec).length ? chartSourceRows(session, spec) : (session?.preview?.rows || []);
  const allColumns = columnKeys(session?.aggregate?.columns || session?.preview?.columns || [], sourceRows);
  const rows = visibleRows(sourceRows, spec);
  const columns = columnsWithValues(allColumns, rows.length ? rows : sourceRows).filter((column) => column !== "row_type");
  if (!columns.length || !spec) {
    el("dimension-select").innerHTML = "";
    el("metric-select").innerHTML = "";
    return;
  }
  const numericColumns = columns.filter((column) => rows.some((row) => isNumericValue(row[column])));
  const dimensionColumns = columns.filter((column) => !numericColumns.includes(column));
  const xValue = spec.type === "pie" ? spec.label : spec.x;
  const rawYValue = spec.type === "kpi" ? spec.metric : spec.type === "pie" ? spec.value : spec.y;
  const yValue = Array.isArray(rawYValue) ? rawYValue[0] : rawYValue;
  el("dimension-select").innerHTML = (dimensionColumns.length ? dimensionColumns : columns).map((column) => `<option value="${escapeHtml(column)}" ${column === xValue ? "selected" : ""}>${escapeHtml(fieldLabel(column))}</option>`).join("");
  el("metric-select").innerHTML = (numericColumns.length ? numericColumns : columns).map((column) => `<option value="${escapeHtml(column)}" ${column === yValue ? "selected" : ""}>${escapeHtml(fieldLabel(column))}</option>`).join("");
}

function renderTabs(session) {
  const charts = session?.chartSpec?.charts || [];
  el("chart-tabs").innerHTML = charts.map((chart, index) => `
    <button class="tab ${index === state.selectedChart ? "active" : ""}" data-chart-index="${index}">
      ${escapeHtml(zhChartType(chart.type))} · ${escapeHtml(chart.title || chart.id)}
    </button>
  `).join("");
  document.querySelectorAll("[data-chart-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChart = Number(button.dataset.chartIndex);
      const chart = (state.current?.chartSpec?.charts || [])[state.selectedChart];
      if (typeof chart?.filter?.row_type === "string") {
        state.selectedPreviewGroup = chart.filter.row_type;
      }
      state.chartDetail = null;
      state.chartPopover = null;
      state.tableRenderSignature = "";
      renderTabs(state.current);
      renderFieldControls(state.current);
      renderChart(state.current);
      renderTable(state.current, { preserveScroll: false });
    });
  });
}

function sortRows(rows, columns) {
  const column = state.tableSort.column || columns[0];
  if (!column) {
    return rows;
  }
  const direction = state.tableSort.direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = left[column];
    const b = right[column];
    const numeric = !Number.isNaN(Number(a)) && !Number.isNaN(Number(b));
    if (numeric) {
      return (Number(a) - Number(b)) * direction;
    }
    return String(a ?? "").localeCompare(String(b ?? ""), "zh-CN") * direction;
  });
}

function previewTableScroll() {
  const table = el("preview-table");
  return {
    sessionId: table?.dataset.sessionId || "",
    top: table?.scrollTop || 0,
    left: table?.scrollLeft || 0
  };
}

function hashRows(rows, columns) {
  let hash = 5381;
  rows.forEach((row) => {
    columns.forEach((column) => {
      const text = String(row?.[column] ?? "");
      for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
      }
      hash = ((hash << 5) + hash + 31) >>> 0;
    });
  });
  return hash.toString(36);
}

function tableRenderSignature(session, columns, rows) {
  return [
    session?.sessionId || "",
    state.tableSort.column || "",
    state.tableSort.direction || "",
    state.selectedPreviewGroup || "",
    JSON.stringify(state.chartDetail || {}),
    columns.join("\u001f"),
    rows.length,
    hashRows(rows, columns)
  ].join("\u001e");
}

function tableHtml(columns, rows) {
  return `<table>
    <thead><tr>${columns.map((column) => `<th><button data-sort-column="${escapeHtml(column)}">${escapeHtml(fieldLabel(column))}${state.tableSort.column === column ? (state.tableSort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function previewGroupsForRows(columns, rows) {
  const groupOrder = [];
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(row?.row_type || "ungrouped");
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(row);
  });
  return groupOrder.map((key) => ({
    key,
    label: rowTypeLabel(key),
    rows: groups.get(key),
    columns: columnsWithValues(columns, groups.get(key), { exclude: ["row_type"] })
  }));
}

function renderPreviewTabs(groups, activeKey) {
  const tabs = el("preview-tabs");
  if (!tabs) return;
  if (groups.length <= 1) {
    tabs.innerHTML = "";
    return;
  }
  tabs.innerHTML = groups.map((group) => `
    <button class="preview-tab ${group.key === activeKey ? "active" : ""}" data-preview-group="${escapeHtml(group.key)}">
      ${escapeHtml(group.label)}
      <span>${group.rows.length}</span>
    </button>
  `).join("");
  document.querySelectorAll("[data-preview-group]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPreviewGroup = button.dataset.previewGroup || "";
      state.chartDetail = null;
      state.tableRenderSignature = "";
      renderTable(state.current, { preserveScroll: false });
    });
  });
}

function rowsForChartDetail(rows, groupKey) {
  const detail = state.chartDetail;
  if (!detail || detail.rowType !== groupKey || !detail.filters?.length) {
    return rows;
  }
  return rows.filter((row) => detail.filters.every((item) => String(row?.[item.column] ?? "") === String(item.value ?? "")));
}

function renderChartDetail(groupKey, shownRows, totalRows) {
  const detail = state.chartDetail;
  const target = el("chart-detail");
  if (!target) return;
  if (!detail || detail.rowType !== groupKey) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  target.hidden = false;
  target.innerHTML = `
    <span>图表选中：${escapeHtml(detail.label || detailFilterLabel(detail.filters))}</span>
    <b>${shownRows.length} / ${totalRows} 行</b>
    <button id="clear-chart-detail" class="link-button">查看全部</button>
  `;
  el("clear-chart-detail")?.addEventListener("click", () => {
    state.chartDetail = null;
    state.tableRenderSignature = "";
    renderTable(state.current, { preserveScroll: false });
  });
}

function renderTable(session, options = {}) {
  const preview = session?.preview || {};
  const columns = preview.columns || [];
  const rawRows = preview.rows || [];
  const rowTypes = new Set(rawRows.map((row) => row?.row_type).filter(Boolean));
  const rows = rowTypes.size > 1 ? rawRows : sortRows(rawRows, columns);
  const groups = previewGroupsForRows(columns, rows);
  if (groups.length && !groups.some((group) => group.key === state.selectedPreviewGroup)) {
    const spec = getChartSpec(session);
    const preferredGroup = typeof spec?.filter?.row_type === "string" ? spec.filter.row_type : "";
    state.selectedPreviewGroup = groups.some((group) => group.key === preferredGroup) ? preferredGroup : groups[0].key;
  }
  const activeGroup = groups.find((group) => group.key === state.selectedPreviewGroup) || groups[0] || null;
  const activeRows = activeGroup ? rowsForChartDetail(sortRows(activeGroup.rows, columns), activeGroup.key) : rows;
  const activeColumns = activeGroup ? activeGroup.columns : columnsWithValues(columns, rows);
  const table = el("preview-table");
  const signature = tableRenderSignature(session, activeColumns, activeRows);
  const preserveScroll = options.preserveScroll !== false;
  const scrollTop = preserveScroll ? (options.scrollTop ?? table.scrollTop) : 0;
  const scrollLeft = preserveScroll ? (options.scrollLeft ?? table.scrollLeft) : 0;
  const filteredCount = activeRows.length !== (activeGroup?.rows.length || rows.length) ? ` · 当前 ${activeRows.length} 行` : "";
  el("row-count").textContent = rowTypes.size > 1 ? `${rows.length} 行 · ${groups.length} 个结果块${filteredCount}` : `${rows.length} 行`;
  if (signature === state.tableRenderSignature && table.dataset.renderSignature === signature) {
    return;
  }
  state.tableRenderSignature = signature;
  table.dataset.renderSignature = signature;
  table.dataset.sessionId = session?.sessionId || "";
  if (!columns.length) {
    el("preview-tabs").innerHTML = "";
    const detail = el("chart-detail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
    table.innerHTML = `<div class="empty">暂无预览数据</div>`;
    table.scrollTop = 0;
    table.scrollLeft = 0;
    return;
  }
  renderPreviewTabs(groups, activeGroup?.key || "");
  renderChartDetail(activeGroup?.key || "", activeRows, activeGroup?.rows.length || rows.length);
  table.innerHTML = activeColumns.length ? tableHtml(activeColumns, activeRows) : `<div class="empty">暂无可展示字段</div>`;
  table.scrollTop = scrollTop;
  table.scrollLeft = scrollLeft;
  window.requestAnimationFrame(() => {
    table.scrollTop = scrollTop;
    table.scrollLeft = scrollLeft;
  });
  document.querySelectorAll("[data-sort-column]").forEach((button) => {
    button.addEventListener("click", () => {
      const column = button.dataset.sortColumn;
      state.tableSort = {
        column,
        direction: state.tableSort.column === column && state.tableSort.direction === "asc" ? "desc" : "asc"
      };
      renderTable(state.current, { preserveScroll: false });
    });
  });
}

async function openSession(sessionId) {
  if (!sessionId) {
    return;
  }
  const data = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  state.current = data.session;
  state.viewedSessionId = data.session.sessionId;
  state.selectedChart = 0;
  state.hiddenSeries = [];
  state.chartOverrides = {};
  state.selectedPreviewGroup = "";
  state.chartDetail = null;
  state.chartPopover = null;
  state.tableRenderSignature = "";
  render();
}

async function requestMetricSave(session) {
  if (!session?.sessionId) {
    window.alert("暂无可保存的查询结果");
    return;
  }
  const button = el("metric-save-btn");
  if (button) {
    button.disabled = true;
    button.textContent = "保存中";
  }
  const summary = session.aggregate?.summary || {};
  const defaultMetricId = String(summary.primaryMetric || session.metadata?.metrics?.[0] || "metric")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "metric";
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/save-metric`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        metricId: defaultMetricId,
        metricName: summary.primaryMetric || session.metadata?.question || "待命名指标"
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "请求失败");
    }
    window.alert(`已保存到指标库：${payload.result.id}`);
    const refreshed = await fetchJson(`/api/sessions/${encodeURIComponent(session.sessionId)}`);
    const metrics = await fetchJson("/api/metrics");
    state.current = refreshed.session;
    state.metrics = metrics.metrics || [];
    state.selectedMetricId = payload.result.id;
    state.sidebarPanel = "metrics";
    render();
  } catch (error) {
    window.alert(`保存请求失败：${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "保存指标";
    }
  }
}

function providerById(providerId) {
  const catalogProvider = (state.catalog.queryCapabilities?.providers || []).find((provider) => provider.id === providerId);
  const registryProvider = (state.providerItems || []).find((provider) => provider.id === providerId);
  if (catalogProvider && registryProvider) {
    return mergeProviderRecords([{ ...catalogProvider, raw: catalogProvider.raw }, { ...registryProvider, raw: registryProvider.raw || catalogProvider.raw }])[0];
  }
  return catalogProvider || registryProvider || null;
}

function fieldsByNames(fieldNames = []) {
  const wanted = new Set(fieldNames);
  return (state.catalog.fieldLineage?.fields || []).filter((field) => wanted.has(field.field));
}

function fieldByName(fieldName) {
  return (state.catalog.fieldLineage?.fields || []).find((field) => field.field === fieldName) || null;
}

function fieldMeaning(field) {
  return (field?.meanings || []).filter(Boolean)[0] || field?.meaning || "待 Agent 根据代码上下文补充";
}

function selectedMetric() {
  if (state.metricSource === "shared") {
    return selectedSharedMetric();
  }
  if (!state.selectedMetricId && state.metrics.length) {
    state.selectedMetricId = state.metrics[0].id;
  }
  return state.metrics.find((metric) => metric.id === state.selectedMetricId) || state.metrics[0] || null;
}

function selectedSharedMetric() {
  const records = state.sharedMetrics.records || [];
  if (!state.selectedSharedMetricId && records.length) {
    state.selectedSharedMetricId = records[0].id || records[0].recordId;
  }
  return records.find((metric) => metric.id === state.selectedSharedMetricId || metric.recordId === state.selectedSharedMetricId) || records[0] || null;
}

function metricById(metricId) {
  return state.metrics.find((metric) => metric.id === metricId) || null;
}

function renderMetricCalculationSummary(session) {
  const confirmation = session?.confirmation || {};
  const queryPlan = typeof session?.queryPlan === "object" && session?.queryPlan ? session.queryPlan : {};
  const metricIds = [
    ...(confirmation.metrics || []),
    ...(session?.metadata?.metrics || []),
    ...(Array.isArray(queryPlan.metrics) ? queryPlan.metrics : [])
  ].filter(Boolean);
  const uniqueMetricIds = [...new Set(metricIds)];
  const savedMetrics = uniqueMetricIds.map(metricById).filter(Boolean);
  const primaryMetric = savedMetrics[0] || null;
  const metricIntent = confirmation.metricIntent || queryPlan.metricIntent || {};
  const fallbackPolicy = confirmation.fallbackPolicy || queryPlan.fallbackPolicy || "";
  const actualExecution = queryPlan.actualExecution || session?.providerExecution?.note || "";
  const rows = [
    { label: "指标", value: savedMetrics.length ? savedMetrics.map((metric) => `${metric.name || metric.id} (${metric.id})`) : uniqueMetricIds },
    { label: "指标状态", value: savedMetrics.map((metric) => `${metric.id}: ${metric.status}`) },
    { label: "业务对象", value: metricIntent.businessObject || metricIntent.business_object },
    { label: "衡量目标", value: metricIntent.measurementGoal || metricIntent.measurement_goal },
    { label: "指标定义", value: primaryMetric?.definition || confirmation.metricDefinition || queryPlan.metricDefinition || queryPlan.calculationLogic },
    { label: "计算口径", value: confirmation.calculationLogic || primaryMetric?.description || queryPlan.calculationLogic },
    { label: "统计粒度", value: primaryMetric?.grain || metricIntent.statisticalUnit || metricIntent.statistical_unit },
    { label: "时间口径", value: primaryMetric?.timeField || confirmation.timeField || queryPlan.timeField || queryPlan.timeFields },
    { label: "时间范围", value: confirmation.timeRange || queryPlan.timeRange },
    { label: "维度", value: primaryMetric?.dimensions?.length ? primaryMetric.dimensions : (confirmation.dimensions || queryPlan.dimensions) },
    { label: "过滤条件", value: confirmation.filters || queryPlan.filters },
    { label: "去重规则", value: confirmation.dedupLogic || queryPlan.dedupLogic },
    { label: "分子逻辑", value: primaryMetric?.numerator },
    { label: "分母逻辑", value: primaryMetric?.denominator },
    { label: "候选/降级规则", value: fallbackPolicy },
    { label: "实际执行口径", value: actualExecution }
  ].filter((row) => {
    if (Array.isArray(row.value)) return row.value.length;
    return row.value !== undefined && row.value !== null && row.value !== "";
  });
  if (!rows.length) {
    return `<div class="empty small-empty">暂无指标计算口径。请在 Agent 对话中确认并保存指标定义。</div>`;
  }
  const rawMetricPlan = session?.metricPlan
    ? `<details class="inline-detail" data-detail-key="history:metric-plan:raw"><summary>原始 metric-plan.yaml</summary><pre>${escapeHtml(session.metricPlan)}</pre></details>`
    : "";
  return `<div class="metric-summary">${readableDetailRows(rows)}${rawMetricPlan}</div>`;
}

function selectedProvider() {
  if (!state.selectedProviderId && state.providerItems.length) {
    state.selectedProviderId = state.providerItems[0].id;
  }
  return providerById(state.selectedProviderId) || state.providerItems[0] || null;
}

function backendProjects() {
  const catalogProjects = state.catalog.services?.backendProjects || [];
  if (catalogProjects.length) {
    return catalogProjects.map((project) => ({
      id: project.domain || project.repoPath || project.repoUrl,
      domain: project.domain || "未命名知识库",
      repo: project.repoPath || project.repoUrl || "",
      status: project.status || "registered",
      latestScan: project.latestScan || "",
      latestFieldMapping: project.latestFieldMapping || "",
      providerId: project.providerId || "",
      fields: project.fields || [],
      codeFacts: project.codeFacts || null,
      raw: project
    }));
  }
  const projectMatches = [...String(state.backend.raw || "").matchAll(/domain:\s*(.+)|repo_url:\s*(.+)|repo_path:\s*(.+)|status:\s*(.+)/g)];
  const rows = [];
  let currentProject = null;
  for (const match of projectMatches) {
    if (match[1]) {
      currentProject = { id: match[1].trim(), domain: match[1].trim(), repo: "", status: "", fields: [] };
      rows.push(currentProject);
    } else if (currentProject && match[2]) {
      currentProject.repo = match[2].trim();
    } else if (currentProject && match[3]) {
      currentProject.repo = match[3].trim();
    } else if (currentProject && match[4] && !currentProject.status) {
      currentProject.status = match[4].trim();
    }
  }
  return rows;
}

function selectedBackendProject() {
  const projects = backendProjects();
  if (!state.selectedBackendId && projects.length) {
    state.selectedBackendId = projects[0].id;
  }
  return projects.find((project) => project.id === state.selectedBackendId) || projects[0] || null;
}

function knowledgeFieldsFor(project) {
  const fields = state.catalog.fieldLineage?.fields || [];
  if (!project) {
    return fields;
  }
  const projectFieldNames = new Set((project.fields || []).map((field) => field.field || field).filter(Boolean));
  const domain = project.domain || project.id;
  return fields
    .filter((field) => (field.domains || []).includes(domain) || projectFieldNames.has(field.field))
    .sort((left, right) => String(left.field).localeCompare(String(right.field), "zh-CN"));
}

function selectedKnowledgeField(project) {
  const fields = knowledgeFieldsFor(project);
  if (!fields.length) {
    state.selectedKnowledgeFieldId = "";
    return null;
  }
  const selected = fields.find((field) => field.field === state.selectedKnowledgeFieldId);
  if (selected) {
    return selected;
  }
  state.selectedKnowledgeFieldId = fields[0].field;
  return fields[0];
}

function renderProviderCapabilityDetail(provider) {
  if (!provider) {
    return `<div class="empty small-empty">请选择一个查询源能力</div>`;
  }
  const tools = provider.toolSchemas?.length
    ? provider.toolSchemas.map((tool) => tool.tool)
    : (provider.toolNames?.length ? provider.toolNames : [provider.toolName].filter(Boolean));
  return `
    <section class="detail-panel">
      <div class="detail-head">
        <div>
          <div class="eyebrow">查询源能力</div>
          <h3>${escapeHtml(provider.displayName || provider.id)}</h3>
        </div>
        <span class="status-pill subtle">${escapeHtml(zhStatus(provider.status) || provider.status || "未知")}</span>
      </div>
      ${detailRows([
        { label: "Provider ID", value: provider.id },
        { label: "类型", value: provider.type },
        { label: "MCP 服务", value: provider.mcpServerHint },
        { label: "Skill 入口", value: provider.skillEntrypoint },
        { label: "输入 Schema", value: provider.inputSchemaRef },
        { label: "输出 Schema", value: provider.outputSchemaRef }
      ])}
      <div class="detail-section"><h4>可查询范围</h4>${tags(provider.queryScope || provider.capabilities || provider.routingKeywords, "未登记能力标签")}</div>
      <div class="detail-section"><h4>已知库表和字段线索</h4>${tags(provider.knownData || [], "能力索引暂未登记具体库表；Agent 执行前需要先做 schema/代码证据确认。")}</div>
      <div class="detail-section"><h4>路由说明</h4><p class="detail-copy">${escapeHtml(provider.routingGuide || provider.description || "仅根据 registry 和能力索引选择查询源；执行前仍需 Agent 和用户确认指标、数据源、口径和风险。")}</p></div>
      <div class="detail-section"><h4>工具</h4>${tools.length ? tags(tools) : `<div class="meta">未登记工具名</div>`}</div>
      <div class="detail-section"><h4>限制说明</h4>${tags(provider.limitations || [], "未登记额外限制")}</div>
      <div class="detail-section"><h4>限制和安全策略</h4><pre>${escapeHtml(JSON.stringify(provider.safetyPolicy || {}, null, 2))}</pre></div>
    </section>
  `;
}

function renderKnowledgeFieldDetail(field) {
  if (!field) {
    return `<div class="empty small-empty">请选择一个字段</div>`;
  }
  return `
    <section class="detail-panel">
      <div class="detail-head">
        <div>
          <div class="eyebrow">字段字典</div>
          <h3>${escapeHtml(field.field)}</h3>
        </div>
        <span class="status-pill subtle">${escapeHtml(field.sensitivity || "normal")}</span>
      </div>
      ${detailRows([
        { label: "领域 / 服务", value: field.domains },
        { label: "可查询状态", value: field.queryable },
        { label: "建议查询源", value: field.providerHints },
        { label: "来源类型", value: field.sourceKinds },
        { label: "所属表 / 类 / 映射", value: field.owners },
        { label: "数据类型", value: field.dataTypes },
        { label: "字段含义", value: field.meanings?.length ? field.meanings : field.meaning },
        { label: "证据文件", value: field.evidence }
      ])}
      <div class="detail-section">
        <h4>使用说明</h4>
        <p class="detail-copy">字段字典来自后端仓库、建表 SQL、实体/DTO/Mapper 和字段映射扫描，用于帮助 Agent 定位计算口径、存储位置和查询设计。指标执行前仍需要在 Agent 对话里确认口径和数据源。</p>
      </div>
    </section>
  `;
}

function renderMetricCandidateDetail(metric) {
  if (!metric) {
    return `<div class="empty small-empty">请选择一个指标候选</div>`;
  }
  const relatedFields = fieldsByNames(metric.requiredFields || []);
  return `
    <section class="detail-panel">
      <div class="detail-head">
        <div>
          <div class="eyebrow">指标候选</div>
          <h3>${escapeHtml(metric.name || metric.metricId)}</h3>
        </div>
        <span class="status-pill subtle">${escapeHtml(metric.grain || "unknown")}</span>
      </div>
      ${detailRows([
        { label: "Metric ID", value: metric.metricId },
        { label: "粒度", value: metric.grain },
        { label: "需要字段", value: metric.requiredFields },
        { label: "建议查询源", value: metric.providerHints },
        { label: "风险", value: metric.risks }
      ])}
      <div class="detail-section"><h4>字段线索</h4>${relatedFields.length ? relatedFields.map((field) => `
        <button class="mini-link" data-show-field="${escapeHtml(field.field)}" data-field-domain="${escapeHtml((field.domains || [])[0] || "")}">${escapeHtml(field.field)} · ${escapeHtml(fieldMeaning(field))}</button>
      `).join("") : `<div class="meta">能力索引里暂未找到对应字段详情</div>`}</div>
    </section>
  `;
}

function renderCatalogDetail() {
  const selected = state.selectedCatalog || {};
  const providers = canonicalProviders(state.catalog.queryCapabilities?.providers || []);
  const metrics = state.catalog.metricCandidates?.metrics || [];
  if (selected.type === "metric") {
    return renderMetricCandidateDetail(metrics.find((metric) => metric.metricId === selected.id));
  }
  if (selected.type !== "provider") {
    state.selectedCatalog = { type: "provider", id: providers[0]?.id || "" };
    return renderProviderCapabilityDetail(providers[0]);
  }
  if (selected.id) {
    const provider = providerById(selected.id);
    if (provider) {
      return renderProviderCapabilityDetail(provider);
    }
    state.selectedCatalog = { type: "provider", id: providers[0]?.id || "" };
    return renderProviderCapabilityDetail(providers[0]);
  }
  return renderProviderCapabilityDetail(providers[0]);
}

function renderMetricDetail(metric) {
  if (!metric) {
    return `<div class="empty small-empty">请选择一个指标</div>`;
  }
  const candidate = (state.catalog.metricCandidates?.metrics || []).find((item) => item.metricId === metric.id);
  const candidateFields = fieldsByNames(candidate?.requiredFields || []);
  const providers = metric.relatedProviders?.length
    ? metric.relatedProviders
    : (candidate?.providerHints || []).map(providerById).filter(Boolean);
  return `
    <section class="detail-panel">
      <div class="detail-head">
        <div>
          <div class="eyebrow">指标详情</div>
          <h3>${escapeHtml(metric.name || metric.id)}</h3>
        </div>
        <span class="status-pill subtle">${escapeHtml(metric.status || "unknown")}</span>
      </div>
      ${detailRows([
        { label: "Metric ID", value: metric.id },
        { label: "定义", value: metric.definition || metric.description },
        { label: "粒度", value: metric.grain || candidate?.grain },
        { label: "时间字段", value: metric.timeField },
        { label: "分子逻辑", value: metric.numerator },
        { label: "分母逻辑", value: metric.denominator },
        { label: "维度", value: metric.dimensions },
        { label: "来源表 / 产物", value: metric.sourceTables },
        { label: "知识库证据", value: metric.backendEvidence },
        { label: "校验状态", value: metric.validation }
      ])}
      <div class="detail-section">
        <h4>关联查询会话</h4>
        ${(metric.relatedSessions || []).length ? metric.relatedSessions.map((session) => `
          <button class="mini-link" data-open-session="${escapeHtml(session.sessionId)}">${escapeHtml(session.sessionId)} · ${escapeHtml(zhStatus(session.status))} · ${escapeHtml(session.providerId || "查询源")}</button>
        `).join("") : `<div class="meta">暂无关联查询会话</div>`}
      </div>
      <div class="detail-section">
        <h4>关联数据源</h4>
        ${providers.length ? providers.map((provider) => `
          <button class="mini-link" data-show-provider="${escapeHtml(provider.id)}">${escapeHtml(provider.displayName || provider.id)} · ${escapeHtml(provider.type || "")}</button>
        `).join("") : `<div class="meta">暂无关联数据源</div>`}
      </div>
      <div class="detail-section">
        <h4>关联字段</h4>
        ${candidateFields.length ? candidateFields.map((field) => `
          <button class="mini-link" data-show-field="${escapeHtml(field.field)}" data-field-domain="${escapeHtml((field.domains || [])[0] || "")}">${escapeHtml(field.field)} · ${escapeHtml(fieldMeaning(field))}</button>
        `).join("") : `<div class="meta">暂无字段血缘详情</div>`}
      </div>
      ${metric.notes?.length ? `<div class="detail-section"><h4>说明</h4>${tags(metric.notes)}</div>` : ""}
    </section>
  `;
}

function renderSharedMetricDetail(metric) {
  if (!metric) {
    return `<div class="empty small-empty">暂无共享指标。请先配置共享目标并刷新共享指标库。</div>`;
  }
  return `
    <section class="detail-panel">
      <div class="detail-head">
        <div>
          <div class="eyebrow">共享指标详情</div>
          <h3>${escapeHtml(metric.name || metric.id)}</h3>
        </div>
        <span class="status-pill subtle">${escapeHtml(metric.shareStatus || metric.status || "shared")}</span>
      </div>
      ${detailRows([
        { label: "Metric ID", value: metric.id },
        { label: "定义", value: metric.definition },
        { label: "粒度", value: metric.grain },
        { label: "时间字段", value: metric.timeField },
        { label: "维度", value: metric.dimensions },
        { label: "来源表 / 产物", value: metric.sourceTables },
        { label: "字段含义", value: metric.fieldMeanings },
        { label: "关联 session", value: metric.relatedSessions },
        { label: "实际执行SQL", value: metric.actualSql },
        { label: "共享人", value: metric.sharedBy },
        { label: "共享时间", value: metric.sharedAt },
        { label: "来源工作区", value: metric.sourceWorkspace },
        { label: "Record ID", value: metric.recordId }
      ])}
      <div class="detail-section">
        <button id="copy-shared-metric-btn" class="icon-button">复制到本地</button>
      </div>
    </section>
  `;
}

function renderHistoryView(session) {
  const shareAction = latestShareAction(session?.shareActions || []);
  const sharing = Boolean(runningShareAction(session?.shareActions || []));
  const tableScroll = previewTableScroll();
  const sameSessionTable = tableScroll.sessionId && tableScroll.sessionId === session?.sessionId;
  el("content").innerHTML = historyContentTemplate();
  el("audit-panel").innerHTML = historyAuditTemplate();
  el("session-title").textContent = session?.metadata?.question || session?.sessionId || "当前分析";
  el("status-pill").textContent = zhStatus(session?.metadata?.status) || "就绪";
  renderSessionMeta(session);
  renderTabs(session);
  renderFieldControls(session);
  bindChartValueToggle();
  renderChart(session);
  renderTable(session, {
    scrollTop: sameSessionTable ? tableScroll.top : 0,
    scrollLeft: sameSessionTable ? tableScroll.left : 0
  });
  el("share-progress-slot").innerHTML = renderShareProgress(shareAction);
  renderAudit(session);
  renderLineage(session);
  renderActions(session);
  if (sharing) {
    el("metric-save-btn")?.setAttribute("disabled", "disabled");
    el("share-data-btn")?.setAttribute("disabled", "disabled");
    el("delete-session-btn")?.setAttribute("disabled", "disabled");
    el("share-data-btn")?.classList.add("busy");
  }
  el("dimension-select")?.addEventListener("change", updateChartOverride);
  el("metric-select")?.addEventListener("change", updateChartOverride);
  bindChartValueToggle();
  el("metric-save-btn")?.addEventListener("click", () => requestMetricSave(session));
  el("share-data-btn")?.addEventListener("click", () => shareCurrentSession(session));
  el("delete-session-btn")?.addEventListener("click", () => deleteCurrentSession(session));
  el("download-csv-btn")?.addEventListener("click", () => downloadCurrentData("csv"));
  el("download-json-btn")?.addEventListener("click", () => downloadCurrentData("json"));
  el("copy-chart-btn")?.addEventListener("click", copyChartImage);
}

function bindChartValueToggle() {
  const input = el("chart-value-toggle");
  if (!input || input.dataset.bound === "true") return;
  input.checked = state.showChartValues;
  input.dataset.bound = "true";
  input.addEventListener("change", () => {
    state.showChartValues = input.checked;
    state.chartPopover = null;
    renderChart(state.current);
  });
}

function renderMetricsView() {
  const metric = selectedMetric();
  const isShared = state.metricSource === "shared";
  const metricShareAction = !isShared ? latestShareAction(metric?.shareActions || []) : null;
  const metricSharing = !isShared && Boolean(runningShareAction(metric?.shareActions || []));
  const candidate = !isShared ? (state.catalog.metricCandidates?.metrics || []).find((item) => item.metricId === metric?.id) : null;
  el("session-title").textContent = metric ? `${isShared ? "共享指标" : "指标"}：${metric.name || metric.id}` : "指标库";
  el("status-pill").textContent = metric ? zhStatus(metric.status) || metric.status || "共享" : "指标";
  el("session-meta").innerHTML = [
    { label: "模块", value: "指标" },
    { label: "来源", value: isShared ? "共享指标库" : "本地指标库" },
    { label: "指标数", value: isShared ? (state.sharedMetrics.records || []).length : state.metrics.length },
    { label: "当前", value: metric?.id || "未选择" }
  ].map((item) => `<span><b>${escapeHtml(item.label)}</b>${escapeHtml(asText(item.value))}</span>`).join("");
  el("content").innerHTML = `
    <section class="source-switch">
      <button class="tab ${!isShared ? "active" : ""}" data-metric-source="local" ${metricSharing ? "disabled" : ""}>本地指标库</button>
      <button class="tab ${isShared ? "active" : ""}" data-metric-source="shared" ${metricSharing ? "disabled" : ""}>共享指标库</button>
      <button id="refresh-shared-metrics-btn" class="tab ghost-tab" ${metricSharing ? "disabled" : ""}>刷新共享指标</button>
      ${!isShared && metric ? `<button id="share-metric-btn" class="tab ghost-tab" ${metricSharing ? "disabled" : ""}>共享指标</button>` : ""}
      ${!isShared && metric ? `<button id="delete-metric-btn" class="tab ghost-tab danger-tab" ${metricSharing ? "disabled" : ""}>删除指标</button>` : ""}
    </section>
    ${assetHero(isShared ? "共享指标资产" : "指标资产", metric?.name || "请选择指标", metric?.definition || metric?.description || "查看指标口径、关联会话、数据源和字段线索。", [
      { label: "状态", value: metric?.shareStatus || metric?.status || "unknown" },
      { label: "同步", value: isShared ? (state.sharedMetrics.syncedAt || state.sharedMetrics.status || "未同步") : "本地" },
      { label: "关联", value: isShared ? (metric?.relatedSessions?.length || 0) : (metric?.relatedSessions?.length || 0) }
    ])}
    <section class="asset-layout">
      <div class="asset-primary">
        ${!isShared ? renderShareProgress(metricShareAction) : ""}
        ${isShared ? renderSharedMetricDetail(metric) : renderMetricDetail(metric)}
      </div>
      <div class="asset-secondary">
        <div class="asset-card"><h3>${isShared ? "共享来源" : "保存方式"}</h3><p class="detail-copy">${isShared ? `共享指标读取自团队公共 AI 表格，最近同步：${escapeHtml(state.sharedMetrics.syncedAt || "未同步")}。复制到本地后才会成为本机 metrics/*.yaml。` : "指标定义保存在工作区 <code>metrics/*.yaml</code>。历史查询页点击“保存指标”会直接把当前查询口径写入指标库，并保留来源 session 记录。"}</p></div>
        <div class="asset-card"><h3>候选口径补充</h3>${candidate ? detailRows([
          { label: "候选 ID", value: candidate.metricId },
          { label: "粒度", value: candidate.grain },
          { label: "所需字段", value: candidate.requiredFields },
          { label: "风险", value: candidate.risks }
        ]) : `<p class="detail-copy">能力索引中暂无该指标候选。</p>`}</div>
      </div>
    </section>
  `;
  setAssetAudit("指标说明", [
    { title: "指标解释", body: preBlock(metric?.definition || metric?.description || "未登记指标定义") },
    { title: "关联查询会话", body: (metric?.relatedSessions || []).length ? `<div class="list compact">${metric.relatedSessions.map((session) => `
      <button class="list-item link-card" data-open-session="${escapeHtml(session.sessionId)}">
        <div class="title">${escapeHtml(session.sessionId)}</div>
        <div class="meta">${escapeHtml(zhStatus(session.status))} · ${escapeHtml(session.providerId || "查询源")}</div>
        <div class="meta">${escapeHtml(session.question || "")}</div>
      </button>
    `).join("")}</div>` : `<div class="empty small-empty">暂无关联会话</div>` },
    { title: "关联数据源", body: tags((metric?.relatedProviders || []).map((provider) => provider.displayName || provider.id), "暂无关联数据源") },
    { title: "字段线索", body: tags(candidate?.requiredFields || [], "暂无字段线索") },
    { title: "原始指标 YAML", body: preBlock(metric?.raw || ""), open: false }
  ]);
  el("metric-list").querySelectorAll("[data-metric-source]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metricSource = button.dataset.metricSource;
      render();
    });
  });
  el("refresh-shared-metrics-btn")?.addEventListener("click", refreshSharedMetrics);
  el("share-metric-btn")?.addEventListener("click", () => shareMetric(metric));
  el("delete-metric-btn")?.addEventListener("click", () => deleteMetric(metric));
  el("copy-shared-metric-btn")?.addEventListener("click", () => copySharedMetric(metric));
  bindAssetLinks();
}

function renderProvidersView() {
  const provider = selectedProvider();
  el("session-title").textContent = provider ? `查询源：${provider.displayName || provider.id}` : "查询源";
  el("status-pill").textContent = provider ? zhStatus(provider.status) || provider.status : "查询源";
  el("session-meta").innerHTML = [
    { label: "模块", value: "查询源" },
    { label: "Provider", value: provider?.id || "未选择" },
    { label: "MCP", value: provider?.mcpServerHint || "未登记" }
  ].map((item) => `<span><b>${escapeHtml(item.label)}</b>${escapeHtml(asText(item.value))}</span>`).join("");
  const capability = (state.catalog.queryCapabilities?.providers || []).find((item) => item.id === provider?.id);
  el("content").innerHTML = `
    ${assetHero("查询源资产", provider?.displayName || provider?.id || "请选择查询源", provider?.description || "查看查询源工具、可查询范围、路由关键词和安全边界。", [
      { label: "状态", value: provider?.status || "unknown" },
      { label: "工具数", value: (provider?.toolNames?.length || provider?.toolSchemas?.length || (provider?.toolName ? 1 : 0)) },
      { label: "路由关键词", value: provider?.routingKeywords?.length || 0 }
    ])}
    <section class="asset-layout">
      <div class="asset-primary">${renderProviderCapabilityDetail(capability || provider)}</div>
      <div class="asset-secondary">
        <div class="asset-card"><h3>路由关键词</h3>${tags(provider?.routingKeywords || capability?.routingKeywords, "未登记路由关键词")}</div>
        <div class="asset-card"><h3>输出约束</h3>${preBlock(provider?.safetyPolicy || capability?.safetyPolicy || {})}</div>
      </div>
    </section>
  `;
  setAssetAudit("查询源说明", [
    { title: "能力范围", body: tags(capability?.capabilities || provider?.routingKeywords, "未登记能力范围") },
    { title: "工具清单", body: tags((capability?.toolSchemas || []).map((tool) => tool.tool).concat((provider?.toolNames || []).length ? provider.toolNames : [provider?.toolName].filter(Boolean)), "未登记工具") },
    { title: "安全策略", body: preBlock(provider?.safetyPolicy || capability?.safetyPolicy || {}) },
    { title: "Registry 原文", body: preBlock(provider?.raw || ""), open: false }
  ]);
}

function renderCatalogView() {
  const selected = state.selectedCatalog || {};
  const safeSelected = selected.type === "metric" || selected.type === "provider" ? selected : { type: "provider", id: "" };
  const title = safeSelected.type === "metric" ? `能力指标：${safeSelected.id}` : `能力：${safeSelected.id || "查询源"}`;
  el("session-title").textContent = title;
  el("status-pill").textContent = "能力";
  el("session-meta").innerHTML = [
    { label: "模块", value: "能力" },
    { label: "Provider", value: state.catalog.index?.counts?.providers ?? 0 },
    { label: "候选指标", value: state.catalog.index?.counts?.metricCandidates ?? state.catalog.metricCandidates?.metrics?.length ?? 0 },
    { label: "构建", value: state.catalog.index?.builtAt || "未构建" }
  ].map((item) => `<span><b>${escapeHtml(item.label)}</b>${escapeHtml(compactLabel(asText(item.value), 28))}</span>`).join("");
  el("content").innerHTML = `
    ${assetHero("数据源能力索引", title, "解释已登记 provider、MCP 工具、查询能力、路由限制和指标候选。字段字典统一在知识库模块查看。", [
      { label: "Provider", value: state.catalog.index?.counts?.providers ?? 0 },
      { label: "MCP", value: state.catalog.index?.counts?.mcpServers ?? 0 },
      { label: "候选指标", value: state.catalog.index?.counts?.metricCandidates ?? state.catalog.metricCandidates?.metrics?.length ?? 0 }
    ])}
    <section class="asset-layout">
      <div class="asset-primary">${renderCatalogDetail()}</div>
      <div class="asset-secondary">
        <div class="asset-card"><h3>索引文件</h3>${preBlock(state.catalog.index?.files || {})}</div>
      </div>
    </section>
  `;
  setAssetAudit("能力说明", [
    { title: "能力索引说明", body: preBlock(state.catalog.readme || "暂无说明") },
    { title: "当前选择", body: preBlock(safeSelected) },
    { title: "使用边界", body: preBlock("能力模块只展示 provider、MCP 工具和候选指标，不执行生产查询。字段字典、存储位置和代码证据统一在知识库模块查看。") }
  ]);
  bindAssetLinks();
}

function renderKnowledgeFieldList(project, fields, selectedField) {
  if (!fields.length) {
    return `<div class="empty small-empty">暂无字段字典。请在 Agent 对话中重新扫描后端仓库并构建 source catalog。</div>`;
  }
  return `
    <div class="knowledge-field-list">
      ${fields.map((field) => `
        <button class="field-row ${field.field === selectedField?.field ? "active" : ""}" data-knowledge-field="${escapeHtml(field.field)}">
          <div class="field-main">
            <strong>${escapeHtml(field.field)}</strong>
            <span>${escapeHtml(fieldMeaning(field))}</span>
          </div>
          <div class="field-meta">
            <span>${escapeHtml((field.owners || []).slice(0, 2).join(" / ") || "未识别 owner")}</span>
            <span>${escapeHtml((field.dataTypes || []).slice(0, 2).join(" / ") || "未识别类型")}</span>
            <span>${escapeHtml((field.sourceKinds || []).slice(0, 2).join(" / ") || "未知来源")}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderBackendView() {
  const projects = backendProjects();
  const project = selectedBackendProject();
  const fields = knowledgeFieldsFor(project);
  const selectedField = selectedKnowledgeField(project);
  el("session-title").textContent = project ? `知识库：${project.domain}` : "知识库";
  el("status-pill").textContent = "知识库";
  el("session-meta").innerHTML = [
    { label: "模块", value: "知识库" },
    { label: "仓库数", value: projects.length },
    { label: "字段", value: fields.length },
    { label: "当前", value: project?.domain || "未选择" }
  ].map((item) => `<span><b>${escapeHtml(item.label)}</b>${escapeHtml(asText(item.value))}</span>`).join("");
  el("content").innerHTML = `
    ${assetHero("知识库", project?.domain || "请选择知识库条目", project?.repo || "查看后端仓库、字段字典、字段含义、存储 owner 和 provider 映射。", [
      { label: "状态", value: project?.status || "unknown" },
      { label: "字段", value: fields.length },
      { label: "Provider", value: project?.providerId || "未登记" }
    ])}
    <section class="asset-layout">
      <div class="asset-primary">
        <section class="detail-panel">
          <div class="detail-head">
            <div><div class="eyebrow">知识库条目</div><h3>${escapeHtml(project?.domain || "未选择")}</h3></div>
            <span class="status-pill subtle">${escapeHtml(project?.status || "unknown")}</span>
          </div>
          ${detailRows([
            { label: "仓库", value: project?.repo },
            { label: "Provider", value: project?.providerId },
            { label: "最新扫描", value: project?.latestScan },
            { label: "字段映射", value: project?.latestFieldMapping }
          ])}
          <div class="detail-section">
            <h4>字段字典</h4>
            ${renderKnowledgeFieldList(project, fields, selectedField)}
          </div>
        </section>
      </div>
      <div class="asset-secondary">
        ${renderKnowledgeFieldDetail(selectedField)}
      </div>
    </section>
  `;
  setAssetAudit("知识库说明", [
    { title: "用途和边界", body: preBlock("知识库用于查看字段含义、存储 owner、类型、来源和证据，帮助 Agent 做自然语言指标匹配和查询设计。它不是查询结果，不替代用户对指标口径和数据源的确认。") },
    { title: "扫描元数据", body: preBlock({
      domain: project?.domain || "",
      repo: project?.repo || "",
      providerId: project?.providerId || "",
      latestScan: project?.latestScan || "",
      latestFieldMapping: project?.latestFieldMapping || "",
      fields: fields.length,
      sourceCatalogBuiltAt: state.catalog.index?.builtAt || ""
    }), open: false }
  ]);
  bindAssetLinks();
  document.querySelectorAll("[data-knowledge-field]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedKnowledgeFieldId = button.dataset.knowledgeField;
      render();
    });
  });
}

function bindAssetLinks() {
  document.querySelectorAll("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarPanel = "history";
      openSession(button.dataset.openSession);
    });
  });
  document.querySelectorAll("[data-show-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarPanel = "providers";
      state.selectedProviderId = button.dataset.showProvider;
      render();
    });
  });
  document.querySelectorAll("[data-show-field]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = fieldByName(button.dataset.showField);
      state.sidebarPanel = "backend";
      state.selectedKnowledgeFieldId = button.dataset.showField;
      state.selectedBackendId = button.dataset.fieldDomain || (field?.domains || [])[0] || state.selectedBackendId;
      render();
    });
  });
  document.querySelectorAll("[data-catalog-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarPanel = "catalog";
      state.selectedCatalog = { type: button.dataset.catalogType, id: button.dataset.catalogId };
      render();
    });
  });
}

function renderSidebar() {
  const currentId = state.current?.sessionId;
  const filter = state.historyFilter.trim().toLowerCase();
  const filteredSessions = filter
    ? state.sessions.filter((session) => [session.sessionId, session.status, session.question, session.providerId].join(" ").toLowerCase().includes(filter))
    : state.sessions;
  const sessions = [...filteredSessions].sort((left, right) => {
    return String(right.executedAt || right.updatedAt || "").localeCompare(String(left.executedAt || left.updatedAt || ""));
  });
  el("session-list").innerHTML = sessions.map((session) => `
    <button class="list-item ${session.sessionId === currentId ? "active" : ""}" data-session-id="${escapeHtml(session.sessionId)}">
      <div class="title">${escapeHtml(session.sessionId)}</div>
      <div class="meta">${escapeHtml(zhStatus(session.status))} · ${escapeHtml(session.providerId || "查询源")} · ${escapeHtml(formatTime(session.executedAt || session.updatedAt || ""))}</div>
      ${(session.revisionCount || session.linkedFrom) ? `<div class="tag-row">
        ${session.revisionCount ? `<span class="tag">修订 ${escapeHtml(session.revisionCount)}</span>` : ""}
        ${session.linkedFrom ? `<span class="tag">源自 ${escapeHtml(compactLabel(session.linkedFrom, 18))}</span>` : ""}
      </div>` : ""}
      <div class="meta">${escapeHtml(session.question || "")}</div>
    </button>
  `).join("") || `<div class="empty">暂无查询历史</div>`;
  document.querySelectorAll("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => openSession(button.dataset.sessionId));
  });

  const currentMetric = selectedMetric();
  const sharedMetricRows = state.sharedMetrics.records || [];
  const metricSourceSummary = `
    <div class="source-mini-tabs">
      <button class="${state.metricSource === "local" ? "active" : ""}" data-metric-source="local">本地 ${escapeHtml(state.metrics.length)}</button>
      <button class="${state.metricSource === "shared" ? "active" : ""}" data-metric-source="shared">共享 ${escapeHtml(sharedMetricRows.length)}</button>
    </div>
  `;
  if (state.metricSource === "shared") {
    el("metric-list").innerHTML = metricSourceSummary + (sharedMetricRows.map((metric) => `
      <button class="list-item ${(metric.id === currentMetric?.id || metric.recordId === currentMetric?.recordId) ? "active" : ""}" data-shared-metric-id="${escapeHtml(metric.id || metric.recordId)}">
        <div class="title">${escapeHtml(metric.name || metric.id)}</div>
        <div class="meta">${escapeHtml(metric.id || "未登记 ID")} · ${escapeHtml(metric.shareStatus || metric.status || "shared")}</div>
        <div class="meta">${escapeHtml(metric.definition || "")}</div>
        <div class="tag-row">
          ${metric.sharedBy ? `<span class="tag">${escapeHtml(metric.sharedBy)}</span>` : ""}
          ${metric.sharedAt ? `<span class="tag">${escapeHtml(String(metric.sharedAt).slice(0, 16))}</span>` : ""}
          ${(metric.relatedSessions || []).length ? `<span class="tag">会话 ${escapeHtml(metric.relatedSessions.length)}</span>` : ""}
        </div>
      </button>
    `).join("") || `<div class="empty">暂无共享指标，请先刷新共享指标库</div>`);
  } else {
    el("metric-list").innerHTML = metricSourceSummary + (state.metrics.map((metric) => `
      <button class="list-item ${metric.id === currentMetric?.id ? "active" : ""}" data-metric-id="${escapeHtml(metric.id)}">
        <div class="title">${escapeHtml(metric.name)}</div>
        <div class="meta">${escapeHtml(metric.id)} · ${escapeHtml(metric.status)} · 使用 ${escapeHtml(metric.recentUsageCount || 0)} 次</div>
        <div class="meta">${escapeHtml(metric.definition || "")}</div>
        ${(metric.relatedSessions || []).length ? `<div class="tag-row"><span class="tag">会话 ${escapeHtml(metric.relatedSessions.length)}</span>${(metric.relatedProviders || []).slice(0, 2).map((provider) => `<span class="tag">${escapeHtml(provider.id || provider.displayName)}</span>`).join("")}</div>` : ""}
        ${runningShareAction(metric.shareActions || []) ? `<div class="tag-row"><span class="tag warn">共享中</span></div>` : ""}
      </button>
    `).join("") || `<div class="empty">暂无指标</div>`);
  }
  document.querySelectorAll("[data-metric-source]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metricSource = button.dataset.metricSource;
      render();
    });
  });
  document.querySelectorAll("[data-metric-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metricSource = "local";
      state.selectedMetricId = button.dataset.metricId;
      render();
    });
  });
  document.querySelectorAll("[data-shared-metric-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metricSource = "shared";
      state.selectedSharedMetricId = button.dataset.sharedMetricId;
      render();
    });
  });

  const currentProvider = selectedProvider();
  el("provider-list").innerHTML = (state.providerItems || []).map((provider) => {
    const tools = provider.toolNames?.length ? provider.toolNames : [provider.toolName].filter(Boolean);
    const safety = provider.safetyPolicy || {};
    return `
      <button class="list-item ${provider.id === currentProvider?.id ? "active" : ""}" data-provider-id="${escapeHtml(provider.id)}">
        <div class="title">${escapeHtml(provider.displayName || provider.id)}</div>
        <div class="meta">${escapeHtml(provider.id)} · ${escapeHtml(provider.type || "")} · ${escapeHtml(zhStatus(provider.status))}</div>
        <div class="meta">MCP：${escapeHtml(provider.mcpServerHint || "-")} · 主工具：${escapeHtml(provider.toolName || "-")}</div>
        ${tools.length ? `<div class="tag-row">${tools.map((tool) => `<span class="tag">${escapeHtml(tool)}</span>`).join("")}</div>` : ""}
        ${provider.routingKeywords?.length ? `<div class="meta">路由：${escapeHtml(provider.routingKeywords.slice(0, 10).join(" / "))}</div>` : ""}
        <div class="meta">只读：${escapeHtml(safety.readOnly || "-")} · 明细导出：${escapeHtml(safety.allowDetailDump || "-")} · Preview：${escapeHtml(safety.maxPreviewRows || "-")}</div>
      </button>
    `;
  }).join("") || `<pre>${escapeHtml(state.providers || "暂无查询源")}</pre>`;
  document.querySelectorAll("[data-provider-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProviderId = button.dataset.providerId;
      render();
    });
  });

  const catalog = state.catalog || {};
  const catalogIndex = catalog.index || {};
  const capabilityProviders = catalog.queryCapabilities?.providers || [];
  const metricCandidates = catalog.metricCandidates?.metrics || [];
  if (!state.selectedCatalog.id) {
    state.selectedCatalog = { type: "provider", id: capabilityProviders[0]?.id || "" };
  }
  const catalogSummary = `
    <div class="list-item">
      <div class="title">能力索引</div>
      <div class="meta">Provider ${escapeHtml(catalogIndex.counts?.providers ?? 0)} · MCP ${escapeHtml(catalogIndex.counts?.mcpServers ?? 0)} · 候选指标 ${escapeHtml(catalogIndex.counts?.metricCandidates ?? metricCandidates.length)}</div>
      <div class="meta">${escapeHtml(catalogIndex.builtAt || "尚未构建")}</div>
    </div>
  `;
  const capabilityHtml = capabilityProviders.slice(0, 8).map((provider) => `
    <button class="list-item ${state.selectedCatalog.type === "provider" && state.selectedCatalog.id === provider.id ? "active" : ""}" data-catalog-type="provider" data-catalog-id="${escapeHtml(provider.id)}">
      <div class="title">${escapeHtml(provider.displayName || provider.id)}</div>
      <div class="meta">${escapeHtml(provider.id)} · ${escapeHtml((provider.capabilities || []).join(" / "))}</div>
      ${(provider.toolSchemas || []).length ? `<div class="tag-row">${provider.toolSchemas.slice(0, 6).map((tool) => `<span class="tag">${escapeHtml(tool.tool)}</span>`).join("")}</div>` : ""}
    </button>
  `).join("");
  const metricHtml = metricCandidates.slice(0, 5).map((metric) => `
    <button class="list-item ${state.selectedCatalog.type === "metric" && state.selectedCatalog.id === metric.metricId ? "active" : ""}" data-catalog-type="metric" data-catalog-id="${escapeHtml(metric.metricId)}">
      <div class="title">${escapeHtml(metric.name || metric.metricId)}</div>
      <div class="meta">${escapeHtml(metric.metricId)} · ${escapeHtml(metric.grain || "")}</div>
      <div class="meta">字段：${escapeHtml((metric.requiredFields || []).join(" / "))}</div>
    </button>
  `).join("");
  el("catalog-list").innerHTML = catalog.index
    ? `${catalogSummary}<div class="detail-section"><h4>数据源能力</h4>${capabilityHtml || `<div class="meta">暂无查询源能力</div>`}</div><div class="detail-section"><h4>指标候选</h4>${metricHtml || `<div class="meta">暂无指标候选</div>`}</div>`
    : `<div class="empty">尚未构建能力索引。请在 Agent 对话中运行 source catalog 构建。</div>`;
  document.querySelectorAll("[data-catalog-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCatalog = { type: button.dataset.catalogType, id: button.dataset.catalogId };
      render();
    });
  });

  const projectRows = backendProjects();
  const currentProject = selectedBackendProject();
  const projectsHtml = projectRows.map((project) => {
    const fieldCount = knowledgeFieldsFor(project).length || project.fields?.length || 0;
    return `
    <button class="list-item ${project.id === currentProject?.id ? "active" : ""}" data-backend-id="${escapeHtml(project.id)}">
      <div class="title">${escapeHtml(project.domain)}</div>
      <div class="meta">${escapeHtml(project.status || "registered")} · ${escapeHtml(project.repo || "")}</div>
      <div class="tag-row">${project.providerId ? `<span class="tag">${escapeHtml(project.providerId)}</span>` : ""}<span class="tag">字段 ${escapeHtml(fieldCount)}</span></div>
    </button>
  `;
  }).join("");
  const scansHtml = (state.backend.scans || []).map((scan) => `
    <div class="list-item">
      <div class="title">${escapeHtml(scan.file)}</div>
      <div class="meta">${escapeHtml(markdownText(scan.content).slice(0, 120))}</div>
    </div>
  `).join("");
  el("backend-list").innerHTML = projectsHtml || scansHtml || `<div class="empty">暂无知识库条目</div>`;
  document.querySelectorAll("[data-backend-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedBackendId = button.dataset.backendId;
      state.selectedKnowledgeFieldId = "";
      render();
    });
  });
  renderSidebarPanels();
}

function renderLineage(session) {
  const lineage = session?.lineage || {};
  const source = lineage.source;
  const children = lineage.children || [];
  const sourceHtml = source ? `
    <button class="list-item link-card" data-open-session="${escapeHtml(source.sessionId)}">
      <div class="title">来源：${escapeHtml(source.sessionId)}</div>
      <div class="meta">${escapeHtml(zhStatus(source.status))} · ${escapeHtml(source.providerId || "查询源")} · 修订 ${escapeHtml(source.revisionCount || 0)}</div>
      <div class="meta">${escapeHtml(source.question || "")}</div>
      ${lineage.copyReason ? `<div class="meta">原因：${escapeHtml(lineage.copyReason)}</div>` : ""}
    </button>
  ` : "";
  const childrenHtml = children.map((child) => `
    <button class="list-item link-card" data-open-session="${escapeHtml(child.sessionId)}">
      <div class="title">派生：${escapeHtml(child.sessionId)}</div>
      <div class="meta">${escapeHtml(zhStatus(child.status))} · ${escapeHtml(child.providerId || "查询源")} · 修订 ${escapeHtml(child.revisionCount || 0)}</div>
      <div class="meta">${escapeHtml(child.question || "")}</div>
    </button>
  `).join("");
  el("lineage").innerHTML = sourceHtml || childrenHtml
    ? `${sourceHtml}${childrenHtml}`
    : `<div class="empty small-empty">暂无关联记录</div>`;
  document.querySelectorAll("[data-open-session]").forEach((button) => {
    button.addEventListener("click", () => openSession(button.dataset.openSession));
  });
}

function renderActions(session) {
  const revisions = session?.revisions || [];
  const source = session?.lineage?.source;
  const sourceRevisions = source?.revisions || [];
  const pending = session?.pendingActions || [];
  const revisionHtml = revisions.map((revision) => `
    <div class="list-item">
      <div class="title">${escapeHtml(revision.revisionId)}</div>
      <div class="meta">${escapeHtml(markdownText(revision.change).slice(0, 120))}</div>
      ${revision.metricPlan ? `<details class="inline-detail" data-detail-key="history:revision:${escapeHtml(revision.revisionId)}:metric-plan"><summary>指标口径</summary><pre>${escapeHtml(revision.metricPlan)}</pre></details>` : ""}
      ${revision.queryPlan ? `<details class="inline-detail" data-detail-key="history:revision:${escapeHtml(revision.revisionId)}:query-plan"><summary>查询计划</summary><pre>${escapeHtml(typeof revision.queryPlan === "string" ? revision.queryPlan : JSON.stringify(revision.queryPlan, null, 2))}</pre></details>` : ""}
      ${revision.audit ? `<details class="inline-detail" data-detail-key="history:revision:${escapeHtml(revision.revisionId)}:audit"><summary>审计说明</summary><pre>${escapeHtml(markdownText(revision.audit))}</pre></details>` : ""}
    </div>
  `).join("");
  const sourceRevisionHtml = !revisionHtml && sourceRevisions.length ? `
    <button class="list-item link-card" data-open-session="${escapeHtml(source.sessionId)}">
      <div class="title">当前 session 暂无修订，来源 session 有 ${escapeHtml(sourceRevisions.length)} 条修订</div>
      <div class="meta">${escapeHtml(source.sessionId)}</div>
    </button>
    ${sourceRevisions.map((revision) => `
      <div class="list-item muted-item">
        <div class="title">${escapeHtml(revision.revisionId)}</div>
        <div class="meta">${escapeHtml(markdownText(revision.change).slice(0, 120))}</div>
      </div>
    `).join("")}
  ` : "";
  el("revisions").innerHTML = revisionHtml || sourceRevisionHtml || `<div class="empty">暂无修订</div>`;
  document.querySelectorAll("#revisions [data-open-session]").forEach((button) => {
    button.addEventListener("click", () => openSession(button.dataset.openSession));
  });
  el("pending-actions").innerHTML = pending.map((action) => `
    <div class="list-item">
      <div class="title">${escapeHtml(action.actionId)}</div>
      <div class="meta">${escapeHtml(actionTypeLabel(action.type))} · ${escapeHtml(zhStatus(action.status))} · 等待 Agent 对话处理</div>
      <div class="meta">${escapeHtml(action.reason || action.dimension || "")}${action.value ? ` = ${escapeHtml(action.value)}` : ""}</div>
      ${action.prompt ? `<div class="meta">${escapeHtml(action.prompt)}</div>` : ""}
      ${action.candidateFields?.length ? `<div class="tag-row">${action.candidateFields.slice(0, 8).map((field) => `<span class="tag">${escapeHtml(field.field || field)}</span>`).join("")}</div>` : ""}
    </div>
  `).join("") || `<div class="empty">暂无待 Agent 处理请求</div>`;
  const pendingBlock = el("pending-actions")?.closest(".audit-block");
  if (pendingBlock) {
    pendingBlock.hidden = pending.length === 0;
  }
}

function renderConfirmationSummary(session) {
  const confirmation = session?.confirmation;
  if (!confirmation) {
    el("confirmation-summary").innerHTML = renderReadableMarkdown("暂无单独确认单。请查看 Agent 解析、指标计划和审计说明。");
    return;
  }
  el("confirmation-summary").innerHTML = readableValueHtml({
    状态: zhStatus(confirmation.status),
    指标: confirmation.metrics || [],
    指标意图: confirmation.metricIntent || {},
    指标口径: confirmation.metricDefinition || "",
    数据源: confirmation.sourceTables || [],
    计算口径: confirmation.calculationLogic || "",
    时间范围: confirmation.timeRange || "",
    时间字段: confirmation.timeField || "",
    维度: confirmation.dimensions || [],
    过滤: confirmation.filters || [],
    去重: confirmation.dedupLogic || "",
    候选策略: confirmation.implementationStrategies || [],
    Fallback: confirmation.fallbackPolicy || "",
    后端复核: confirmation.backendRecheckPolicy || "",
    风险: confirmation.risks || []
  });
}

function renderAudit(session) {
  el("request").innerHTML = renderReadableMarkdown(session?.request, { emptyText: "暂无原始需求" });
  el("interpretation").innerHTML = renderReadableMarkdown(session?.interpretation, { emptyText: "暂无 Agent 解析" });
  el("metric-plan").innerHTML = renderMetricCalculationSummary(session);
  renderConfirmationSummary(session);
  el("provider-summary").textContent = renderProviderSummary(session?.providerDetails);
  el("query-plan").textContent = typeof session?.queryPlan === "string" ? session.queryPlan : JSON.stringify(session?.queryPlan || {}, null, 2);
  el("audit").innerHTML = renderReadableMarkdown(session?.audit, { emptyText: "暂无审计说明" });
}

function renderProviderSummary(provider) {
  if (!provider) {
    return "暂无查询源详情";
  }
  return JSON.stringify({
    id: provider.id,
    类型: provider.type || "",
    名称: provider.displayName || provider.id,
    状态: zhStatus(provider.status) || provider.status,
    MCP服务: provider.mcpServerHint || "",
    工具名: provider.toolName || "",
    Skill入口: provider.skillEntrypoint || "",
    路由关键词: provider.routingKeywords || [],
    安全策略: provider.safetyPolicy || {}
  }, null, 2);
}

function render() {
  rememberAuditDetailsState();
  rememberAuditScrollState();
  const session = state.current;
  if (state.sidebarPanel === "metrics") {
    renderMetricsView();
  } else if (state.sidebarPanel === "providers") {
    renderProvidersView();
  } else if (state.sidebarPanel === "catalog") {
    renderCatalogView();
  } else if (state.sidebarPanel === "backend") {
    renderBackendView();
  } else {
    renderHistoryView(session);
  }
  renderSidebar();
  restoreAuditDetailsState();
  restoreAuditScrollState();
}

function renderSidebarPanels() {
  document.querySelectorAll("[data-sidebar-panel]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sidebarPanel === state.sidebarPanel);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== state.sidebarPanel;
  });
}

async function load(options = {}) {
  const previousSessionId = state.current?.sessionId || "";
  const [status, current, sessions, metrics, providers, backend, catalog, shareTargets, shareProfile, shareMcpConfig] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/current-dashboard"),
    fetchJson("/api/sessions"),
    fetchJson("/api/metrics"),
    fetchJson("/api/providers"),
    fetchJson("/api/backend-projects"),
    fetchJson("/api/source-catalog"),
    fetchJson("/api/share-targets"),
    fetchJson("/api/share-profile"),
    fetchJson("/api/share-mcp-config")
  ]);
  const marker = `${status.currentSessionId || ""}|${status.updatedAt || ""}`;
  const dashboardChanged = state.currentMarker && marker !== state.currentMarker;
  state.currentMarker = marker;
  state.workspacePath = status.workspacePath || "";
  state.sessions = sessions.sessions || [];
  state.metrics = metrics.metrics || [];
  state.sharedMetrics = metrics.sharedMetrics || { records: [], status: "not_synced" };
  state.shareTargets = shareTargets || { targets: [], defaultTarget: "" };
  state.shareProfile = shareProfile || { configured: false, displayName: "" };
  state.shareMcpConfig = shareMcpConfig || { configured: false };
  state.providers = providers.raw || "";
  state.providerItems = canonicalProviders(providers.providers || []);
  state.backend = backend || { scans: [] };
  state.catalog = catalog || state.catalog;
  state.catalog.queryCapabilities = {
    ...(state.catalog.queryCapabilities || {}),
    providers: canonicalProviders(state.catalog.queryCapabilities?.providers || [])
  };
  if (dashboardChanged) {
    state.viewedSessionId = "";
    state.selectedChart = 0;
    state.hiddenSeries = [];
    state.chartOverrides = {};
    state.selectedPreviewGroup = "";
    state.chartDetail = null;
    state.chartPopover = null;
    state.tableRenderSignature = "";
  }
  if (state.viewedSessionId && !dashboardChanged) {
    const viewed = await fetchJson(`/api/sessions/${encodeURIComponent(state.viewedSessionId)}`);
    state.current = viewed.session;
  } else {
    state.current = current.session;
  }
  if (previousSessionId && state.current?.sessionId === previousSessionId && options.keepChartState) {
    // Keep chart controls stable during auto-refresh.
  } else if (previousSessionId !== state.current?.sessionId) {
    state.selectedChart = 0;
    state.hiddenSeries = [];
    state.chartOverrides = {};
    state.selectedPreviewGroup = "";
    state.chartDetail = null;
    state.chartPopover = null;
    state.tableRenderSignature = "";
  }
  render();
  const pill = el("auto-refresh-pill");
  if (pill) {
    pill.textContent = `自动更新 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  }
}

async function autoRefresh() {
  try {
    await load({ keepChartState: true });
  } catch (error) {
    el("auto-refresh-pill").textContent = "自动更新失败";
    console.error(error);
  }
}

function updateChartOverride() {
  const base = (state.current?.chartSpec?.charts || [])[state.selectedChart];
  if (!base) return;
  const dimensionSelect = el("dimension-select");
  const metricSelect = el("metric-select");
  if (!dimensionSelect || !metricSelect) return;
  const rows = state.current?.aggregate?.rows || state.current?.preview?.rows || [];
  const fallbackMetric = base.type === "kpi" ? base.metric : base.type === "pie" ? base.value : base.y;
  const metricValue = rows.some((row) => isNumericValue(row?.[metricSelect.value]))
    ? metricSelect.value
    : fallbackMetric;
  state.chartOverrides[base.id || state.selectedChart] = {
    x: dimensionSelect.value,
    y: metricValue
  };
  state.chartDetail = null;
  state.chartPopover = null;
  state.tableRenderSignature = "";
  renderChart(state.current);
  renderTable(state.current, { preserveScroll: false });
}

el("dimension-select")?.addEventListener("change", updateChartOverride);
el("metric-select")?.addEventListener("change", updateChartOverride);
el("workspace-path-btn").addEventListener("click", () => copyText(state.workspacePath, "工作区路径"));
el("session-path-btn").addEventListener("click", () => copyText(state.current?.path, "查询记录路径"));
el("history-filter").addEventListener("input", (event) => {
  state.historyFilter = event.target.value;
  renderSidebar();
});
document.querySelectorAll("[data-sidebar-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    state.sidebarPanel = button.dataset.sidebarPanel;
    render();
  });
});

load().then(() => {
  window.setInterval(autoRefresh, refreshIntervalMs);
}).catch((error) => {
  el("status-pill").textContent = "错误";
  el("chart").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
