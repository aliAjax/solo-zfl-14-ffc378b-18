// 首次使用的演示数据构造（直接操作数据对象，不触发持久化）
import {
  createOrder,
  dispatchOrder,
  transition,
  applyWorkReport,
  nextOrderCode
} from "./workflow.js";

export { addBuilding, addRoom, addDevice, addWorker } from "./registries.js";

// spec:
// { roomId, title, priority, budget, visitAt(datetime-local), assigneeId,
//   offset(相对 now 的上门时间偏移，仅演示), advance: [...状态推进],
//   workHours, hourlyRate, materials }
export function createOrderSafe(data, spec, now = Date.now()) {
  const order = createOrder(
    {
      roomId: spec.roomId,
      title: spec.title,
      priority: spec.priority,
      budget: spec.budget ?? 0,
      visitAt: spec.visitAt,
      hourlyRate: spec.hourlyRate ?? data.settings.defaultHourlyRate
    },
    { now: now - 1000 }
  );
  order.code = nextOrderCode(data.orders);
  data.orders.unshift(order);

  if (spec.assigneeId && spec.advance?.length) {
    dispatchOrder(data, order.id, {
      assigneeId: spec.assigneeId,
      visitAt: spec.visitAt
    }, { now });
  }
  // dispatch 已完成 待派单→已接单，循环里跳过重复的 accepted
  const steps = (spec.advance || []).filter((to) => !(spec.assigneeId && to === "accepted"));
  for (const [i, to] of steps.entries()) {
    if (to === "accepting_check") {
      applyWorkReport(order, {
        workHours: spec.workHours ?? 0,
        hourlyRate: spec.hourlyRate ?? data.settings.defaultHourlyRate,
        materials: spec.materials ?? []
      });
    }
    transition(data, order.id, to, {}, { now: now + (i + 1) * 1000 });
  }
  return order;
}
