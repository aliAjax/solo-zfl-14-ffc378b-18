// 新建维修单弹窗
import { STATUS_LABELS, PRIORITY, PRIORITY_LABELS } from "../model/constants.js";
import { findRoom } from "../model/registries.js";
import { toDatetimeLocalInput, clampNumber } from "../model/util.js";
import { openModal, lockButton } from "./modal.js";
import { options, toast, escapeHtml } from "./widgets.js";

export function openNewOrder(ctx) {
  const { repo } = ctx;
  const data = repo.data;
  if (!data.rooms.length) {
    toast("请先在「登记管理」中添加楼栋和房间", "error");
    return;
  }

  const modal = openModal({
    title: "新建维修单",
    wide: true,
    body: `
      <form id="order-form" class="form-grid">
        <label>楼栋<select name="buildingId" required>${options(data.buildings, { label: (b) => b.name, blank: "请选择楼栋" })}</select></label>
        <label>房间<select name="roomId" required><option value="">请先选择楼栋</option></select></label>
        <label>设备（可选）<select name="deviceId">${options(data.devices, { label: (d) => d.name, blank: "非设备类问题" })}</select></label>
        <label>优先级
          <select name="priority">
            ${Object.values(PRIORITY).map((p) => `<option value="${p}" ${p === PRIORITY.MEDIUM ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
          </select>
        </label>
        <label class="span-2">问题描述<input name="title" required maxlength="80" placeholder="例如：客厅空调不制冷"></label>
        <label class="span-2">情况说明<textarea name="description" rows="2" placeholder="故障现象、联系人备注等"></textarea></label>
        <label>预约上门时间<input name="visitAt" type="datetime-local" value="${toDatetimeLocalInput(new Date(ctx.now() + 3600_000))}"></label>
        <label>预算（元）<input name="budget" type="number" min="0" step="0.01" value="0"></label>
        <label>工时单价（元/小时）<input name="hourlyRate" type="number" min="0" step="0.01" value="${data.settings.defaultHourlyRate}"></label>
      </form>`,
    footer: `<button type="button" class="btn" data-close>取消</button>
             <button type="button" class="btn btn-primary" id="submit-order">提交工单</button>`
  });

  const form = modal.body.querySelector("#order-form");
  const buildingSel = form.elements.buildingId;
  const roomSel = form.elements.roomId;
  const deviceSel = form.elements.deviceId;

  const refreshRooms = () => {
    const rooms = data.rooms.filter((r) => r.buildingId === buildingSel.value);
    roomSel.innerHTML = options(rooms, { label: (r) => r.name, blank: "请选择房间" });
  };
  buildingSel.addEventListener("change", refreshRooms);
  if (buildingSel.value) refreshRooms();

  // 选择设备时给出参考耗材单价提示
  deviceSel.addEventListener("change", () => {
    const d = data.devices.find((x) => x.id === deviceSel.value);
    if (d?.defaultPrice > 0) toast(`「${d.name}」常用配件参考价 ¥${d.defaultPrice}`, "info");
  });

  modal.foot.querySelector("[data-close]").addEventListener("click", modal.close);
  modal.foot.querySelector("#submit-order").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const unlock = lockButton(button);
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      if (!payload.roomId) throw new Error("请选择房间");
      // 模拟异步 + 防重复提交：提交期间再次点击会被 withSubmitLock 拒绝
      await repo.withSubmitLock(`create-${buildingSel.value}-${payload.roomId}-${payload.title}`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        const order = repo.createOrderDraft({
          roomId: payload.roomId,
          deviceId: payload.deviceId,
          title: payload.title,
          description: payload.description,
          priority: payload.priority,
          visitAt: payload.visitAt,
          budget: payload.budget,
          hourlyRate: clampNumber(payload.hourlyRate)
        });
        const room = findRoom(data, order.roomId);
        toast(`工单 ${order.code} 已创建（${room ? room.name : ""}）`, "success");
        modal.close();
        ctx.rerender();
        ctx.openOrder(order.id);
      });
    } catch (err) {
      toast(err.message || "创建失败", "error");
      unlock();
    }
  });
}
