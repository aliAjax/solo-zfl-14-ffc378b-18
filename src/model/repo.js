// 应用状态仓库：所有写操作经这里落库并通知订阅者
import { Store } from "./store.js";
import { PRIORITY } from "./constants.js";
import {
  createOrder,
  dispatchOrder,
  transition,
  applyWorkReport,
  nextOrderCode,
  normalizeOrder,
  WorkflowError
} from "./workflow.js";
import { orderCosts } from "./calc.js";
import {
  addBuilding,
  addRoom,
  addDevice,
  addWorker,
  removeBuilding,
  removeRoom,
  removeDevice,
  removeWorker
} from "./registries.js";
import { deepClone, parseLocalTime, round2, clampNumber } from "./util.js";

export class Repo {
  constructor(options = {}) {
    this.store = options.store ?? new Store(options);
    this.now = options.now ?? (() => Date.now());
    const loaded = this.store.load();
    this.data = loaded.data;
    this.loadInfo = loaded;
    this.listeners = new Set();
    this._submitting = new Set(); // 进行中的提交，防双击/重复提交
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  persist() {
    this.store.save(this.data);
    this.emit();
  }

  // 防重复提交包装：同一 key 的异步操作未结束前拒绝再次进入
  async withSubmitLock(key, fn) {
    if (this._submitting.has(key)) {
      throw new WorkflowError("正在处理，请勿重复提交", "DUPLICATE_SUBMIT");
    }
    this._submitting.add(key);
    try {
      return await fn();
    } finally {
      this._submitting.delete(key);
    }
  }

  isSubmitting(key) {
    return this._submitting.has(key);
  }

  // ---- 登记 ----
  createBuilding(input) {
    const item = addBuilding(this.data, input);
    this.persist();
    return item;
  }

  createRoom(input) {
    const item = addRoom(this.data, input);
    this.persist();
    return item;
  }

  createDevice(input) {
    const item = addDevice(this.data, input);
    this.persist();
    return item;
  }

  createWorker(input) {
    const item = addWorker(this.data, input);
    this.persist();
    return item;
  }

  deleteBuilding(id) {
    removeBuilding(this.data, id);
    this.persist();
  }

  deleteRoom(id) {
    removeRoom(this.data, id);
    this.persist();
  }

  deleteDevice(id) {
    removeDevice(this.data, id);
    this.persist();
  }

  deleteWorker(id) {
    removeWorker(this.data, id);
    this.persist();
  }

  updateSettings(input = {}) {
    if (input.defaultHourlyRate !== undefined) {
      this.data.settings.defaultHourlyRate = Number(input.defaultHourlyRate) || 0;
    }
    if (input.monthlyBudget !== undefined) {
      this.data.settings.monthlyBudget = Number(input.monthlyBudget) || 0;
    }
    this.persist();
  }

  // ---- 工单 ----
  createOrderDraft(input = {}) {
    const now = this.now();
    const order = createOrder(
      { ...input, hourlyRate: input.hourlyRate ?? this.data.settings.defaultHourlyRate },
      { now }
    );
    order.code = nextOrderCode(this.data.orders);
    this.data.orders.unshift(order);
    this.persist();
    return order;
  }

  deleteOrder(id) {
    this.data.orders = this.data.orders.filter((o) => o.id !== id);
    this.persist();
  }

  dispatch(id, payload) {
    const order = dispatchOrder(this.data, id, payload, { now: this.now() });
    this.persist();
    return order;
  }

  advance(id, to, payload = {}) {
    const order = transition(this.data, id, to, payload, { now: this.now() });
    this.persist();
    return order;
  }

  // 验收不通过退回已接单
  rejectVerification(id, note) {
    const order = transition(this.data, id, "accepted", { note }, { now: this.now() });
    this.persist();
    return order;
  }

  saveWorkReport(id, payload) {
    const order = this.data.orders.find((o) => o.id === id);
    if (!order) throw new WorkflowError("工单不存在", "NOT_FOUND");
    applyWorkReport(order, payload);
    order.updatedAt = this.now();
    this.persist();
    return order;
  }

  editOrder(id, patch = {}) {
    const order = this.data.orders.find((o) => o.id === id);
    if (!order) throw new WorkflowError("工单不存在", "NOT_FOUND");
    if (order.status !== "pending") {
      throw new WorkflowError("只有待派单工单可以编辑", "INVALID_STATUS");
    }
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new WorkflowError("问题描述不能为空", "INVALID_TITLE");
      order.title = title;
    }
    if (patch.description !== undefined) order.description = String(patch.description).trim();
    if (patch.priority !== undefined) {
      if (!Object.values(PRIORITY).includes(patch.priority)) {
        throw new WorkflowError("优先级非法", "INVALID_PRIORITY");
      }
      order.priority = patch.priority;
    }
    if (patch.deviceId !== undefined) order.deviceId = String(patch.deviceId || "");
    if (patch.visitAt !== undefined) {
      order.visitAt = parseLocalTime(patch.visitAt);
    }
    if (patch.budget !== undefined) {
      order.budget = round2(clampNumber(patch.budget));
    }
    order.updatedAt = this.now();
    Object.assign(order, orderCosts(order));
    this.persist();
    return order;
  }

  // ---- 备份 ----
  exportBackup() {
    return this.store.exportBackup(this.data, this.now());
  }

  importBackup(text) {
    const imported = this.store.importBackup(text);
    this.data = imported;
    this.emit();
    return imported;
  }

  listSnapshots() {
    return this.store.snapshots();
  }

  rollback(snapshotId) {
    const data = this.store.rollback(snapshotId);
    this.data = this.store.normalize(data);
    this.data.orders.forEach((o) => normalizeOrder(o));
    this.emit();
    return this.data;
  }

  snapshotClone() {
    return deepClone(this.data);
  }
}
