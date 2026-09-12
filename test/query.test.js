import { test } from "node:test";
import assert from "node:assert/strict";
import { filterOrders, sortOrders, queryOrders, decorateOrder } from "../src/model/query.js";
import { setupRepo, makeOrder, localInput, T_NOW, HOUR } from "./helpers.js";
import { STATUS, PRIORITY } from "../src/model/constants.js";

function seeded() {
  const { repo, ids, tick } = setupRepo();
  // o1: 1栋301 高优先级 派给 w1 维修中，上门时间最早
  const o1 = makeOrder(repo, ids.room1, { title: "水管爆裂", priority: "high", budget: 500, visitAt: localInput(T_NOW - 5 * HOUR) });
  tick(60_000);
  repo.dispatch(o1.id, { assigneeId: ids.w1 });
  repo.advance(o1.id, STATUS.REPAIRING);

  tick(60_000);
  // o2: 1栋502 中优先级 派给 w2 已接单
  const o2 = makeOrder(repo, ids.room2, { title: "空调异响", priority: "medium", budget: 200, visitAt: localInput(T_NOW + 2 * HOUR) });
  tick(60_000);
  repo.dispatch(o2.id, { assigneeId: ids.w2 });

  tick(60_000);
  // o3: 2栋101 低优先级 待派单，预算最高，无上门时间
  const o3 = makeOrder(repo, ids.room3, { title: "门锁松动", priority: "low", budget: 900, visitAt: "" });

  return { repo, ids, ids3: { o1: o1.id, o2: o2.id, o3: o3.id }, tick };
}

test("筛选：按楼栋", () => {
  const { repo, ids } = seeded();
  const rows = queryOrders(repo.data, { buildingId: ids.building }, { by: "visitAt", dir: "asc" }, T_NOW);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.buildingId === ids.building));
});

test("筛选：按状态 / 优先级 / 维修人", () => {
  const { repo, ids } = seeded();
  assert.equal(queryOrders(repo.data, { status: STATUS.PENDING }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { status: STATUS.REPAIRING }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { priority: PRIORITY.HIGH }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { assigneeId: ids.w2 }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { assigneeId: ids.w1, status: STATUS.REPAIRING }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { assigneeId: ids.w1, status: STATUS.PENDING }, {}).length, 0);
});

test("筛选：关键词命中标题/单号/房间", () => {
  const { repo } = seeded();
  assert.equal(queryOrders(repo.data, { keyword: "水管" }, {}).length, 1);
  assert.equal(queryOrders(repo.data, { keyword: "1栋" }, {}).length, 2);
  const code = repo.data.orders[0].code;
  assert.equal(queryOrders(repo.data, { keyword: code }, {}).length, 1);
});

test("组合筛选", () => {
  const { repo, ids } = seeded();
  const rows = queryOrders(repo.data, { buildingId: ids.building, priority: PRIORITY.MEDIUM }, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "空调异响");
});

test("排序：按上门时间升序，无上门时间排最后", () => {
  const { repo, ids3 } = seeded();
  const asc = queryOrders(repo.data, {}, { by: "visitAt", dir: "asc" }, T_NOW);
  assert.deepEqual(asc.map((r) => r.id), [ids3.o1, ids3.o2, ids3.o3]);
});

test("排序：按上门时间降序，无上门时间仍排最后", () => {
  const { repo, ids3 } = seeded();
  const desc = queryOrders(repo.data, {}, { by: "visitAt", dir: "desc" }, T_NOW);
  assert.deepEqual(desc.map((r) => r.id), [ids3.o2, ids3.o1, ids3.o3]);
});

test("排序：按预算升降序", () => {
  const { repo, ids3 } = seeded();
  const asc = queryOrders(repo.data, {}, { by: "budget", dir: "asc" });
  assert.deepEqual(asc.map((r) => r.id), [ids3.o2, ids3.o1, ids3.o3]);
  const desc = queryOrders(repo.data, {}, { by: "budget", dir: "desc" });
  assert.deepEqual(desc.map((r) => r.id), [ids3.o3, ids3.o1, ids3.o2]);
});

test("排序：按更新时间", () => {
  const { repo, ids3, tick } = seeded();
  // 再更新一次 o3，使它 updatedAt 最新
  tick(120_000);
  repo.editOrder(repo.data.orders.find((o) => o.id === ids3.o3).id, { budget: 950 });
  const desc = queryOrders(repo.data, {}, { by: "updatedAt", dir: "desc" });
  assert.equal(desc[0].id, ids3.o3);
});

test("逾期：未完成且超过上门时间的工单被标红标记 overdue", () => {
  const { repo, ids3 } = seeded();
  const rows = queryOrders(repo.data, {}, { by: "visitAt", dir: "asc" }, T_NOW);
  const o1 = rows.find((r) => r.id === ids3.o1);
  assert.equal(o1.overdue, true);
  const o2 = rows.find((r) => r.id === ids3.o2);
  assert.equal(o2.overdue, false);
});

test("装饰字段：楼栋名/房间名/维修人名缺失时安全降级", () => {
  const { repo, ids } = seeded();
  const order = repo.data.orders[0];
  order.roomId = "deleted-room";
  const view = decorateOrder(repo.data, order, T_NOW);
  assert.equal(view.roomMissing, true);
  assert.equal(view.roomName, "未知房间");
  assert.equal(view.assigneeName, "未派单");
});

test("filterOrders/sortOrders 可直接作用于裸工单数组", () => {
  const data = [
    { id: "a", status: STATUS.PENDING, priority: PRIORITY.LOW, visitAt: 20, budget: 10, createdAt: 1, updatedAt: 1 },
    { id: "b", status: STATUS.ACCEPTED, priority: PRIORITY.HIGH, visitAt: 10, budget: 30, createdAt: 2, updatedAt: 2 }
  ];
  assert.equal(filterOrders(data, { status: STATUS.PENDING }).length, 1);
  assert.deepEqual(sortOrders(data, "visitAt", "asc").map((d) => d.id), ["b", "a"]);
});
