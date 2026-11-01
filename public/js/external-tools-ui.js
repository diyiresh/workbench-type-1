import { esc } from "./core.js";
import { t as tr, ui } from "./i18n.js";

let draft = null;
let skipCapture = false;

export function filterLabel(id) {
  if (id === "all") return tr("全部工具");
  if (id === "media") return tr("绘图视频");
  if (id === "workspace") return tr("工作区");
  if (id === "audio") return tr("音频");
  if (id === "stack") return tr("模型容器");
  if (id === "dev") return tr("开发工具");
  if (id === "desktop") return tr("本机软件");
  if (id === "pending") return tr("待核");
  return id;
}

export function toolPending(tool) {
  return tool.confidence === "low" || tool.status === "pending" || tool.status === "review";
}

export function toolDraft() {
  return draft;
}

export function editTool(tool, revision) {
  draft = {
    id: tool.id,
    expectedRevision: revision,
    name: tool.name,
    category: tool.category,
    confidence: tool.confidence,
    status: tool.status,
    location: tool.location || "",
    note: tool.note || "",
    actions: tool.actions.length ? tool.actions.map((action) => ({ ...action, target: action.target || "", cwd: action.cwd || "", command: action.command || "npm-run-dev" })) : [blankAction()],
  };
  skipCapture = true;
}

export function clearToolDraft() {
  draft = null;
  skipCapture = true;
}

export function addToolAction() {
  const form = document.getElementById("tool-editor");
  const next = form ? readToolForm(form) : (draft || blankTool(0));
  if (next.actions.length >= 8) return;
  next.actions.push(blankAction());
  draft = next;
  skipCapture = true;
}

export function captureToolForm() {
  if (skipCapture) {
    skipCapture = false;
    return;
  }
  const form = document.getElementById("tool-editor");
  if (form) draft = readToolForm(form);
}

function blankAction() {
  return { id: "", kind: "open-folder", target: "", command: "npm-run-dev", cwd: "" };
}

function blankTool(revision) {
  return { id: "", expectedRevision: revision, name: "", category: "dev", confidence: "high", status: "ready", location: "", note: "", actions: [blankAction()] };
}

export function readToolForm(form) {
  const actions = [...form.querySelectorAll("[data-action-row]")].map((row) => ({
    id: row.querySelector("[name=actionId]").value.trim(),
    kind: row.querySelector("[name=kind]").value,
    target: row.querySelector("[name=target]").value.trim(),
    command: row.querySelector("[name=command]").value,
    cwd: row.querySelector("[name=cwd]").value.trim(),
  })).filter((action) => (action.kind === "command" ? action.cwd : action.target));
  return {
    id: form.dataset.toolId || "",
    expectedRevision: Number(form.dataset.revision || 0),
    name: form.querySelector("[name=name]").value.trim(),
    category: form.querySelector("[name=category]").value,
    confidence: form.querySelector("[name=confidence]").value,
    status: form.querySelector("[name=status]").value,
    location: form.querySelector("[name=location]").value.trim(),
    note: form.querySelector("[name=note]").value.trim(),
    actions,
  };
}

function actionText(action) {
  if (action.kind === "open-folder") return tr("打开文件夹");
  if (action.kind === "open-url") {
    try { return `${tr("打开地址")} · ${new URL(action.target).port}`; } catch { return tr("打开地址"); }
  }
  if (action.kind === "command") {
    if (action.command === "npm-run-dev") return tr("npm run dev");
    if (action.command === "npm-start") return tr("npm start");
    if (action.command === "pnpm-dev") return tr("pnpm dev");
    if (action.command === "docker-compose-up") return tr("docker compose up -d");
    return tr("运行已登记命令");
  }
  const file = String(action.target || "").split("\\").pop();
  return `${action.kind === "open-file" ? tr("打开文件") : tr("启动")} · ${file}`;
}

function chip(tool) {
  if (toolPending(tool)) return `<span class="chip pending">${esc(tr("待核"))}</span>`;
  if (tool.confidence === "medium") return `<span class="chip">${esc(tr("置信度中"))}</span>`;
  return `<span class="chip ok">${esc(tr("置信度高"))}</span>`;
}

function visibleTools(catalog, filter) {
  const tools = catalog?.tools || [];
  if (filter === "pending") return tools.filter(toolPending);
  if (["media", "workspace", "audio", "stack", "dev", "desktop"].includes(filter)) return tools.filter((tool) => tool.category === filter);
  if (filter && filter !== "all") return tools.filter((tool) => tool.id === filter);
  return tools;
}

