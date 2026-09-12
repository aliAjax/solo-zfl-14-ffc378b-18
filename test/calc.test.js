import { test } from "node:test";
import assert from "node:assert/strict";
import { materialCostOf, laborCostOf, orderCosts, sumCosts } from "../src/model/calc.js";
import { setupRepo, makeOrder, localInput, T_NOW, HOUR } from "./helpers.js";
import { dashboardStats } from "../src/model/query.js";
import { STATUS } from "../src/model/constants.js";

test("材料费 = Σ(数量×单价)，忽略非法/负数量", () => {
  assert.equal(materialCostOf([{ name: "a", qty: 2, price: 12.5 }, { name: "b", qty: 1, price: 30 }]), 55);
  assert.equal(materialCostOf([{ name: "x", qty: -2, price: 10 }]), 0);
  assert.equal(materialCostOf([{ name: "x", qty: 2, price: NaN }]), 0);
  assert.equal(materialCostOf([]), 0);
});

test("人工费 = 工时 × 工时单价", () => {
  assert.equal(laborCostOf(2.5, 80), 200);
  assert.equal(laborCostOf(0, 80), 0);
  assert.equal(laborCostOf(2, 0), 0);
  assert.equal(laborCostOf(-3, 80), 0);
});

test("总费用 = 材料费 + 人工费，保留两位小数", () => {
  const costs = orderCosts({
    workHours: 1.5, hourlyRate: 80,
    materials: [{ name: "管", qty: 3, price: 7.33 }]
  });
  assert.equal(costs.materialCost, 21.99);
  assert.equal(costs.laborCost, 120);
  assert.equal(costs.total, 141.99);
});

test("sumCosts 汇总多张工单", () => {
  const sum = sumCosts([
    { workHours: 1, hourlyRate: 100, materials: [{ name: "a", qty: 1, price: 10 }] },
    { workHours: 2, hourlyRate: 50, materials: [] }
  ]);
  assert.deepEqual(sum, { materialCost: 10, laborCost: 200, total: 210 });
});

test("工单全流程费用：保存工时与耗材后自动重算", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1, { hourlyRate: 80 });
  repo.dispatch(order.id, { assigneeId: ids.w1 });
  repo.advance(order.id, STATUS.REPAIRING);
  repo.saveWorkReport(order.id, { workHours: 3, hourlyRate: 90, materials: [{ name: "制冷剂", qty: 1, price: 220 }, { name: "滤网", qty: 2, price: 25 }] });

  const o = repo.data.orders[0];
  assert.equal(o.materialCost, 270);
  assert.equal(o.laborCost, 270);
  assert.equal(o.total, 540);

  // 删除一条耗材
  repo.saveWorkReport(order.id, { materials: [{ name: "制冷剂", qty: 1, price: 220 }] });
  assert.equal(repo.data.orders[0].materialCost, 220);
  assert.equal(repo.data.orders[0].total, 490);
});

test("统计：待派单/逾期/本月支出/未完成预算/超预算提示", () => {
  const { repo, ids, tick } = setupRepo({ budget: 1000 });

  // 未完成且逾期的待派单
  const overdueOrder = makeOrder(repo, ids.room1, { budget: 300, visitAt: localInput(T_NOW - 2 * HOUR) });
  tick();
  // 维修中、已超单票预算
  const repairing = makeOrder(repo, ids.room2, { budget: 100, visitAt: localInput(T_NOW + HOUR) });
  repo.dispatch(repairing.id, { assigneeId: ids.w1 });
  repo.advance(repairing.id, STATUS.REPAIRING);
  repo.saveWorkReport(repairing.id, { workHours: 2, hourlyRate: 80, materials: [] }); // 160 > 100

  // 本月已验收
  const verified = makeOrder(repo, ids.room3, { budget: 500, visitAt: localInput(T_NOW - 3 * HOUR) });
  repo.dispatch(verified.id, { assigneeId: ids.w2 });
  repo.advance(verified.id, STATUS.REPAIRING);
  repo.advance(verified.id, STATUS.ACCEPTING, { workHours: 1, hourlyRate: 80, materials: [{ name: "x", qty: 1, price: 20 }] });
  tick();
  repo.advance(verified.id, STATUS.VERIFIED);

  const stats = dashboardStats(repo.data, T_NOW + 10000);
  assert.equal(stats.pending, 1);
  assert.equal(stats.overdue, 1, "只有未完成且过上门时间才算逾期");
  assert.equal(stats.unfinishedBudget, 400, "300 + 100");
  assert.equal(stats.monthSpend, 100, "80 人工 + 20 材料");
  assert.equal(stats.monthlyOverBudget, false, "100 < 1000");
  assert.equal(stats.overBudgetOrders.length, 1);
  assert.equal(stats.overBudgetOrders[0].orderId, repairing.id);
});

test("统计：本月支出超出月度预算时提示", () => {
  const { repo, ids, tick } = setupRepo({ budget: 50 });
  const o = makeOrder(repo, ids.room1, { visitAt: localInput(T_NOW - HOUR) });
  repo.dispatch(o.id, { assigneeId: ids.w1 });
  repo.advance(o.id, STATUS.REPAIRING);
  repo.advance(o.id, STATUS.ACCEPTING, { workHours: 1, hourlyRate: 80 });
  tick();
  repo.advance(o.id, STATUS.VERIFIED);

  const stats = dashboardStats(repo.data, T_NOW + 9999);
  assert.equal(stats.monthSpend, 80);
  assert.equal(stats.monthlyOverBudget, true);
  assert.equal(stats.monthlyRemaining, -30);
});

test("逾期判定：已验收工单即使过了上门时间也不标逾期", () => {
  const { repo, ids } = setupRepo();
  const o = makeOrder(repo, ids.room1, { visitAt: localInput(T_NOW - 10 * HOUR) });
  repo.dispatch(o.id, { assigneeId: ids.w1, visitAt: localInput(T_NOW - 10 * HOUR) });
  repo.advance(o.id, STATUS.REPAIRING);
  repo.advance(o.id, STATUS.ACCEPTING, { workHours: 0.5 });
  repo.advance(o.id, STATUS.VERIFIED);
  const stats = dashboardStats(repo.data, T_NOW);
  assert.equal(stats.overdue, 0);
});
