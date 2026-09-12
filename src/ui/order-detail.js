// 工单详情弹窗：状态流转操作 + 工时/耗材录入 + 派单/编辑
import {
  STATUS,
  STATUS_LABELS,
  PRIORITY_LABELS
} from "../model/constants.js";
import { decorateOrder } from "../model/query.js";
import { money, toDatetimeLocalInput, round2 } from "../model/util.js";
import { openModal, lockButton } from "./modal.js";
import { escapeHtml, fmtDateTime, options, toast } from "./widgets.js";

export function openOrderDetail(ctx, orderId) {
  const { repo } = ctx;
  const order = repo.data.orders.find((o) => o.id === orderId);
  if (!order) return;
  const view = decorateOrder(repo.data, order, ctx.now());
  const readonly = order.status === STATUS.VERIFIED ? "readonly disabled" : "";

  const modal = openModal({
    title: `${order.code || "新工单"} · ${view.buildingName} ${view.roomName}`,
    wide: true,
    body: `
      <div class="detail-head">
        <div><h4>${escapeHtml(order.title)}</h4>
          <p class="muted">${escapeHtml(order.description || "无情况说明")}</p>
        </div>
        <div class="detail-tags">
          <span class="badge status-${order.status}">${STATUS_LABELS[order.status]}</span>
          <span class="badge priority-${order.priority}">${PRIORITY_LABELS[order.priority]}</span>
          ${view.overdue ? `<span class="badge badge-overdue">已逾期</span>` : ""}
        </div>
      </div>

      ${renderDispatchSection(ctx, order)}

      <section class="detail-section">
        <h5>费用明细</h5>
        <div class="cost-grid">
          <div><span>材料费</span><strong id="cost-material">${money(view.materialCost)}</strong></div>
          <div><span>人工费</span><strong id="cost-labor">${money(view.laborCost)}</strong></div>
          <div class="${view.budget > 0 && view.total > view.budget ? "cost-over" : ""}">
            <span>总费用 / 预算</span><strong id="cost-total">${money(view.total)} / ${money(view.budget)}</strong>
          </div>
        </div>
        ${view.budget > 0 && view.total > view.budget ? `<div class="alert alert-danger">实际费用已超预算 ${money(view.total - view.budget)}</div>` : ""}
      </section>

      <section class="detail-section">
        <h5>工时与耗材${order.status === STATUS.VERIFIED ? "（已验收，只读）" : ""}</h5>
        <form id="work-form" class="work-form">
          <div class="work-row">
            <label>工时（小时）<input name="workHours" type="number" min="0" step="0.25" value="${order.workHours}" ${readonly}></label>
            <label>工时单价<input name="hourlyRate" type="number" min="0" step="0.01" value="${order.hourlyRate}" ${readonly}></label>
            ${order.status === STATUS.VERIFIED ? "" : '<button type="button" class="btn" id="save-work">保存工时</button>'}
          </div>
          ${order.status === STATUS.VERIFIED ? "" : `
          <div class="work-row">
            <input name="mName" placeholder="耗材名称（如 PPR 管）">
            <input name="mQty" type="number" min="0" step="1" placeholder="数量">
            <input name="mPrice" type="number" min="0" step="0.01" placeholder="单价">
            <button type="button" class="btn" id="add-material">添加耗材</button>
          </div>`}
        </form>
        <table class="mini-table">
          <thead><tr><th>耗材</th><th>数量</th><th>单价</th><th>小计</th><th></th></tr></thead>
          <tbody>
            ${order.materials.length
              ? order.materials.map((m, i) => `
                <tr>
                  <td>${escapeHtml(m.name)}</td><td>${m.qty}</td><td>${money(m.price)}</td>
                  <td>${money(m.qty * m.price)}</td>
                  <td>${readonly ? "" : `<button type="button" class="link-btn danger" data-del-material="${i}">删除</button>`}</td>
                </tr>`).join("")
              : `<tr><td colspan="5" class="muted center">暂无耗材</td></tr>`}
          </tbody>
        </table>
      </section>

      <section class="detail-section">
        <h5>流转记录</h5>
        <ul class="history">
          ${order.history.map((h) => `
            <li><span class="muted">${fmtDateTime(h.at)}</span>
              <span class="badge status-${h.status}">${STATUS_LABELS[h.status] || h.status}</span>
              ${h.note ? escapeHtml(h.note) : ""}</li>`).join("")}
        </ul>
      </section>`,
    footer: renderFooter(ctx, order)
  });

  // 保存工时
  modal.body.querySelector("#save-work")?.addEventListener("click", () => {
    const f = modal.body.querySelector("#work-form");
    try {
      repo.saveWorkReport(order.id, {
        workHours: f.elements.workHours.value,
        hourlyRate: f.elements.hourlyRate.value
      });
      toast("工时已保存", "success");
      modal.close();
      ctx.rerender();
      reopen(ctx, orderId);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  // 添加耗材
  modal.body.querySelector("#add-material")?.addEventListener("click", () => {
    const f = modal.body.querySelector("#work-form");
    const name = f.elements.mName.value.trim();
    const qty = Number(f.elements.mQty.value);
    const price = Number(f.elements.mPrice.value);
    if (!name || !(qty > 0)) {
      toast("请填写耗材名称和数量", "error");
      return;
    }
    try {
      const fresh = repo.data.orders.find((o) => o.id === orderId);
      repo.saveWorkReport(orderId, {
        materials: [...fresh.materials, { name, qty, price: round2(price) }]
      });
      modal.close();
      ctx.rerender();
      reopen(ctx, orderId);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  modal.body.querySelectorAll("[data-del-material]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.delMaterial);
      const fresh = repo.data.orders.find((o) => o.id === orderId);
      const materials = fresh.materials.filter((_, i) => i !== idx);
      repo.saveWorkReport(orderId, { materials });
      modal.close();
      ctx.rerender();
      reopen(ctx, orderId);
    });
  });

  modal.foot.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleAction(ctx, btn, orderId, modal));
  });
  modal.foot.querySelector("[data-close]")?.addEventListener("click", modal.close);
  modal.body.querySelector("#dispatch-form")?.addEventListener("submit", (e) => e.preventDefault());
  modal.body.querySelector("#do-dispatch")?.addEventListener("click", (e) => doDispatch(ctx, e.currentTarget, orderId, modal));
  modal.body.querySelector("#save-edit")?.addEventListener("click", () => doEdit(ctx, orderId, modal));
}

