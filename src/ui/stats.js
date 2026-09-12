// 顶部统计条
import { money } from "../model/util.js";
import { escapeHtml } from "./widgets.js";

export function renderStats(stats) {
  return `
    <section class="stats-grid">
      <div class="stat-card stat-accent">
        <span class="stat-label">待派单</span>
        <strong class="stat-value">${stats.pending}</strong>
      </div>
      <div class="stat-card ${stats.overdue > 0 ? "stat-danger" : ""}">
        <span class="stat-label">逾期工单</span>
        <strong class="stat-value">${stats.overdue}</strong>
      </div>
      <div class="stat-card ${stats.monthlyOverBudget ? "stat-danger" : ""}">
        <span class="stat-label">本月支出</span>
        <strong class="stat-value">${money(stats.monthSpend)}</strong>
        <span class="stat-sub">预算 ${money(stats.monthlyBudget)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">未完成预算</span>
        <strong class="stat-value">${money(stats.unfinishedBudget)}</strong>
        <span class="stat-sub">未完成 ${stats.unfinishedCount} 单</span>
      </div>
    </section>
    ${stats.monthlyOverBudget
      ? `<div class="alert alert-danger">⚠ 本月支出已超出月度预算 ${money(stats.monthSpend - stats.monthlyBudget)}，请控制开支。</div>`
      : stats.monthlyBudget > 0
        ? `<div class="alert">本月预算剩余 ${money(Math.max(0, stats.monthlyRemaining))}。</div>`
        : ""}
    ${stats.overBudgetOrders.length
      ? `<div class="alert alert-danger">⚠ 有 ${stats.overBudgetOrders.length} 张未完成工单实际费用已超出单票预算。</div>`
      : ""}
  `;
}
