// 备份导出 / 导入校验 / 数据迁移
import { SCHEMA_VERSION, STATUS, PRIORITY } from "./constants.js";
import { emptyData } from "./workflow.js";

export class BackupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

const APP_NAME = "property-repair-desk";

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 结构校验：只验证整体形状与主键完整性，字段级清洗由 normalizeOrder 完成
export function validateData(parsed) {
  const errors = [];
  if (!isObject(parsed)) return { ok: false, errors: ["数据不是对象"] };

  const requireArray = (key) => {
    if (!Array.isArray(parsed[key])) errors.push(`缺少数组字段: ${key}`);
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  };

  const buildings = requireArray("buildings");
  const rooms = requireArray("rooms");
  const devices = requireArray("devices");
  const workers = requireArray("workers");
  const orders = requireArray("orders");

  const buildingIds = new Set(buildings.filter((b) => isObject(b)).map((b) => String(b.id)));
  const roomIds = new Set();
  const workerIds = new Set(workers.filter((w) => isObject(w)).map((w) => String(w.id)));
  const orderIds = new Set();

  buildings.forEach((b, i) => {
    if (!isObject(b) || !b.id || typeof b.name !== "string") errors.push(`buildings[${i}] 缺少 id/name`);
  });
  rooms.forEach((r, i) => {
    if (!isObject(r) || !r.id || typeof r.name !== "string") {
      errors.push(`rooms[${i}] 缺少 id/name`);
      return;
    }
    roomIds.add(String(r.id));
    if (r.buildingId && !buildingIds.has(String(r.buildingId))) {
      errors.push(`rooms[${i}] 引用了不存在的楼栋`);
    }
  });
  devices.forEach((d, i) => {
    if (!isObject(d) || !d.id || typeof d.name !== "string") errors.push(`devices[${i}] 缺少 id/name`);
  });
  workers.forEach((w, i) => {
    if (!isObject(w) || !w.id || typeof w.name !== "string") errors.push(`workers[${i}] 缺少 id/name`);
  });

  const validStatus = new Set(Object.values(STATUS));
  const validPriority = new Set(Object.values(PRIORITY));
  orders.forEach((o, i) => {
    if (!isObject(o) || !o.id) {
      errors.push(`orders[${i}] 缺少 id`);
      return;
    }
    if (orderIds.has(o.id)) errors.push(`orders[${i}] id 重复`);
    orderIds.add(String(o.id));
    if (typeof o.title !== "string") errors.push(`orders[${i}] 缺少 title`);
    if (!validStatus.has(o.status)) errors.push(`orders[${i}] 状态非法: ${o.status}`);
    if (o.priority && !validPriority.has(o.priority)) errors.push(`orders[${i}] 优先级非法`);
    if (o.roomId && !roomIds.has(String(o.roomId))) errors.push(`orders[${i}] 引用了不存在的房间`);
    if (o.assigneeId && !workerIds.has(String(o.assigneeId))) errors.push(`orders[${i}] 引用了不存在的维修人`);
  });

  if (parsed.settings !== undefined && !isObject(parsed.settings)) errors.push("settings 必须是对象");

  return { ok: errors.length === 0, errors };
}

// 版本迁移（目前只有 v1，后续版本在这里加 upgrade 链）
export function migrate(parsed) {
  let data = parsed;
  const from = Number(data?.version ?? 1);
  if (!Number.isFinite(from) || from > SCHEMA_VERSION) {
    throw new BackupError(`不支持的数据版本: ${data?.version}`, "UNSUPPORTED_VERSION");
  }
  // v0（无版本号的旧数据）-> v1：旧结构没有楼栋/房间概念，直接按空库处理但保留工单字段
  if (!("version" in data)) {
    const base = emptyData();
    base.version = SCHEMA_VERSION;
    data = { ...base, ...data, version: SCHEMA_VERSION };
  }
  return data;
}

// 极简校验和：检测导出文件被截断/手改
function checksum(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export function serializeBackup(data, now = Date.now()) {
  const payload = JSON.stringify(data);
  const envelope = {
    app: APP_NAME,
    format: "backup",
    version: SCHEMA_VERSION,
    exportedAt: now,
    checksum: checksum(payload),
    data: JSON.parse(payload)
  };
  return JSON.stringify(envelope, null, 2);
}

// 兼容两种导入：备份信封 {app, data} 或裸数据对象
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("文件不是合法的 JSON", "BAD_JSON");
  }
  let raw = parsed;
  if (isObject(parsed) && parsed.app === APP_NAME && "data" in parsed) {
    const payload = JSON.stringify(parsed.data);
    if (parsed.checksum && parsed.checksum !== checksum(payload)) {
      throw new BackupError("备份校验和不一致，文件可能已损坏", "CHECKSUM_MISMATCH");
    }
    raw = parsed.data;
  }
  if (!isObject(raw)) throw new BackupError("备份内容格式不正确", "BAD_SHAPE");
  const data = migrate(raw);
  const { ok, errors } = validateData(data);
  if (!ok) throw new BackupError(`备份数据校验失败：${errors.join("；")}`, "INVALID_DATA");
  return data;
}
