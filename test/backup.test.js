import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, MemoryStorage } from "../src/model/store.js";
import { Repo } from "../src/model/repo.js";
import { serializeBackup, parseBackup, BackupError, validateData } from "../src/model/backup.js";
import { emptyData } from "../src/model/workflow.js";
import { setupRepo, makeOrder, localInput, T_NOW, HOUR } from "./helpers.js";

function buildPopulated() {
  const { repo, ids } = setupRepo();
  const o = makeOrder(repo, ids.room1, { title: "待导出的工单", budget: 300 });
  repo.dispatch(o.id, { assigneeId: ids.w1 });
  return repo;
}

test("导出→导入往返，数据一致", () => {
  const repo = buildPopulated();
  const text = repo.exportBackup();
  const envelope = JSON.parse(text);
  assert.equal(envelope.app, "property-repair-desk");
  assert.ok(envelope.checksum);
  assert.equal(envelope.data.orders.length, 1);

  const other = new MemoryStorage();
  const restored = new Repo({ storage: other });
  restored.importBackup(text);
  assert.equal(restored.data.orders.length, 1);
  assert.equal(restored.data.orders[0].title, "待导出的工单");
  assert.equal(restored.data.buildings.length, repo.data.buildings.length);
  assert.equal(restored.data.workers.length, repo.data.workers.length);
});

test("也接受裸数据对象（无信封）导入", () => {
  const repo = buildPopulated();
  const bare = JSON.stringify(repo.data);
  const storage = new MemoryStorage();
  const target = new Repo({ storage });
  target.importBackup(bare);
  assert.equal(target.data.orders.length, 1);
});

test("坏 JSON 导入被拒绝", () => {
  const target = new Repo({ storage: new MemoryStorage() });
  assert.throws(() => target.importBackup("{not json"), (e) => e.code === "BAD_JSON");
});

test("校验和不一致（文件被篡改）被拒绝", () => {
  const repo = buildPopulated();
  const envelope = JSON.parse(repo.exportBackup());
  envelope.data.orders[0].budget = 99999;
  assert.throws(() => parseBackup(JSON.stringify(envelope)), (e) => e.code === "CHECKSUM_MISMATCH");
});

test("结构校验：引用不存在的房间/维修人时报错", () => {
  const data = emptyData();
  data.buildings = [{ id: "b1", name: "1栋" }];
  data.orders = [{ id: "o1", title: "x", status: "pending", roomId: "missing", assigneeId: "nope" }];
  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("房间")));
  assert.ok(result.errors.some((e) => e.includes("维修人")));
});

test("非法状态/重复 id 校验失败", () => {
  const data = emptyData();
  data.orders = [
    { id: "x", title: "a", status: "wat" },
    { id: "x", title: "b", status: "pending" }
  ];
  const result = validateData(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("状态非法")));
  assert.ok(result.errors.some((e) => e.includes("id 重复")));
});

test("主数据损坏：自动回退到最近一份完好快照并报告错误", () => {
  const { repo, storage, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1, { title: "快照里的工单" });
  repo.dispatch(order.id, { assigneeId: ids.w1 });

  // 最近一份快照 = 派单保存前的数据（含该工单，状态为待派单）
  const latestSnapshot = repo.listSnapshots().at(-1);
  assert.equal(latestSnapshot.data.orders.length, 1);

  // 写坏主数据
  storage.setItem("prd:data:v1", "{ this is corrupted");

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "snapshot", "应从快照恢复");
  assert.ok(reopened.loadInfo.error, "应携带原始损坏原因");
  assert.equal(reopened.data.orders.length, 1);
  assert.equal(reopened.data.orders[0].title, "快照里的工单");
  assert.equal(reopened.data.orders[0].status, "pending");
});

test("主数据损坏且最新快照损坏：自动跳过坏快照、恢复更早的完好快照", () => {
  const { repo, storage, ids } = setupRepo();
  makeOrder(repo, ids.room1, { title: "旧单" });
  makeOrder(repo, ids.room2, { title: "新单" });
  assert.equal(repo.data.orders.length, 2);

  // 最新快照保存的是「只有旧单」的数据（第二次保存前）；把它写坏（非法 JSON 字符串）
  const snapList = JSON.parse(storage.getItem("prd:snapshots:v1"));
  snapList[snapList.length - 1].data = "{corrupt-json";
  storage.setItem("prd:snapshots:v1", JSON.stringify(snapList));
  storage.setItem("prd:data:v1", "corrupt-live");

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "snapshot");
  // 跳过坏快照后恢复到更早的完好快照（0 工单），而不是崩溃或使用坏数据
  assert.equal(reopened.data.orders.length, 0);
  assert.ok(reopened.data.buildings.length >= 1, "更早快照中的登记数据应保留");
});

