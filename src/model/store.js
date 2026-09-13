// localStorage 持久化：写入前留快照，损坏时自动回退
import { SCHEMA_VERSION } from "./constants.js";
import { emptyData, normalizeOrder } from "./workflow.js";
import { parseBackup, serializeBackup, BackupError, hasValidShape } from "./backup.js";
import { makeId } from "./util.js";

const SNAPSHOT_LIMIT = 10;

// 内存版存储，供测试与无 localStorage 环境使用
export class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

export class Store {
  constructor(options = {}) {
    this.storage = options.storage ?? (globalThis.localStorage || new MemoryStorage());
    this.dataKey = options.dataKey ?? "prd:data:v1";
    this.snapshotKey = options.snapshotKey ?? "prd:snapshots:v1";
    this.snapshotLimit = options.snapshotLimit ?? SNAPSHOT_LIMIT;
  }

  normalize(data) {
    const base = emptyData();
    const merged = {
      ...base,
      ...data,
      buildings: data.buildings ?? [],
      rooms: data.rooms ?? [],
      devices: data.devices ?? [],
      workers: data.workers ?? [],
      orders: (data.orders ?? []).map(normalizeOrder),
      settings: { ...base.settings, ...(data.settings ?? {}) }
    };
    merged.version = SCHEMA_VERSION;
    return merged;
  }

  // 读取：主数据损坏（无法解析或结构残缺）-> 依次尝试快照 -> 全不可用则空库
  load() {
    const raw = this.storage.getItem(this.dataKey);
    if (!raw) {
      return { data: this.normalize(emptyData()), source: "empty", error: null };
    }
    try {
      const data = parseMainData(raw);
      return { data: this.normalize(data), source: "live", error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rollback = this.restoreLatestSnapshot();
      if (rollback) {
        return {
          data: this.normalize(rollback.data),
          source: "snapshot",
          error: message,
          snapshotAt: rollback.savedAt
        };
      }
      return {
        data: this.normalize(emptyData()),
        source: "empty",
        error: message
      };
    }
  }

  // 保存：先把当前可用旧数据推进快照环，再写新数据
  save(data) {
    this.pushSnapshot();
    const text = JSON.stringify(data);
    this.storage.setItem(this.dataKey, text);
    return text;
  }

  snapshots() {
    try {
      const list = JSON.parse(this.storage.getItem(this.snapshotKey) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  pushSnapshot() {
    const raw = this.storage.getItem(this.dataKey);
    if (!raw) return;
    let data;
    try {
      data = parseMainData(raw);
    } catch {
      return; // 旧数据已损坏（解析失败或结构残缺），不入快照
    }
    const list = this.snapshots();
    list.push({ id: makeId(), savedAt: Date.now(), data });
    while (list.length > this.snapshotLimit) list.shift();
    this.storage.setItem(this.snapshotKey, JSON.stringify(list));
  }

  // 从最新到最旧逐个尝试，跳过损坏/结构残缺的快照，恢复最近一份完好快照
  restoreLatestSnapshot() {
    const list = this.snapshots();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      try {
        const snap = list[i];
        const data = parseMainData(JSON.stringify(snap?.data));
        this.storage.setItem(this.dataKey, JSON.stringify(data));
        return snap;
      } catch {
        // 该快照也坏了，试更早的
      }
    }
    return null;
  }

  // 手动回退到指定快照（按快照 id）。回退前先为当前主数据留一份快照，返回恢复的数据。
  rollback(snapshotId) {
    const list = this.snapshots();
    const snap = list.find((s) => s.id === snapshotId);
    if (!snap) throw new BackupError("快照不存在", "SNAPSHOT_NOT_FOUND");
    let target;
    try {
      target = parseMainData(JSON.stringify(snap.data));
    } catch {
      throw new BackupError("所选快照数据损坏，无法回退", "SNAPSHOT_CORRUPT");
    }
    this.pushSnapshot(); // 当前数据先留存，后悔了还能再回退回来
    this.storage.setItem(this.dataKey, JSON.stringify(target));
    return target;
  }

  exportBackup(data, now = Date.now()) {
    return serializeBackup(data, now);
  }

  importBackup(text) {
    const data = parseBackup(text); // 校验失败抛 BackupError
    this.save(this.normalize(data));
    return this.normalize(data);
  }

  clear() {
    this.storage.removeItem(this.dataKey);
    this.storage.removeItem(this.snapshotKey);
  }
}

// 主数据存的是裸 JSON（不是备份信封）。必须能解析且五个集合字段齐全，否则视为损坏。
function parseMainData(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("本地数据无法解析（JSON 损坏）");
  }
  if (!hasValidShape(parsed)) {
    throw new Error("本地数据结构不完整");
  }
  return parsed;
}