function reopen(ctx, orderId) {
  openOrderDetail(ctx, orderId);
}

function renderDispatchSection(ctx, order) {
  const { repo } = ctx;
  if (order.status === STATUS.PENDING) {
    return `
      <section class="detail-section">
        <h5>派单 / 编辑</h5>
        <form id="dispatch-form" class="work-row">
          <label>维修人<select name="assigneeId" required>
            ${options(repo.data.workers, { label: (w) => w.trade ? `${w.name}（${w.trade}）` : w.name, blank: "请选择维修人" })}
          </select></label>
          <label>上门时间<input name="visitAt" type="datetime-local" value="${order.visitAt ? toDatetimeLocalInput(new Date(order.visitAt)) : ""}"></label>
          <label>预算<input name="budget" type="number" min="0" step="0.01" value="${order.budget}"></label>
          <label>工时单价<input name="hourlyRate" type="number" min="0" step="0.01" value="${order.hourlyRate}"></label>
          <button type="submit" class="btn btn-primary" id="do-dispatch">派单</button>
          <button type="button" class="btn" id="save-edit">仅保存</button>
        </form>
      </section>`;
  }
  const worker = repo.data.workers.find((w) => w.id === order.assigneeId);
  return `
    <section class="detail-section info-grid">
      <div><span class="muted">维修人</span><strong>${escapeHtml(worker ? worker.name : "—")} ${worker?.phone ? escapeHtml(worker.phone) : ""}</strong></div>
      <div><span class="muted">上门时间</span><strong>${fmtDateTime(order.visitAt)}</strong></div>
      <div><span class="muted">接单/开工</span><strong>${fmtDateTime(order.acceptedAt)} / ${fmtDateTime(order.startedAt)}</strong></div>
    </section>`;
}

