// 费用计算：材料费、人工费、总费用
import { round2 } from "./util.js";

// 材料单价表：按设备类型给出常用默认单价（元/单位），可在设备登记时覆盖
export function materialCostOf(materials = []) {
  return round2(
    materials.reduce((sum, item) => {
      const qty = Number(item.qty);
      const price = Number(item.price);
      if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum;
      return sum + Math.max(0, qty) * Math.max(0, price);
    }, 0)
  );
}

// 人工费 = 工时(小时) × 时薪
export function laborCostOf(workHours = 0, hourlyRate = 0) {
  const hours = Number(workHours);
  const rate = Number(hourlyRate);
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0;
  return round2(Math.max(0, hours) * Math.max(0, rate));
}

// 单张工单费用汇总
export function orderCosts(order) {
  const materialCost = materialCostOf(order.materials);
  const laborCost = laborCostOf(order.workHours, order.hourlyRate);
  return {
    materialCost,
    laborCost,
    total: round2(materialCost + laborCost)
  };
}

export function withCosts(order) {
  return { ...order, ...orderCosts(order) };
}

// 汇总一批工单的费用
export function sumCosts(orders = []) {
  const result = { materialCost: 0, laborCost: 0, total: 0 };
  for (const order of orders) {
    const costs = orderCosts(order);
    result.materialCost = round2(result.materialCost + costs.materialCost);
    result.laborCost = round2(result.laborCost + costs.laborCost);
    result.total = round2(result.total + costs.total);
  }
  return result;
}
