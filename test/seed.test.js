import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/model/workflow.js";
import { addBuilding, addRoom, addDevice, addWorker } from "../src/model/registries.js";
import { createOrderSafe } from "../src/model/seed.js";
import { orderCosts, dashboardStats } from "../src/model/index.js";

test("seed：可构造一张走完全流程的已验收工单", () => {
  const data = emptyData();
  const b = addBuilding(data, { name: "1栋" });
  const r = addRoom(data, { buildingId: b.id, name: "301" });
  const w = addWorker(data, { name: "张师傅" });
  addDevice(data, { name: "灯" });
  const now = new Date("2026-09-12T10:00").getTime();

  const order = createOrderSafe(data, {
    roomId: r.id, title: "灯不亮", budget: 150, visitAt: "2026-09-10T10:00",
    assigneeId: w.id, advance: ["accepted", "repairing", "accepting_check", "verified"],
    workHours: 1, hourlyRate: 80, materials: [{ name: "灯盘", qty: 1, price: 35 }]
  }, now);

  assert.equal(order.status, "verified");
  assert.equal(orderCosts(order).total, 115);
  assert.equal(order.history.length, 5);
  const stats = dashboardStats(data, now);
  assert.equal(stats.monthSpend, 115);
  assert.equal(stats.overdue, 0, "已验收工单不计逾期");
});

test("seed：只到维修中的工单保持未完成且可逾期", () => {
  const data = emptyData();
  const b = addBuilding(data, { name: "1栋" });
  const r = addRoom(data, { buildingId: b.id, name: "301" });
  const w = addWorker(data, { name: "张师傅" });
  const now = new Date("2026-09-12T10:00").getTime();

  createOrderSafe(data, {
    roomId: r.id, title: "渗水", budget: 400, visitAt: "2026-09-11T10:00",
    assigneeId: w.id, advance: ["accepted", "repairing"], workHours: 1
  }, now);

  const stats = dashboardStats(data, now);
  assert.equal(stats.overdue, 1);
  assert.equal(stats.unfinishedBudget, 400);
});
