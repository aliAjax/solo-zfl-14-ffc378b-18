// 测试辅助：快速搭建一套可操作的应用数据
import { Store, MemoryStorage } from "../src/model/store.js";
import { Repo } from "../src/model/repo.js";
import { emptyData } from "../src/model/workflow.js";

export const T_NOW = new Date("2026-09-12T10:00:00").getTime();
export const HOUR = 3600_000;

export function localInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function setupRepo({ now = T_NOW, storage = new MemoryStorage(), budget = 20000, hourlyRate = 80 } = {}) {
  let clock = now;
  const repo = new Repo({ storage, now: () => clock });
  // Repo 空库时直接重写数据，不经过首次种子逻辑（种子只在 UI main.js 中发生）
  repo.data = repo.store.normalize(emptyData());
  repo.data.settings.monthlyBudget = budget;
  repo.data.settings.defaultHourlyRate = hourlyRate;

  const building = repo.createBuilding({ name: "1栋" });
  const building2 = repo.createBuilding({ name: "2栋" });
  const room1 = repo.createRoom({ buildingId: building.id, name: "301" });
  const room2 = repo.createRoom({ buildingId: building.id, name: "502" });
  const room3 = repo.createRoom({ buildingId: building2.id, name: "101" });
  repo.createDevice({ name: "空调", defaultPrice: 300 });
  const w1 = repo.createWorker({ name: "张师傅", trade: "水电" });
  const w2 = repo.createWorker({ name: "陈师傅", trade: "综合" });

  const tick = (ms = 1000) => { clock += ms; return clock; };
  const resetClock = (t = now) => { clock = t; };

  return { repo, storage, ids: { building: building.id, building2: building2.id, room1: room1.id, room2: room2.id, room3: room3.id, w1: w1.id, w2: w2.id }, tick, resetClock, get now() { return clock; } };
}

export function createStore(storage) {
  return new Store({ storage: storage ?? new MemoryStorage() });
}

// 创建工单的简写
export function makeOrder(repo, roomId, patch = {}) {
  return repo.createOrderDraft({
    roomId,
    title: patch.title || "测试故障",
    priority: patch.priority || "medium",
    budget: patch.budget ?? 0,
    visitAt: patch.visitAt ?? localInput(T_NOW + HOUR),
    hourlyRate: patch.hourlyRate
  });
}

export async function expectThrowsAsync(fn, code) {
  let threw = null;
  try {
    await fn();
  } catch (err) {
    threw = err;
  }
  if (!threw) throw new Error("期望抛错但没有");
  if (code && threw.code !== code) throw new Error(`期望错误码 ${code}，实际 ${threw.code} (${threw.message})`);
  return threw;
}
