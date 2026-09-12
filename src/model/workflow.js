// 工单领域逻辑：创建、派单流转、防重复提交
import { STATUS, STATUS_FLOW, PRIORITY, UNFINISHED_STATUSES, SCHEMA_VERSION } from "./constants.js";
import { makeId, round2, clampNumber, parseLocalTime, currentMonthKey, deepClone } from "./util.js";
import { orderCosts } from "./calc.js";

export class WorkflowError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

// 时间戳归一化：null/空串/非法值 -> fallback（默认 null）
function toTs(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function canTransition(from, to) {
  return (STATUS_FLOW[from] || []).includes(to);
}

// 从输入构造一张工单（不落库），做基本清洗
export function createOrder(input = {}, options = {}) {
  const now = options.now ?? Date.now();
  const genId = options.genId ?? makeId;
  const title = String(input.title ?? "").trim();
  if (!title) throw new WorkflowError("问题描述不能为空", "INVALID_TITLE");

  const roomId = String(input.roomId ?? "");
  if (!roomId) throw new WorkflowError("必须选择房间", "INVALID_ROOM");

  const priority = Object.values(PRIORITY).includes(input.priority) ? input.priority : PRIORITY.MEDIUM;
  const visitAt = parseLocalTime(input.visitAt);
  const budget = round2(clampNumber(input.budget ?? 0));
  const hourlyRate = round2(clampNumber(input.hourlyRate ?? options.defaultHourlyRate ?? 0));
  const deviceId = input.deviceId ? String(input.deviceId) : "";
  const assigneeId = input.assigneeId ? String(input.assigneeId) : "";
  const description = String(input.description ?? "").trim();

  return normalizeOrder({
    id: genId(),
    code: "",
    roomId,
    deviceId,
    title,
    description,
    priority,
    status: STATUS.PENDING,
    assigneeId,
    visitAt,
    budget,
    hourlyRate,
    workHours: 0,
    materials: [],
    submitted: false, // 防止重复提交
    createdAt: now,
    updatedAt: now,
    acceptedAt: null,
    startedAt: null,
    submittedAt: null,
    verifiedAt: null,
    finishedAt: null,
    history: [{ at: now, status: STATUS.PENDING, note: "建单" }]
  });
}

// 清洗/补全一张工单（读取旧数据时使用）
export function normalizeOrder(raw = {}) {
  const now = raw.createdAt ?? Date.now();
  const order = {
    id: String(raw.id ?? makeId()),
    code: String(raw.code ?? ""),
    roomId: String(raw.roomId ?? ""),
    deviceId: String(raw.deviceId ?? ""),
    title: String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    priority: Object.values(PRIORITY).includes(raw.priority) ? raw.priority : PRIORITY.MEDIUM,
    status: Object.values(STATUS).includes(raw.status) ? raw.status : STATUS.PENDING,
    assigneeId: String(raw.assigneeId ?? ""),
    visitAt: toTs(raw.visitAt),
    budget: round2(clampNumber(raw.budget ?? 0)),
    hourlyRate: round2(clampNumber(raw.hourlyRate ?? 0)),
    workHours: round2(clampNumber(raw.workHours ?? 0)),
    materials: Array.isArray(raw.materials)
      ? raw.materials.map((m) => ({
          name: String(m?.name ?? "").trim(),
          qty: clampNumber(m?.qty ?? 0),
          price: round2(clampNumber(m?.price ?? 0))
        })).filter((m) => m.name)
      : [],
    submitted: Boolean(raw.submitted),
    createdAt: toTs(raw.createdAt, now),
    updatedAt: toTs(raw.updatedAt, now),
    acceptedAt: raw.acceptedAt ?? null,
    startedAt: raw.startedAt ?? null,
    submittedAt: raw.submittedAt ?? null,
    verifiedAt: raw.verifiedAt ?? null,
    finishedAt: raw.finishedAt ?? null,
    history: Array.isArray(raw.history) ? raw.history : [{ at: now, status: STATUS.PENDING, note: "" }]
  };
  return { ...order, ...orderCosts(order) };
}

export function nextOrderCode(orders) {
  const year = new Date().getFullYear();
  const prefix = `WX${year}`;
  let max = 0;
  for (const o of orders) {
    const m = /^WX\d{4}-(\d+)$/.exec(o.code || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

// 派单：待派单 -> 已接单，必须指定维修人
export function dispatchOrder(state, orderId, payload = {}, options = {}) {
  const now = options.now ?? Date.now();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new WorkflowError("工单不存在", "NOT_FOUND");
  if (order.status !== STATUS.PENDING) {
    throw new WorkflowError(`当前状态「${order.status}」不允许派单`, "INVALID_STATUS");
  }
  const assigneeId = String(payload.assigneeId ?? order.assigneeId ?? "");
  if (!assigneeId) throw new WorkflowError("派单必须指定维修人", "NO_ASSIGNEE");
  if (!state.workers.some((w) => w.id === assigneeId)) {
    throw new WorkflowError("维修人不存在", "ASSIGNEE_NOT_FOUND");
  }
  const visitAt = payload.visitAt !== undefined ? parseLocalTime(payload.visitAt) : order.visitAt;
  order.assigneeId = assigneeId;
  if (visitAt !== undefined) order.visitAt = visitAt;
  if (payload.hourlyRate !== undefined) order.hourlyRate = round2(clampNumber(payload.hourlyRate));
  if (payload.budget !== undefined) order.budget = round2(clampNumber(payload.budget));
  order.status = STATUS.ACCEPTED;
  order.acceptedAt = now;
  order.updatedAt = now;
  order.history.push({ at: now, status: STATUS.ACCEPTED, note: `派单给 ${assigneeId}` });
  return recompute(order);
}

// 通用状态推进；to 为目标状态
export function transition(state, orderId, to, payload = {}, options = {}) {
  const now = options.now ?? Date.now();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new WorkflowError("工单不存在", "NOT_FOUND");

  // 提交验收：拒绝重复提交（先于状态机判断，保证从待验收二次提交得到明确错误码）
  if (to === STATUS.ACCEPTING) {
    if (order.submitted) {
      throw new WorkflowError("该工单已提交验收，请勿重复提交", "DUPLICATE_SUBMIT");
    }
    if (!canTransition(order.status, to)) {
      throw new WorkflowError(`不允许从「${order.status}」提交验收`, "INVALID_TRANSITION");
    }
    applyWorkReport(order, payload);
    order.submitted = true;
    order.submittedAt = now;
  } else if (!canTransition(order.status, to)) {
    throw new WorkflowError(`不允许从「${order.status}」变为「${to}」`, "INVALID_TRANSITION");
  }

  if (to === STATUS.REPAIRING) {
    order.startedAt = order.startedAt ?? now;
  }

  if (to === STATUS.VERIFIED) {
    order.verifiedAt = now;
    order.finishedAt = now;
  }

  // 验收不通过 -> 退回已接单：解除提交锁，允许维修人重新处理后再次提交
  if (to === STATUS.ACCEPTED && order.status === STATUS.ACCEPTING) {
    order.submitted = false;
    order.history.push({ at: now, status: STATUS.ACCEPTED, note: `验收不通过退回：${String(payload.note ?? "")}`.trim() });
  } else {
    order.history.push({ at: now, status: to, note: String(payload.note ?? "") });
  }

  order.status = to;
  order.updatedAt = now;
  return recompute(order);
}

// 上报工时/耗材（维修中也可以随时保存，不影响状态）
export function applyWorkReport(order, payload = {}) {
  if (payload.workHours !== undefined) order.workHours = round2(clampNumber(payload.workHours));
  if (payload.hourlyRate !== undefined) order.hourlyRate = round2(clampNumber(payload.hourlyRate));
  if (payload.materials !== undefined) {
    if (!Array.isArray(payload.materials)) throw new WorkflowError("耗材格式不正确", "INVALID_MATERIALS");
    order.materials = payload.materials
      .map((m) => ({
        name: String(m?.name ?? "").trim(),
        qty: clampNumber(m?.qty ?? 0),
        price: round2(clampNumber(m?.price ?? 0))
      }))
      .filter((m) => m.name && m.qty > 0);
  }
  return recompute(order);
}

export function addMaterial(order, material) {
  const name = String(material?.name ?? "").trim();
  if (!name) throw new WorkflowError("耗材名称不能为空", "INVALID_MATERIAL");
  order.materials.push({ name, qty: clampNumber(material.qty ?? 1), price: round2(clampNumber(material.price ?? 0)) });
  return recompute(order);
}

export function removeMaterial(order, index) {
  if (!Number.isInteger(index) || index < 0 || index >= order.materials.length) {
    throw new WorkflowError("耗材条目不存在", "INVALID_MATERIAL");
  }
  order.materials.splice(index, 1);
  return recompute(order);
}

function recompute(order) {
  Object.assign(order, orderCosts(order));
  return order;
}

export function isOverdue(order, now = Date.now()) {
  if (!order.visitAt) return false;
  if (!UNFINISHED_STATUSES.includes(order.status)) return false;
  return order.visitAt < now;
}

export function isUnfinished(order) {
  return UNFINISHED_STATUSES.includes(order.status);
}

// 建空数据（新版本号）
export function emptyData() {
  return {
    version: SCHEMA_VERSION,
    buildings: [],
    rooms: [],
    devices: [],
    workers: [],
    orders: [],
    settings: { defaultHourlyRate: 80, monthlyBudget: 20000 },
    createdAt: Date.now()
  };
}

export { deepClone };
