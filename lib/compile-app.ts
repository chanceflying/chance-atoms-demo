import type { AppRecord, AppSpec } from "./domain";
import { parseAppSpec, parseRecords } from "./validation";

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Compiles a validated, declarative spec into a self-contained application.
 * The generated script is fixed: user text only enters through escaped JSON and
 * is rendered with textContent/value, never innerHTML or eval.
 */
export function compileAppToHtml(
  specInput: AppSpec,
  recordsInput: AppRecord[],
  projectId: string,
): string {
  const spec = parseAppSpec(specInput);
  const records = parseRecords(recordsInput, spec);
  if (typeof projectId !== "string" || projectId.length < 1 || projectId.length > 128) {
    throw new TypeError("projectId must be a non-empty string of at most 128 characters");
  }

  const bootstrap = jsonForHtml({ spec, records, projectId });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Forge preview</title>
  <style>
    :root {
      color-scheme: light;
      --accent: #635bff;
      --app-bg: #f5f7fb;
      --surface: #ffffff;
      --surface-2: #f8f9fc;
      --ink: #172033;
      --muted: #697386;
      --line: #e2e6ee;
      --soft: rgba(99, 91, 255, .11);
      --danger: #c23845;
      --shadow: 0 18px 55px rgba(24, 32, 51, .10);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--app-bg); }
    body { margin: 0; min-width: 300px; min-height: 100vh; color: var(--ink); background: var(--app-bg); }
    button, input, textarea, select { font: inherit; }
    button { color: inherit; }
    .app-shell { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 34px 0 64px; }
    .app-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    .eyebrow { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 9px; color: var(--accent); font-size: 12px; font-weight: 760; letter-spacing: .12em; text-transform: uppercase; }
    .eyebrow::before { width: 7px; height: 7px; border-radius: 999px; background: currentColor; content: ""; box-shadow: 0 0 0 5px var(--soft); }
    h1 { margin: 0; max-width: 720px; font-size: clamp(28px, 5vw, 44px); line-height: 1.06; letter-spacing: -.04em; }
    .description { max-width: 680px; margin: 12px 0 0; color: var(--muted); font-size: 15px; line-height: 1.65; }
    .primary, .secondary, .danger, .icon-button { border: 0; border-radius: 11px; cursor: pointer; font-weight: 690; transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
    .primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; color: #fff; background: var(--accent); box-shadow: 0 8px 22px color-mix(in srgb, var(--accent) 24%, transparent); }
    .primary:hover { transform: translateY(-1px); box-shadow: 0 11px 28px color-mix(in srgb, var(--accent) 32%, transparent); }
    .primary:active { transform: translateY(0); }
    .secondary, .danger { min-height: 36px; padding: 0 12px; background: transparent; }
    .secondary { color: var(--muted); border: 1px solid var(--line); }
    .secondary:hover { color: var(--ink); background: var(--surface-2); }
    .danger { color: var(--danger); }
    .danger:hover { background: color-mix(in srgb, var(--danger) 9%, transparent); }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 25%, transparent); outline-offset: 2px; }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .stat { min-height: 112px; padding: 19px 20px; border: 1px solid var(--line); border-radius: 16px; background: color-mix(in srgb, var(--surface) 93%, transparent); box-shadow: 0 7px 24px rgba(24, 32, 51, .045); }
    .stat-label { display: block; margin-bottom: 10px; color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; }
    .stat-value { display: block; font-size: 29px; font-weight: 760; letter-spacing: -.035em; }
    .workspace { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: var(--shadow); }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 72px; padding: 13px 15px; border-bottom: 1px solid var(--line); }
    .toolbar-fields { display: flex; flex: 1; gap: 10px; }
    .search-wrap { position: relative; flex: 1; max-width: 460px; }
    .search-wrap svg { position: absolute; top: 50%; left: 13px; width: 17px; height: 17px; color: var(--muted); transform: translateY(-50%); pointer-events: none; }
    .control { width: 100%; min-height: 42px; padding: 0 13px; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    .search-wrap .control { padding-left: 40px; }
    select.control { width: auto; min-width: 160px; cursor: pointer; }
    #records-root { min-height: 280px; }
    .table-scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 13px 15px; color: var(--muted); background: var(--surface-2); font-size: 11px; font-weight: 760; letter-spacing: .06em; text-align: left; text-transform: uppercase; white-space: nowrap; }
    td { max-width: 270px; padding: 15px; border-top: 1px solid var(--line); font-size: 13px; vertical-align: middle; }
    tbody tr { transition: background .14s ease; }
    tbody tr:hover { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
    .cell-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cell-primary { font-weight: 690; }
    .badge { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 9px; overflow: hidden; color: var(--ink); border-radius: 999px; background: var(--soft); font-size: 11px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
    .badge::before { flex: none; width: 6px; height: 6px; border-radius: 99px; background: var(--accent); content: ""; }
    .check { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
    .check-dot { display: grid; width: 20px; height: 20px; place-items: center; color: #fff; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font-size: 12px; }
    .check.is-checked { color: var(--ink); }
    .check.is-checked .check-dot { border-color: var(--accent); background: var(--accent); }
    .row-actions { display: flex; justify-content: flex-end; gap: 3px; white-space: nowrap; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; padding: 16px; }
    .card { display: flex; min-height: 230px; flex-direction: column; padding: 18px; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); transition: transform .16s ease, box-shadow .16s ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(24, 32, 51, .08); }
    .card-title { margin: 0 0 16px; font-size: 17px; line-height: 1.3; letter-spacing: -.018em; }
    .card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .card-field { min-width: 0; }
    .card-label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 10px; font-weight: 740; letter-spacing: .055em; text-transform: uppercase; }
    .card-value { display: block; overflow: hidden; font-size: 13px; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
    .card-actions { display: flex; justify-content: flex-end; gap: 3px; margin: auto -7px -7px 0; padding-top: 17px; }
    .empty { display: grid; min-height: 300px; padding: 42px; place-items: center; text-align: center; }
    .empty-icon { display: grid; width: 54px; height: 54px; margin: 0 auto 15px; place-items: center; color: var(--accent); border-radius: 17px; background: var(--soft); font-size: 25px; }
    .empty h2 { margin: 0 0 7px; font-size: 18px; }
    .empty p { max-width: 360px; margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .modal[hidden] { display: none; }
    .modal { position: fixed; z-index: 20; inset: 0; display: grid; padding: 22px; overflow-y: auto; place-items: center; background: rgba(10, 16, 29, .54); backdrop-filter: blur(6px); }
    .dialog { width: min(620px, 100%); max-height: min(780px, calc(100vh - 44px)); overflow-y: auto; border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 20px; background: var(--surface); box-shadow: 0 28px 90px rgba(4, 9, 20, .30); }
    .dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 22px; border-bottom: 1px solid var(--line); }
    .dialog-header h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
    .icon-button { display: grid; width: 36px; height: 36px; place-items: center; color: var(--muted); background: var(--surface-2); font-size: 20px; }
    .form-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; padding: 22px; }
    .form-field { min-width: 0; }
    .form-field.is-wide { grid-column: 1 / -1; }
    .form-field.is-checkbox { display: flex; align-items: center; min-height: 44px; padding-top: 23px; }
    .form-label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 720; }
    .required { margin-left: 3px; color: var(--danger); }
    .form-control { width: 100%; min-height: 43px; padding: 10px 12px; color: var(--ink); border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); }
    textarea.form-control { min-height: 96px; resize: vertical; line-height: 1.5; }
    .checkbox-label { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 680; }
    .checkbox-label input { width: 18px; height: 18px; accent-color: var(--accent); }
    .dialog-footer { display: flex; justify-content: flex-end; gap: 9px; padding: 16px 22px 20px; border-top: 1px solid var(--line); }
    .toast { position: fixed; z-index: 30; right: 20px; bottom: 20px; padding: 12px 15px; color: #fff; border-radius: 10px; background: #182033; box-shadow: 0 12px 35px rgba(0, 0, 0, .22); font-size: 13px; font-weight: 680; opacity: 0; transform: translateY(8px); transition: opacity .2s ease, transform .2s ease; pointer-events: none; }
    .toast.is-visible { opacity: 1; transform: translateY(0); }
    @media (max-width: 720px) {
      .app-shell { width: min(100% - 24px, 1180px); padding-top: 24px; }
      .app-header { align-items: flex-start; flex-direction: column; }
      .app-header .primary { width: 100%; }
      .stats { grid-template-columns: 1fr; }
      .stat { min-height: 88px; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .toolbar-fields { flex-direction: column; }
      .search-wrap { max-width: none; }
      select.control { width: 100%; }
      .form-fields { grid-template-columns: 1fr; }
      .form-field.is-wide { grid-column: auto; }
      .cards { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow" id="entity-kicker"></p>
        <h1 id="app-title"></h1>
        <p class="description" id="app-description"></p>
      </div>
      <button class="primary" id="add-button" type="button"><span aria-hidden="true">＋</span><span id="add-label"></span></button>
    </header>
    <section class="stats" id="stats" aria-label="Summary"></section>
    <section class="workspace" aria-label="Records">
      <div class="toolbar" id="toolbar">
        <div class="toolbar-fields">
          <label class="search-wrap" id="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
            <span hidden>Search</span>
            <input class="control" id="search-input" type="search" autocomplete="off">
          </label>
          <label id="filter-wrap">
            <span hidden>Filter</span>
            <select class="control" id="filter-select"></select>
          </label>
        </div>
        <span id="result-count" aria-live="polite"></span>
      </div>
      <div id="records-root"></div>
    </section>
  </main>
  <div class="modal" id="modal" hidden>
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <header class="dialog-header">
        <h2 id="dialog-title"></h2>
        <button class="icon-button" id="close-modal" type="button" aria-label="Close">×</button>
      </header>
      <form id="record-form">
        <div class="form-fields" id="form-fields"></div>
        <footer class="dialog-footer">
          <button class="secondary" id="cancel-button" type="button">Cancel</button>
          <button class="primary" id="save-button" type="submit">Save</button>
        </footer>
      </form>
    </section>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script id="forge-data" type="application/json">${bootstrap}</script>
  <script>
    (() => {
      "use strict";
      const bootstrap = JSON.parse(document.getElementById("forge-data").textContent || "{}");
      const spec = bootstrap.spec;
      const projectId = bootstrap.projectId;
      let records = bootstrap.records;
      let editingId = null;
      let query = "";
      let filterValue = "";
      let recordCounter = 0;
      let toastTimer = 0;
      const isZh = /[\u3400-\u9fff]/.test(spec.title + spec.description);
      const copy = isZh
        ? { collection: "实时数据应用", add: "新增", search: "搜索全部字段…", all: "全部", records: "条记录", total: "总记录", visible: "当前结果", done: "已完成", value: "数值合计", categories: "已用分类", actions: "操作", edit: "编辑", remove: "删除", emptyTitle: "还没有匹配的记录", emptyBody: "调整搜索或筛选条件，或者创建一条新记录。", create: "新建", update: "编辑", cancel: "取消", save: "保存记录", created: "记录已创建", updated: "记录已更新", deleted: "记录已删除", yes: "是", no: "否", deleteQuestion: "确定删除这条记录吗？" }
        : { collection: "Live data app", add: "Add", search: "Search every field…", all: "All", records: "records", total: "Total records", visible: "Visible now", done: "Completed", value: "Total value", categories: "Categories used", actions: "Actions", edit: "Edit", remove: "Delete", emptyTitle: "No matching records", emptyBody: "Adjust your search or filter, or create a new record.", create: "New", update: "Edit", cancel: "Cancel", save: "Save record", created: "Record created", updated: "Record updated", deleted: "Record deleted", yes: "Yes", no: "No", deleteQuestion: "Delete this record?" };

      const byId = (id) => document.getElementById(id);
      const addButton = byId("add-button");
      const modal = byId("modal");
      const form = byId("record-form");
      const formFields = byId("form-fields");
      const recordsRoot = byId("records-root");
      const statsRoot = byId("stats");
      const searchInput = byId("search-input");
      const filterSelect = byId("filter-select");

      function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
      }

      function valueMap(record) {
        const values = Object.create(null);
        for (const entry of record.values || []) values[entry.fieldId] = entry.value;
        return values;
      }

      function fieldValue(record, fieldId) {
        const entry = (record.values || []).find((candidate) => candidate.fieldId === fieldId);
        return entry ? entry.value : "";
      }

      function isDark(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 < 120;
      }

      function applyTheme() {
        const dark = isDark(spec.theme.background);
        const root = document.documentElement;
        root.style.setProperty("--accent", spec.theme.accent);
        root.style.setProperty("--app-bg", spec.theme.background);
        if (dark) {
          root.style.colorScheme = "dark";
          root.style.setProperty("--surface", "#172033");
          root.style.setProperty("--surface-2", "#1d283c");
          root.style.setProperty("--ink", "#f3f5fb");
          root.style.setProperty("--muted", "#aab3c3");
          root.style.setProperty("--line", "#303b50");
          root.style.setProperty("--soft", "color-mix(in srgb, var(--accent) 17%, transparent)");
        }
      }

      function formatValue(field, value) {
        if (value === "" || value === null || value === undefined) return "—";
        if (field.type === "number") return new Intl.NumberFormat(isZh ? "zh-CN" : "en-US", { maximumFractionDigits: 2 }).format(Number(value));
        if (field.type === "checkbox") return value ? copy.yes : copy.no;
        return String(value);
      }

      function filteredRecords() {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        return records.filter((record) => {
          const values = valueMap(record);
          const matchesQuery = !normalizedQuery || spec.fields.some((field) => String(values[field.id] ?? "").toLocaleLowerCase().includes(normalizedQuery));
          const matchesFilter = !filterValue || String(values[spec.features.filterField] ?? "") === filterValue;
          return matchesQuery && matchesFilter;
        });
      }

      function statCard(label, value) {
        const card = element("article", "stat");
        card.append(element("span", "stat-label", label), element("strong", "stat-value", value));
        return card;
      }

      function renderStats(visible) {
        if (!spec.features.stats) {
          statsRoot.hidden = true;
          return;
        }
        statsRoot.hidden = false;
        statsRoot.replaceChildren();
        statsRoot.append(statCard(copy.total, records.length), statCard(copy.visible, visible.length));
        const checkboxField = spec.fields.find((field) => field.type === "checkbox");
        const numberField = spec.fields.find((field) => field.type === "number");
        if (checkboxField) {
          const count = records.filter((record) => fieldValue(record, checkboxField.id) === true).length;
          statsRoot.append(statCard(copy.done, count));
        } else if (numberField) {
          const total = records.reduce((sum, record) => sum + Number(fieldValue(record, numberField.id) || 0), 0);
          statsRoot.append(statCard(copy.value, new Intl.NumberFormat(isZh ? "zh-CN" : "en-US", { maximumFractionDigits: 2 }).format(total)));
        } else {
          const unique = spec.features.filterField ? new Set(records.map((record) => fieldValue(record, spec.features.filterField)).filter(Boolean)).size : spec.fields.length;
          statsRoot.append(statCard(copy.categories, unique));
        }
      }

      function checkboxDisplay(value) {
        const wrap = element("span", "check" + (value ? " is-checked" : ""));
        wrap.append(element("span", "check-dot", value ? "✓" : ""), element("span", "", value ? copy.yes : copy.no));
        return wrap;
      }

      function valueDisplay(field, value, primary) {
        if (field.type === "select" && value) return element("span", "badge", formatValue(field, value));
        if (field.type === "checkbox") return checkboxDisplay(Boolean(value));
        return element("span", "cell-text" + (primary ? " cell-primary" : ""), formatValue(field, value));
      }

      function actionButtons(record) {
        const actions = element("div", "row-actions");
        const edit = element("button", "secondary", copy.edit);
        edit.type = "button";
        edit.addEventListener("click", () => openEditor(record.id));
        const remove = element("button", "danger", copy.remove);
        remove.type = "button";
        remove.addEventListener("click", () => removeRecord(record.id));
        actions.append(edit, remove);
        return actions;
      }

      function renderTable(visible) {
        const scroll = element("div", "table-scroll");
        const table = document.createElement("table");
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const field of spec.fields) headRow.append(element("th", "", field.label));
        const actionHead = element("th", "", copy.actions);
        actionHead.style.textAlign = "right";
        headRow.append(actionHead);
        head.append(headRow);
        const body = document.createElement("tbody");
        for (const record of visible) {
          const row = document.createElement("tr");
          spec.fields.forEach((field, index) => {
            const cell = document.createElement("td");
            cell.append(valueDisplay(field, fieldValue(record, field.id), index === 0));
            row.append(cell);
          });
          const actionCell = document.createElement("td");
          actionCell.append(actionButtons(record));
          row.append(actionCell);
          body.append(row);
        }
        table.append(head, body);
        scroll.append(table);
        recordsRoot.append(scroll);
      }

      function renderCards(visible) {
        const cards = element("div", "cards");
        const primaryField = spec.fields[0];
        for (const record of visible) {
          const card = element("article", "card");
          card.append(element("h2", "card-title", formatValue(primaryField, fieldValue(record, primaryField.id))));
          const grid = element("div", "card-grid");
          for (const field of spec.fields.slice(1)) {
            const item = element("div", "card-field");
            item.append(element("span", "card-label", field.label));
            const display = valueDisplay(field, fieldValue(record, field.id), false);
            if (!display.classList.contains("badge") && !display.classList.contains("check")) display.classList.add("card-value");
            item.append(display);
            grid.append(item);
          }
          const actions = actionButtons(record);
          actions.className = "card-actions";
          card.append(grid, actions);
          cards.append(card);
        }
        recordsRoot.append(cards);
      }

      function renderEmpty() {
        const empty = element("div", "empty");
        const content = element("div", "");
        content.append(element("div", "empty-icon", "✦"), element("h2", "", copy.emptyTitle), element("p", "", copy.emptyBody));
        const button = element("button", "primary", copy.add + " " + spec.entityName);
        button.type = "button";
        button.addEventListener("click", () => openEditor(null));
        content.append(button);
        empty.append(content);
        recordsRoot.append(empty);
      }

      function renderAll() {
        const visible = filteredRecords();
        recordsRoot.replaceChildren();
        renderStats(visible);
        byId("result-count").textContent = visible.length + " " + copy.records;
        if (visible.length === 0) renderEmpty();
        else if (spec.layout === "cards") renderCards(visible);
        else renderTable(visible);
      }

      function createInput(field, currentValue) {
        if (field.type === "select") {
          const select = element("select", "form-control");
          if (!field.required) {
            const blank = element("option", "", "—");
            blank.value = "";
            select.append(blank);
          }
          for (const value of field.options) {
            const option = element("option", "", value);
            option.value = value;
            select.append(option);
          }
          select.value = currentValue === undefined ? "" : String(currentValue);
          return select;
        }
        if (field.type === "textarea") {
          const textarea = element("textarea", "form-control");
          textarea.maxLength = 2000;
          textarea.value = currentValue === undefined ? "" : String(currentValue);
          return textarea;
        }
        const input = element("input", "form-control");
        input.type = field.type === "number" || field.type === "date" ? field.type : "text";
        if (field.type === "number") input.step = "any";
        else input.maxLength = 500;
        input.value = currentValue === undefined ? "" : String(currentValue);
        return input;
      }

      function openEditor(id) {
        editingId = id;
        const current = records.find((record) => record.id === id);
        const values = current ? valueMap(current) : Object.create(null);
        formFields.replaceChildren();
        byId("dialog-title").textContent = (current ? copy.update : copy.create) + " " + spec.entityName;
        byId("cancel-button").textContent = copy.cancel;
        byId("save-button").textContent = copy.save;

        for (const field of spec.fields) {
          const wrap = element("div", "form-field" + (field.type === "textarea" ? " is-wide" : "") + (field.type === "checkbox" ? " is-checkbox" : ""));
          if (field.type === "checkbox") {
            const label = element("label", "checkbox-label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.name = field.id;
            input.checked = Boolean(values[field.id]);
            label.append(input, document.createTextNode(field.label));
            wrap.append(label);
          } else {
            const label = element("label", "form-label", field.label);
            label.htmlFor = "field-" + field.id;
            if (field.required) label.append(element("span", "required", "*"));
            const input = createInput(field, values[field.id]);
            input.id = "field-" + field.id;
            input.name = field.id;
            input.required = field.required;
            if (field.placeholder) input.placeholder = field.placeholder;
            wrap.append(label, input);
          }
          formFields.append(wrap);
        }

        modal.hidden = false;
        document.body.style.overflow = "hidden";
        const firstInput = form.querySelector("input:not([type=checkbox]), textarea, select");
        if (firstInput) setTimeout(() => firstInput.focus(), 0);
      }

      function closeEditor() {
        modal.hidden = true;
        editingId = null;
        document.body.style.overflow = "";
      }

      function notifyChange() {
        const snapshot = records.map((record) => ({ id: record.id, values: record.values.map((entry) => ({ fieldId: entry.fieldId, value: entry.value })) }));
        window.parent.postMessage({ source: "forge-preview", type: "records-change", projectId, records: snapshot }, "*");
      }

      function showToast(message) {
        const toast = byId("toast");
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
      }

      function removeRecord(id) {
        if (!window.confirm(copy.deleteQuestion)) return;
        records = records.filter((record) => record.id !== id);
        notifyChange();
        renderAll();
        showToast(copy.deleted);
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const wasEditing = Boolean(editingId);
        const values = [];
        for (const field of spec.fields) {
          const input = form.elements.namedItem(field.id);
          let value;
          if (field.type === "checkbox") value = Boolean(input.checked);
          else {
            const raw = input.value;
            if (raw === "" && !field.required) continue;
            value = field.type === "number" ? Number(raw) : raw;
          }
          values.push({ fieldId: field.id, value });
        }
        if (editingId) {
          records = records.map((record) => record.id === editingId ? { id: record.id, values } : record);
        } else {
          const id = "record-" + Date.now().toString(36) + "-" + (recordCounter++).toString(36);
          records = [{ id, values }, ...records];
        }
        notifyChange();
        closeEditor();
        renderAll();
        showToast(wasEditing ? copy.updated : copy.created);
      });

      addButton.addEventListener("click", () => openEditor(null));
      byId("close-modal").addEventListener("click", closeEditor);
      byId("cancel-button").addEventListener("click", closeEditor);
      modal.addEventListener("click", (event) => { if (event.target === modal) closeEditor(); });
      document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeEditor(); });
      searchInput.addEventListener("input", () => { query = searchInput.value; renderAll(); });
      filterSelect.addEventListener("change", () => { filterValue = filterSelect.value; renderAll(); });

      applyTheme();
      document.documentElement.lang = isZh ? "zh-CN" : "en";
      document.title = spec.title;
      byId("entity-kicker").textContent = copy.collection;
      byId("app-title").textContent = spec.title;
      byId("app-description").textContent = spec.description;
      byId("add-label").textContent = copy.add + " " + spec.entityName;
      searchInput.placeholder = copy.search;
      byId("search-wrap").hidden = !spec.features.search;

      const filterField = spec.fields.find((field) => field.id === spec.features.filterField);
      if (filterField) {
        const all = element("option", "", copy.all + " " + filterField.label);
        all.value = "";
        filterSelect.append(all);
        for (const value of filterField.options) {
          const option = element("option", "", value);
          option.value = value;
          filterSelect.append(option);
        }
      } else {
        byId("filter-wrap").hidden = true;
      }
      if (!spec.features.search && !filterField) byId("toolbar").classList.add("is-minimal");
      renderAll();
      window.parent.postMessage({ source: "forge-preview", type: "preview-ready", projectId }, "*");
    })();
  </script>
</body>
</html>`;
}
