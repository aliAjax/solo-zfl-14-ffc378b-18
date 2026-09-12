import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS } from "../src/model/constants.js";
import { canTransition, WorkflowError } from "../src/model/workflow.js";
import { setupRepo, makeOrder, localInput, T_NOW, HOUR, expectThrowsAsync } from "./helpers.js";

test("状态机：完整流转 待派单→已接单→维修中→待验收→已验收", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1);

  assert.equal(order.status, STATUS.PENDING);
  assert.equal(order.code.startsWith("WX2026-"), true);

  repo.dispatch(order.id, { assigneeId: ids.w1, visitAt: localInput(T_NOW + 2 * HOUR) });
  assert.equal(repo.data.orders[0].status, STATUS.ACCEPTED);
  assert.equal(repo.data.orders[0].assigneeId, ids.w1);

  repo.advance(order.id, STATUS.REPAIRING);
  assert.equal(repo.data.orders[0].status, STATUS.REPAIRING);

  repo.advance(order.id, STATUS.ACCEPTING, { workHours: 2, hourlyRate: 80, materials: [] });
  assert.equal(repo.data.orders[0].status, STATUS.ACCEPTING);
  assert.equal(repo.data.orders[0].submitted, true);

  repo.advance(order.id, STATUS.VERIFIED);
  const done = repo.data.orders[0];
  assert.equal(done.status, STATUS.VERIFIED);
  assert.ok(done.finishedAt, "验收时间应被记录");
  assert.ok(done.history.length >= 5);
});

test("验收不通过：待验收退回已接单，之后可重新维修→提交→验收", () => {
  const { repo, ids, tick } = setupRepo();
  const order = makeOrder(repo, ids.room1);
  repo.dispatch(order.id, { assigneeId: ids.w1 });
  repo.advance(order.id, STATUS.REPAIRING);
  repo.advance(order.id, STATUS.ACCEPTING, { workHours: 1, materials: [] });
  assert.equal(repo.data.orders[0].status, STATUS.ACCEPTING);

  repo.rejectVerification(order.id, "仍有漏水");
  assert.equal(repo.data.orders[0].status, STATUS.ACCEPTED);
  assert.equal(repo.data.orders[0].submitted, false, "退回后提交锁应解除");
  assert.match(repo.data.orders[0].history.at(-1).note, /仍有漏水/);

  tick();
  repo.advance(order.id, STATUS.REPAIRING);
  repo.advance(order.id, STATUS.ACCEPTING, { workHours: 2, materials: [{ name: "阀门", qty: 1, price: 30 }] });
  repo.advance(order.id, STATUS.VERIFIED);
  assert.equal(repo.data.orders[0].status, STATUS.VERIFIED);
});

test("非法流转被拒绝", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1);

  assert.throws(() => repo.advance(order.id, STATUS.VERIFIED), (e) => e.code === "INVALID_TRANSITION");
  assert.throws(() => repo.advance(order.id, STATUS.REPAIRING), (e) => e.code === "INVALID_TRANSITION");
  assert.equal(canTransition(STATUS.PENDING, STATUS.ACCEPTED), true);
  assert.equal(canTransition(STATUS.VERIFIED, STATUS.ACCEPTED), false);
});

test("派单校验：必须指定存在的维修人；已派单不能重复派", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1);

  assert.throws(() => repo.dispatch(order.id, {}), (e) => e.code === "NO_ASSIGNEE");
  assert.throws(() => repo.dispatch(order.id, { assigneeId: "nope" }), (e) => e.code === "ASSIGNEE_NOT_FOUND");

  repo.dispatch(order.id, { assigneeId: ids.w1 });
  assert.throws(() => repo.dispatch(order.id, { assigneeId: ids.w2 }), (e) => e.code === "INVALID_STATUS");
});

test("重复提交验收被拒绝（领域层 submitted 锁）", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1);
  repo.dispatch(order.id, { assigneeId: ids.w1 });
  repo.advance(order.id, STATUS.REPAIRING);
  repo.advance(order.id, STATUS.ACCEPTING, { workHours: 1 });

  // 待验收状态再次提交
  assert.throws(() => repo.advance(order.id, STATUS.ACCEPTING), (e) => e.code === "DUPLICATE_SUBMIT");
  assert.equal(repo.data.orders[0].status, STATUS.ACCEPTING, "重复提交不得改变状态");
});

test("重复提交：异步提交锁阻止并发双击（withSubmitLock）", async () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1);
  repo.dispatch(order.id, { assigneeId: ids.w1 });
  repo.advance(order.id, STATUS.REPAIRING);

  let resolveFirst;
  const first = repo.withSubmitLock(`k-${order.id}`, () => new Promise((res) => { resolveFirst = res; }));
  // 第二次并发调用立即被拒
  await expectThrowsAsync(() => repo.withSubmitLock(`k-${order.id}`, () => "should-not-run"), "DUPLICATE_SUBMIT");
  assert.equal(repo.isSubmitting(`k-${order.id}`), true);

  resolveFirst();
  await first;
  assert.equal(repo.isSubmitting(`k-${order.id}`), false);
});

test("建单校验：标题与房间不能为空", () => {
  const { repo, ids } = setupRepo();
  assert.throws(() => makeOrder(repo, ids.room1, { title: "  " }), (e) => e instanceof WorkflowError && e.code === "INVALID_TITLE");
  assert.throws(() => repo.createOrderDraft({ roomId: "", title: "x" }), (e) => e.code === "INVALID_ROOM");
});

test("只有待派单工单可编辑", () => {
  const { repo, ids } = setupRepo();
  const order = makeOrder(repo, ids.room1, { budget: 100 });
  repo.editOrder(order.id, { budget: 300 });
  assert.equal(repo.data.orders[0].budget, 300);

  repo.dispatch(order.id, { assigneeId: ids.w1 });
  assert.throws(() => repo.editOrder(order.id, { budget: 500 }), (e) => e.code === "INVALID_STATUS");
});