test("主数据与所有快照都损坏：空库启动并报告", () => {
  const { repo, storage, ids } = setupRepo();
  const o = makeOrder(repo, ids.room1);
  repo.dispatch(o.id, { assigneeId: ids.w1 });

  storage.setItem("prd:data:v1", "garbage");
  storage.setItem("prd:snapshots:v1", "[{bad");

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "empty");
  assert.ok(reopened.loadInfo.error);
  assert.equal(reopened.data.orders.length, 0);
});

test("手动回退到指定快照", () => {
  const { repo, ids, tick } = setupRepo();
  const o1 = makeOrder(repo, ids.room1, { title: "第一单" });
  tick(2000);
  const o2 = makeOrder(repo, ids.room2, { title: "第二单" });
  assert.equal(repo.data.orders.length, 2);

  // 保存第二单时留下的最新快照里有第一单、没有第二单
  const snapshotWithFirst = repo.listSnapshots().at(-1).id;
  repo.rollback(snapshotWithFirst);
  assert.equal(repo.data.orders.length, 1);
  assert.equal(repo.data.orders[0].id, o1.id);
  assert.ok(!repo.data.orders.find((o) => o.id === o2.id));

  // 回退后再次开新 Repo 仍然读到回退数据
  const reopened = new Repo({ storage: repo.store.storage });
  assert.equal(reopened.data.orders.length, 1);
});

test("手动回退：回到的是所选（非最新）快照，且当前状态先留档可再回退", () => {
  const { repo, ids, tick } = setupRepo();
  // 快照保存的是「每次保存之前」的状态：
  //   保存 o2 时推入含 o1 的快照；保存 o3 时推入含 o1+o2 的快照
  const o1 = makeOrder(repo, ids.room1, { title: "第一单" });
  tick(1000);
  const o2 = makeOrder(repo, ids.room2, { title: "第二单" });
  tick(1000);
  const snapA = repo.listSnapshots().at(-1).id; // 含 o1，不含 o2
  const o3 = makeOrder(repo, ids.room3, { title: "第三单" });
  const snapB = repo.listSnapshots().at(-1).id; // 含 o1+o2，不含 o3
  assert.equal(repo.data.orders.length, 3);
  assert.equal(repo.listSnapshots().find((s) => s.id === snapA).data.orders.length, 1);
  assert.equal(repo.listSnapshots().find((s) => s.id === snapB).data.orders.length, 2);

  // 明确选择较早的 snapA（而非最新快照），必须回到只有 o1 的状态
  repo.rollback(snapA);
  assert.deepEqual(repo.data.orders.map((o) => o.id), [o1.id]);

  // 回退前当前状态已留档：快照环新增一份含 3 单的快照，可再退回
  const threeOrderSnap = [...repo.listSnapshots()].reverse().find((s) => s.data.orders.length === 3);
  assert.ok(threeOrderSnap, "回退操作应先把当前 3 单状态推入快照环");
  repo.rollback(threeOrderSnap.id);
  assert.equal(repo.data.orders.length, 3);
  assert.ok(repo.data.orders.find((o) => o.id === o3.id));

  // 选不存在的快照 id 报明确错误
  assert.throws(() => repo.rollback("no-such-id"), (e) => e.code === "SNAPSHOT_NOT_FOUND");
});

test("手动回退：所选快照本身损坏时拒绝并保留当前数据", () => {
  const { repo, ids, storage } = setupRepo();
  makeOrder(repo, ids.room1, { title: "第一单" });
  makeOrder(repo, ids.room2, { title: "第二单" });
  const target = repo.listSnapshots().at(-1);
  const list = JSON.parse(storage.getItem("prd:snapshots:v1"));
  list.find((s) => s.id === target.id).data = "{corrupt";
  storage.setItem("prd:snapshots:v1", JSON.stringify(list));

  assert.throws(() => repo.rollback(target.id), (e) => e.code === "SNAPSHOT_CORRUPT");
  assert.equal(repo.data.orders.length, 2, "回退失败不得改动当前内存数据");
});