function renderFooter(ctx, order) {
  const buttons = [`<button type="button" class="btn" data-close>关闭</button>`];
  const next = {
    [STATUS.ACCEPTED]: { to: STATUS.REPAIRING, label: "开始维修", cls: "btn-primary" },
    [STATUS.REPAIRING]: { to: STATUS.ACCEPTING, label: "提交验收", cls: "btn-primary" },
    [STATUS.ACCEPTING]: { to: STATUS.VERIFIED, label: "验收通过", cls: "btn-success" }
  }[order.status];
  if (next) {
    buttons.push(`<button type="button" class="btn ${next.cls}" data-action="advance" data-to="${next.to}">${next.label}</button>`);
  }
  if (order.status === STATUS.ACCEPTING) {
    buttons.push(`<button type="button" class="btn btn-danger" data-action="reject">验收不通过，退回</button>`);
  }
  return buttons.join("");
}

async function handleAction(ctx, button, orderId, modal) {
  const { repo } = ctx;
  const action = button.dataset.action;
  const unlock = lockButton(button);
  try {
    if (action === "advance") {
      const to = button.dataset.to;
      const order = repo.data.orders.find((o) => o.id === orderId);
      const payload = {};
      if (to === STATUS.ACCEPTING) {
        // 提交验收时把页面上的工时一并带上
        const f = modal.body.querySelector("#work-form");
        payload.workHours = f.elements.workHours.value;
        payload.hourlyRate = f.elements.hourlyRate.value;
      }
      await repo.withSubmitLock(`transition-${orderId}-${to}`, async () => {
        await new Promise((r) => setTimeout(r, 60));
        repo.advance(orderId, to, payload);
        toast(to === STATUS.VERIFIED ? "验收完成" : "状态已更新", "success");
      });
      modal.close();
      ctx.rerender();
      reopen(ctx, orderId);
    } else if (action === "reject") {
      const note = window.prompt("请填写验收不通过的原因（退回给维修人）：", "");
      if (note === null) return;
      repo.rejectVerification(orderId, note.trim() || "验收不通过");
      toast("已退回维修人（已接单）", "success");
      modal.close();
      ctx.rerender();
      reopen(ctx, orderId);
    }
  } catch (err) {
    toast(err.message || "操作失败", "error");
    unlock();
  }
}

function doDispatch(ctx, button, orderId, modal) {
  const { repo } = ctx;
  const form = modal.body.querySelector("#dispatch-form");
  const unlock = lockButton(button);
  const f = form.elements;
  try {
    if (!f.assigneeId.value) throw new Error("请选择维修人");
    repo.dispatch(orderId, {
      assigneeId: f.assigneeId.value,
      visitAt: f.visitAt.value,
      hourlyRate: f.hourlyRate.value,
      budget: f.budget.value
    });
    toast("派单成功", "success");
    modal.close();
    ctx.rerender();
    reopen(ctx, orderId);
  } catch (err) {
    toast(err.message, "error");
    unlock();
  }
}

function doEdit(ctx, orderId, modal) {
  const { repo } = ctx;
  const f = modal.body.querySelector("#dispatch-form").elements;
  try {
    repo.editOrder(orderId, {
      visitAt: f.visitAt.value,
      budget: f.budget.value
    });
    toast("已保存", "success");
    modal.close();
    ctx.rerender();
    reopen(ctx, orderId);
  } catch (err) {
    toast(err.message, "error");
  }
}
