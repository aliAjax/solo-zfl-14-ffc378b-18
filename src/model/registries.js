// 楼栋 / 房间 / 设备 / 维修人 的登记与查找
import { makeId } from "./util.js";
import { WorkflowError } from "./workflow.js";

export function addBuilding(state, input) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new WorkflowError("楼栋名称不能为空", "INVALID_NAME");
  if (state.buildings.some((b) => b.name === name)) {
    throw new WorkflowError("楼栋已存在", "DUPLICATE_NAME");
  }
  const building = { id: makeId(), name, note: String(input?.note ?? "").trim() };
  state.buildings.push(building);
  return building;
}

export function addRoom(state, input) {
  const name = String(input?.name ?? "").trim();
  const buildingId = String(input?.buildingId ?? "");
  if (!name) throw new WorkflowError("房间号不能为空", "INVALID_NAME");
  if (!state.buildings.some((b) => b.id === buildingId)) {
    throw new WorkflowError("必须先选择楼栋", "NO_BUILDING");
  }
  if (state.rooms.some((r) => r.buildingId === buildingId && r.name === name)) {
    throw new WorkflowError("该楼栋下房间已存在", "DUPLICATE_NAME");
  }
  const room = {
    id: makeId(),
    buildingId,
    name,
    ownerName: String(input?.ownerName ?? "").trim(),
    phone: String(input?.phone ?? "").trim()
  };
  state.rooms.push(room);
  return room;
}

export function addDevice(state, input) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new WorkflowError("设备名称不能为空", "INVALID_NAME");
  const device = {
    id: makeId(),
    name,
    brand: String(input?.brand ?? "").trim(),
    defaultPrice: Number.isFinite(Number(input?.defaultPrice)) ? Number(input.defaultPrice) : 0,
    note: String(input?.note ?? "").trim()
  };
  state.devices.push(device);
  return device;
}

export function addWorker(state, input) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new WorkflowError("维修人姓名不能为空", "INVALID_NAME");
  if (state.workers.some((w) => w.name === name)) {
    throw new WorkflowError("维修人已存在", "DUPLICATE_NAME");
  }
  const worker = {
    id: makeId(),
    name,
    phone: String(input?.phone ?? "").trim(),
    trade: String(input?.trade ?? "").trim() // 工种：水电、木工……
  };
  state.workers.push(worker);
  return worker;
}

// 删除楼栋会连带清理房间（房间上的工单保留 roomId 但显示为失效房间）
export function removeBuilding(state, id) {
  state.buildings = state.buildings.filter((b) => b.id !== id);
  const roomIds = new Set(state.rooms.filter((r) => r.buildingId === id).map((r) => r.id));
  state.rooms = state.rooms.filter((r) => r.buildingId !== id);
  return roomIds;
}

export function removeRoom(state, id) {
  state.rooms = state.rooms.filter((r) => r.id !== id);
}

export function removeDevice(state, id) {
  state.devices = state.devices.filter((d) => d.id !== id);
}

export function removeWorker(state, id) {
  state.workers = state.workers.filter((w) => w.id !== id);
}

export function findBuilding(state, id) {
  return state.buildings.find((b) => b.id === id) || null;
}

export function findRoom(state, id) {
  return state.rooms.find((r) => r.id === id) || null;
}

export function roomLabel(state, roomId) {
  const room = findRoom(state, roomId);
  if (!room) return "未知房间";
  const building = findBuilding(state, room.buildingId);
  return `${building ? building.name : "未知楼栋"} ${room.name}`;
}

export function findDevice(state, id) {
  return state.devices.find((d) => d.id === id) || null;
}

export function findWorker(state, id) {
  return state.workers.find((w) => w.id === id) || null;
}