test("主数据可解析但结构残缺（缺集合字段）：回退最近完好快照而非清空", () => {
  const { repo, storage, ids } = setupRepo();
  const o = makeOrder(repo, ids.room1, { title: "重要工单" });
  repo.editOrder(o.id, { budget: 123 }); // 再保存一次，使含工单的状态进入快照

  // 残缺对象：能 JSON.parse、是对象，但没有 buildings/orders 等数组
  storage.setItem("prd:data:v1", JSON.stringify({ hello: "world" }));

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "snapshot");
  assert.equal(reopened.data.orders.length, 1);
  assert.equal(reopened.data.orders[0].title, "重要工单");
  assert.ok(reopened.data.buildings.length >= 1);
  assert.match(reopened.loadInfo.error, /结构/);

  // 再次刷新仍读到已恢复的主数据
  const again = new Repo({ storage });
  assert.equal(again.loadInfo.source, "live");
  assert.equal(again.data.orders.length, 1);
});

test("主数据结构残缺的各种形态都触发快照回退", () => {
  const cases = [
    "{}",
    "null",
    "[]",
    "42",
    JSON.stringify({ buildings: [], rooms: [], devices: [], workers: [] }), // 缺 orders
    JSON.stringify({ buildings: [], rooms: [], devices: [], workers: [], orders: "x" }) // orders 非数组
  ];
  for (const corrupted of cases) {
    const { repo, storage, ids } = setupRepo();
    makeOrder(repo, ids.room1, { title: "x" });
    repo.editOrder(repo.data.orders[0].id, { budget: 1 });
    storage.setItem("prd:data:v1", corrupted);
    const reopened = new Repo({ storage });
    assert.equal(reopened.loadInfo.source, "snapshot", `应回退快照: ${corrupted}`);
    assert.equal(reopened.data.orders.length, 1, `数据应保留: ${corrupted}`);
  }
});

test("主数据结构残缺且全部快照也不可用：才进入空库", () => {
  const { repo, storage, ids } = setupRepo();
  makeOrder(repo, ids.room1);
  storage.setItem("prd:data:v1", "{}"); // 结构残缺
  storage.setItem("prd:snapshots:v1", "[{bad"); // 快照链整体损坏

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "empty");
  assert.ok(reopened.loadInfo.error);
  assert.equal(reopened.data.orders.length, 0);
});

test("恢复后日常流程不受影响：可继续建单/派单/流转并持久化", () => {
  const { repo, storage, ids } = setupRepo();
  const o = makeOrder(repo, ids.room1, { title: "恢复后继续用" });
  repo.editOrder(o.id, { budget: 100 });
  storage.setItem("prd:data:v1", JSON.stringify({ bogus: true }));

  const reopened = new Repo({ storage });
  assert.equal(reopened.loadInfo.source, "snapshot");
  // 在恢复出的数据上继续日常操作
  reopened.dispatch(o.id, { assigneeId: ids.w1 });
  reopened.advance(o.id, "repairing");
  reopened.saveWorkReport(o.id, { workHours: 1, materials: [{ name: "管件", qty: 2, price: 10 }] });

  const again = new Repo({ storage });
  assert.equal(again.loadInfo.source, "live", "新写入的数据应作为正常主数据被读取");
  const order = again.data.orders[0];
  assert.equal(order.status, "repairing");
  assert.equal(order.total, 100);
});

test("刷新不丢：同存储重新实例化数据完整", () => {
  const storage = new MemoryStorage();
  const { repo, ids } = setupRepo({ storage });
  const o = makeOrder(repo, ids.room1, { title: "持久化工单", visitAt: localInput(T_NOW + HOUR) });
  repo.dispatch(o.id, { assigneeId: ids.w1, hourlyRate: 80, budget: 400 });
  repo.advance(o.id, "repairing");
  repo.saveWorkReport(o.id, { workHours: 2, materials: [{ name: "阀门", qty: 1, price: 50 }] });

  const reopened = new Repo({ storage });
  assert.equal(reopened.data.orders.length, 1);
  const restored = reopened.data.orders[0];
  assert.equal(restored.status, "repairing");
  assert.equal(restored.workHours, 2);
  assert.equal(restored.total, 210);
  assert.equal(restored.assigneeId, ids.w1);
  assert.equal(restored.visitAt, T_NOW + HOUR, "上门时间戳应原样保留");
});

test("快照数量有上限（默认 10 份），超出丢弃最旧", () => {
  const { repo, ids } = setupRepo();
  for (let i = 0; i < 15; i += 1) {
    makeOrder(repo, ids.room1, { title: `单 ${i}` });
  }
  assert.ok(repo.listSnapshots().length <= 10);
});

test("备份序列化时间戳可往返", () => {
  const data = emptyData();
  const text = serializeBackup(data, 1_700_000_000_000);
  assert.equal(JSON.parse(text).exportedAt, 1_700_000_000_000);
  assert.ok(parseBackup(text));
});
