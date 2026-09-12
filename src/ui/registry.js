// 登记管理：楼栋 / 房间 / 常用设备 / 维修人 / 设置
import { openModal } from "./modal.js";
import { escapeHtml, options, toast } from "./widgets.js";

export function openRegistry(ctx) {
  const { repo } = ctx;
  const d = repo.data;

  const modal = openModal({
    title: "登记管理",
    wide: true,
    body: `
      <div class="registry-grid">
        <section class="panel-box">
          <h4>楼栋</h4>
          <form id="f-building" class="inline-form">
            <input name="name" placeholder="楼栋名称，如 3栋" required>
            <button class="btn btn-primary" type="submit">添加</button>
          </form>
          <ul class="reg-list">
            ${d.buildings.map((b) => `
              <li><span>${escapeHtml(b.name)}</span>
                <span class="muted">${d.rooms.filter((r) => r.buildingId === b.id).length} 间房</span>
                <button class="link-btn danger" data-del-building="${b.id}">删除</button></li>`).join("") || `<li class="muted">暂无</li>`}
          </ul>
        </section>

        <section class="panel-box">
          <h4>房间</h4>
          <form id="f-room" class="inline-form grid2">
            <select name="buildingId" required>${options(d.buildings, { label: (b) => b.name, blank: "选择楼栋" })}</select>
            <input name="name" placeholder="房间号，如 502" required>
            <input name="ownerName" placeholder="业主姓名（可选）">
            <input name="phone" placeholder="联系电话（可选）">
            <button class="btn btn-primary" type="submit">添加</button>
          </form>
          <ul class="reg-list">
            ${d.rooms.map((r) => {
              const b = d.buildings.find((x) => x.id === r.buildingId);
              return `<li><span>${escapeHtml(b ? b.name : "?")} ${escapeHtml(r.name)}</span>
                <span class="muted">${escapeHtml(r.ownerName || "")} ${escapeHtml(r.phone || "")}</span>
                <button class="link-btn danger" data-del-room="${r.id}">删除</button></li>`;
            }).join("") || `<li class="muted">暂无</li>`}
          </ul>
        </section>

        <section class="panel-box">
          <h4>常用设备</h4>
          <form id="f-device" class="inline-form grid2">
            <input name="name" placeholder="设备名，如 空调" required>
            <input name="brand" placeholder="品牌（可选）">
            <input name="defaultPrice" type="number" min="0" step="0.01" placeholder="常用配件参考价">
            <button class="btn btn-primary" type="submit">添加</button>
          </form>
          <ul class="reg-list">
            ${d.devices.map((x) => `
              <li><span>${escapeHtml(x.name)}${x.brand ? ` · ${escapeHtml(x.brand)}` : ""}</span>
                <span class="muted">参考价 ¥${x.defaultPrice || 0}</span>
                <button class="link-btn danger" data-del-device="${x.id}">删除</button></li>`).join("") || `<li class="muted">暂无</li>`}
          </ul>
        </section>

        <section class="panel-box">
          <h4>维修人</h4>
          <form id="f-worker" class="inline-form grid2">
            <input name="name" placeholder="姓名" required>
            <input name="trade" placeholder="工种，如 水电">
            <input name="phone" placeholder="电话（可选）">
            <button class="btn btn-primary" type="submit">添加</button>
          </form>
          <ul class="reg-list">
            ${d.workers.map((w) => `
              <li><span>${escapeHtml(w.name)}</span>
                <span class="muted">${escapeHtml(w.trade || "")} ${escapeHtml(w.phone || "")}</span>
                <button class="link-btn danger" data-del-worker="${w.id}">删除</button></li>`).join("") || `<li class="muted">暂无</li>`}
          </ul>
        </section>

        <section class="panel-box span-2">
          <h4>费用设置</h4>
          <form id="f-settings" class="inline-form">
            <label>默认工时单价（元/小时）<input name="defaultHourlyRate" type="number" min="0" step="0.01" value="${d.settings.defaultHourlyRate}"></label>
            <label>月度预算（元）<input name="monthlyBudget" type="number" min="0" step="0.01" value="${d.settings.monthlyBudget}"></label>
            <button class="btn btn-primary" type="submit">保存设置</button>
          </form>
        </section>
      </div>`
  });

  const body = modal.body;
  const rerender = () => {
    modal.close();
    ctx.rerender();
    openRegistry(ctx);
  };

  body.querySelector("#f-building").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      repo.createBuilding(Object.fromEntries(new FormData(e.target).entries()));
      toast("楼栋已添加", "success");
      rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  body.querySelector("#f-room").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      repo.createRoom(Object.fromEntries(new FormData(e.target).entries()));
      toast("房间已添加", "success");
      rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  body.querySelector("#f-device").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      repo.createDevice(Object.fromEntries(new FormData(e.target).entries()));
      toast("设备已添加", "success");
      rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  body.querySelector("#f-worker").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      repo.createWorker(Object.fromEntries(new FormData(e.target).entries()));
      toast("维修人已添加", "success");
      rerender();
    } catch (err) {
      toast(err.message, "error");
    }
  });
  body.querySelector("#f-settings").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    repo.updateSettings(v);
    toast("设置已保存", "success");
    modal.close();
    ctx.rerender();
  });

  body.querySelectorAll("[data-del-building]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("删除该楼栋及其房间？相关工单会保留但显示为未知房间。")) {
        repo.deleteBuilding(btn.dataset.delBuilding);
        rerender();
      }
    }));
  body.querySelectorAll("[data-del-room]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("删除该房间？相关工单会保留但显示为未知房间。")) {
        repo.deleteRoom(btn.dataset.delRoom);
        rerender();
      }
    }));
  body.querySelectorAll("[data-del-device]").forEach((btn) =>
    btn.addEventListener("click", () => {
      repo.deleteDevice(btn.dataset.delDevice);
      rerender();
    }));
  body.querySelectorAll("[data-del-worker]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("删除该维修人？历史工单中的姓名记录仍保留。")) {
        repo.deleteWorker(btn.dataset.delWorker);
        rerender();
      }
    }));
}