function option(value, label, selected) {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

function actionRow(action) {
  const command = action.kind === "command";
  return `<div class="action-row" data-action-row>
    <input type="hidden" name="actionId" value="${esc(action.id || "")}" />
    <select name="kind" aria-label="${esc(tr("动作类型"))}">
      ${option("open-folder", tr("打开文件夹"), action.kind === "open-folder")}
      ${option("open-file", tr("打开文件"), action.kind === "open-file")}
      ${option("start-file", tr("启动文件"), action.kind === "start-file")}
      ${option("open-url", tr("打开地址"), action.kind === "open-url")}
      ${option("command", tr("已登记命令"), action.kind === "command")}
    </select>
    <select name="command" aria-label="${esc(tr("命令"))}"${command ? "" : " hidden"}>
      ${option("npm-run-dev", "npm run dev", action.command === "npm-run-dev")}
      ${option("npm-start", "npm start", action.command === "npm-start")}
      ${option("pnpm-dev", "pnpm dev", action.command === "pnpm-dev")}
      ${option("docker-compose-up", "docker compose up -d", action.command === "docker-compose-up")}
    </select>
    <input name="target" aria-label="${esc(tr("路径或地址"))}" value="${esc(action.target || "")}" placeholder="${esc(tr("路径或本机地址"))}"${command ? " hidden" : ""} />
    <input name="cwd" aria-label="${esc(tr("命令目录"))}" value="${esc(action.cwd || "")}" placeholder="${esc(tr("命令所在目录"))}"${command ? "" : " hidden"} />
  </div>`;
}

export function toolsView(catalog, filter) {
  if (!catalog) return ui`<p class="k">正在读取本机工具清单…</p>`;
  if (catalog.error) return ui`<p class="k">工具清单读取失败：${esc(catalog.error)}</p>`;
  const current = draft || blankTool(catalog.revision);
  const tools = visibleTools(catalog, filter);
  const cards = tools.map((tool) => `<article class="card tool-card" data-tool="${esc(tool.id)}">
      <div class="k">TOOL · ${esc(filterLabel(tool.category))}</div>
      <div class="h">${esc(tool.name)}</div>
      ${tool.location ? `<p class="tool-path">${esc(tool.location)}</p>` : ""}
      ${tool.note ? `<p>${esc(tool.note)}</p>` : ""}
      <div class="meta">${chip(tool)}${tool.source === "local" ? `<span class="chip">${esc(tr("本机修改"))}</span>` : ""}</div>
      <div class="tool-actions">${tool.actions.map((action) => `<button type="button" class="solid" data-act="tool-launch" data-tool-id="${esc(tool.id)}" data-action-id="${esc(action.id)}">${esc(actionText(action))}</button>`).join("") || `<span class="k">${esc(tr("没有可启动的动作。"))}</span>`}</div>
      <p class="tool-receipt" role="status"></p>
      <button type="button" class="ghost" data-act="tool-edit" data-tool-id="${esc(tool.id)}">${esc(tr("编辑工具"))}</button>
    </article>`).join("");
  const categories = ["media", "workspace", "audio", "stack", "dev", "desktop"];
  return `<div class="tool-grid">${cards || ui`<p class="k">这一类还没有工具。</p>`}</div>
    <form id="tool-editor" class="card tool-editor" data-tool-id="${esc(current.id || "")}" data-revision="${esc(String(catalog.revision))}">
      <div class="k">TOOL · ${esc(tr("清单"))}</div>
      <h2>${esc(current.id ? tr("编辑工具") : tr("添加工具"))}</h2>
      <p>${esc(tr("种子清单在 config/external-tools.json。你改过的条目写在 data/external-tools.json，刷新后生效。"))}</p>
      <p>${esc(tr("置信度为低或标为待核且不保留动作时，不保存启动动作。"))}</p>
      <label>${esc(tr("名称"))}</label>
      <input name="name" required value="${esc(current.name || "")}" />
      <div class="form-two">
        <label>${esc(tr("类别"))}<select name="category">${categories.map((id) => option(id, filterLabel(id), current.category === id)).join("")}</select></label>
        <label>${esc(tr("置信度"))}<select name="confidence">
          ${option("high", tr("置信度高"), current.confidence === "high")}
          ${option("medium", tr("置信度中"), current.confidence === "medium")}
          ${option("low", tr("置信度低"), current.confidence === "low")}
        </select></label>
      </div>
      <label>${esc(tr("状态"))}<select name="status">
        ${option("ready", tr("可启动"), current.status === "ready")}
        ${option("review", tr("待核但保留已登记动作"), current.status === "review")}
        ${option("pending", tr("待核不保存动作"), current.status === "pending")}
      </select></label>
      <label>${esc(tr("路径或仓库"))}</label>
      <input name="location" value="${esc(current.location || "")}" />
      <label>${esc(tr("备注"))}</label>
      <textarea name="note" rows="3">${esc(current.note || "")}</textarea>
      <div class="k">${esc(tr("动作"))}</div>
      ${(current.actions.length ? current.actions : [blankAction()]).map(actionRow).join("")}
      <div class="actions">
        <button type="button" class="ghost" data-act="tool-add-action">${esc(tr("再加一个动作"))}</button>
        <button type="button" class="solid" data-act="tool-save">${esc(tr("保存到本机清单"))}</button>
        ${current.id ? `<button type="button" class="ghost" data-act="tool-delete" data-tool-id="${esc(current.id)}">${esc(tr("从清单移除"))}</button>` : ""}
        ${current.id ? `<button type="button" class="ghost" data-act="tool-cancel">${esc(tr("取消编辑"))}</button>` : ""}
      </div>
    </form>`;
}

export function bindToolEditor(root = document) {
  root.querySelectorAll("#tool-editor [data-action-row] select[name=kind]").forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest("[data-action-row]");
      const command = select.value === "command";
      row.querySelector("[name=command]").hidden = !command;
      row.querySelector("[name=cwd]").hidden = !command;
      row.querySelector("[name=target]").hidden = command;
    });
  });
}
