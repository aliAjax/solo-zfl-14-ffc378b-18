// 页面共享视图工具：转义、下拉选项、时间格式化
import { escapeHtml } from "../model/util.js";
import { STATUS, STATUS_LABELS, PRIORITY_LABELS } from "../model/constants.js";

export { escapeHtml };

export function el(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function statusBadge(status) {
  return `<span class="badge status-${status}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}

export function priorityTag(priority) {
  return `<span class="badge priority-${priority}">${PRIORITY_LABELS[priority] || priority}</span>`;
}

export function options(list, { value = "id", label, selected = "", blank = "" } = {}) {
  const blankOpt = blank !== null ? `<option value="">${escapeHtml(blank)}</option>` : "";
  return (
    blankOpt +
    list
      .map((item) => {
        const v = typeof value === "function" ? value(item) : item[value];
        const text = label ? label(item) : String(v);
        return `<option value="${escapeHtml(v)}" ${String(v) === String(selected) ? "selected" : ""}>${escapeHtml(text)}</option>`;
      })
      .join("")
  );
}

// 页面内轻提示（成功/失败）
let toastTimer = null;
export function toast(message, type = "info") {
  let node = document.querySelector("#toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = `toast show toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}
