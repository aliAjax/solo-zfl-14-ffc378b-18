// 列表筛选、排序与顶部统计
import { STATUS, PRIORITY_ORDER, UNFINISHED_STATUSES } from "./constants.js";
import { orderCosts } from "./calc.js";
import { isOverdue, isUnfinished } from "./workflow.js";
import { currentMonthKey, monthKey, round2 } from "./util.js";
import { findBuilding, findDevice, findRoom, findWorker } from "./registries.js";

// 给工单拼上展示字段（楼栋名、房间名、维修人名、费用、逾期标记……）
export function decorateOrder(state, order, now = Date.now()) {
  const room = findRoom(state, order.roomId);
  const building = room ? findBuilding(state, room.buildingId) : null;
  const device = order.deviceId ? findDevice(state, order.deviceId) : null;
  const assignee = order.assigneeId ? findWorker(state, order.assigneeId) : null;
  return {
    ...order,
    ...orderCosts(order),
    buildingId: building?.id || (room ? room.buildingId : ""),
    buildingName: building?.name || "",
    roomName: room ? room.name : "未知房间",
    roomMissing: !room,
    deviceName: device?.name || "",
    assigneeName: order.assigneeId
      ? (assignee?.name || "维修人已删除")
      : "未派单",
    assigneeMissing: Boolean(order.assigneeId) && !assignee,
    overdue: isOverdue(order, now)
  };
}

// criteria: { buildingId, status, priority, assigneeId, keyword }
export function filterOrders(orders, criteria = {}) {
  return orders.filter((order) => {
    if (criteria.status && order.status !== criteria.status) return false;
    if (criteria.priority && order.priority !== criteria.priority) return false;
    if (criteria.assigneeId && order.assigneeId !== criteria.assigneeId) return false;
    if (criteria.buildingId) {
      if (order.buildingId !== criteria.buildingId) return false;
    }
    if (criteria.keyword) {
      const kw = criteria.keyword.trim().toLowerCase();
      if (kw) {
        const haystack = `${order.code} ${order.title} ${order.description} ${order.roomName} ${order.buildingName} ${order.assigneeName}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
    }
    return true;
  });
}

// sortBy: visitAt | budget | updatedAt；dir: asc | desc
export function sortOrders(orders, sortBy = "visitAt", dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const valueOf = (order) => {
    if (sortBy === "budget") return order.budget ?? 0;
    if (sortBy === "updatedAt") return order.updatedAt ?? 0;
    return order.visitAt;
  };
  const cmp = (a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    let result;
    if (sortBy === "visitAt") {
      // 未约定上门时间始终排最后，不受升降序影响
      if (va == null && vb == null) result = 0;
      else if (va == null) return 1;
      else if (vb == null) return -1;
      else result = va - vb;
    } else {
      result = va - vb;
    }
    if (result !== 0) return result * sign;
    // 稳定次序：优先级、创建时间
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  };
  return [...orders].sort(cmp);
}

// 未约定上门时间的工单排最后（无论升降序）

export function queryOrders(state, criteria = {}, sort = { by: "visitAt", dir: "asc" }, now = Date.now()) {
  const decorated = state.orders.map((o) => decorateOrder(state, o, now));
  const filtered = filterOrders(decorated, criteria);
  return sortOrders(filtered, sort.by, sort.dir);
}

// 顶部统计
export function dashboardStats(state, now = Date.now()) {
  const month = currentMonthKey(now);
  let pending = 0;
  let overdue = 0;
  let monthSpend = 0; // 本月支出：本月已验收工单的实际总费用
  let unfinishedBudget = 0; // 未完成工单预算合计
  const overBudgetOrders = [];

  for (const order of state.orders) {
    if (order.status === STATUS.PENDING) pending += 1;
    if (isOverdue(order, now)) overdue += 1;
    if (isUnfinished(order)) unfinishedBudget = round2(unfinishedBudget + Number(order.budget || 0));
    if (order.status === STATUS.VERIFIED && order.finishedAt && monthKey(order.finishedAt) === month) {
      monthSpend = round2(monthSpend + orderCosts(order).total);
    }
    const costs = orderCosts(order);
    if (isUnfinished(order) && order.budget > 0 && costs.total > order.budget) {
      overBudgetOrders.push({ orderId: order.id, total: costs.total, budget: order.budget });
    }
  }

  const monthlyBudget = round2(state.settings?.monthlyBudget ?? 0);
  return {
    pending,
    overdue,
    monthSpend,
    unfinishedBudget,
    monthlyBudget,
    monthlyOverBudget: monthlyBudget > 0 && monthSpend > monthlyBudget,
    monthlyRemaining: round2(monthlyBudget - monthSpend),
    overBudgetOrders,
    unfinishedCount: state.orders.filter(isUnfinished).length
  };
}

export { UNFINISHED_STATUSES };
