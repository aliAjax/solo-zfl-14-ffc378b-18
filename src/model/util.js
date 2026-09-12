// 通用工具函数

export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(value) {
  return `¥${round2(value).toFixed(2)}`;
}

let counter = 0;

export function makeId() {
  counter = (counter + 1) % 1e6;
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

// 输入用：<input type="datetime-local"> 的值（本地时间，不含时区）
export function toDatetimeLocalInput(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// 把 datetime-local 字符串解析为时间戳（按本地时区），非法值返回 null
export function parseLocalTime(value) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

// 月份键，例如 "2026-09"
export function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function currentMonthKey(now = Date.now()) {
  return monthKey(now);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clampNumber(value, min = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n;
}
