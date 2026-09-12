// 工单列表：筛选 / 排序 / 逾期标红
import { STATUS, STATUS_LABELS, PRIORITY, PRIORITY_LABELS } from "../model/constants.js";
import { queryOrders } from "../model/query.js";
import { money } from "../model/util.js";
import { escapeHtml, fmtTime, options, statusBadge, priorityTag } from "./widgets.js";

export function renderList(ctx) {
  const { repo, ui } = ctx;
  const rows = queryOrders(repo.data, ui.criteria, ui.sort, ctx.now());

  return `
    <section class="list-panel">
      <div class="filter-bar">
        <label>楼栋
          <select id="f-building">
            <option value="">全部楼栋</option>
            ${repo.data.buildings.map((b) => `<option value="${b.id}" ${ui.criteria.buildingId === b.id ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
          </select>
        </label>
        <label>状态
          <select id="f-status">
            <option value="">全部状态</option>
            ${Object.values(STATUS).map((s) => `<option value="${s}" ${ui.criteria.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </label>
        <label>优先级
          <select id="f-priority">
            <option value="">全部</option>
            ${Object.values(PRIORITY).map((p) => `<option value="${p}" ${ui.criteria.priority === p ? "selected" : ""}>${PRIORITY_LABELS[p]}</option>`).join("")}
          </select>
        </label>
        <label>维修人
          <select id="f-assignee">${options(repo.data.workers, { label: (w) => w.name, selected: ui.criteria.assigneeId, blank: "全部维修人" })}</select>
        </label>
        <label class="grow">搜索<input id="f-keyword" value="${escapeHtml(ui.criteria.keyword || "")}" placeholder="单号 / 描述 / 房间"></label>
        <label>排序
          <select id="f-sortby">
            <option value="visitAt" ${ui.sort.by === "visitAt" ? "selected" : ""}>上门时间</option>
            <option value="budget" ${ui.sort.by === "budget" ? "selected" : ""}>预算</option>
            <option value="updatedAt" ${ui.sort.by === "updatedAt" ? "selected" : ""}>更新时间</option>
          </select>
        </label>
        <label>方向
          <select id="f-sortdir">
            <option value="asc" ${ui.sort.dir === "asc" ? "selected" : ""}>升序</option>
            <option value="desc" ${ui.sort.dir === "desc" ? "selected" : ""}>降序</option>
          </select>
        </label>
        <button class="btn" id="f-reset">重置</button>
      </div>

      <div class="table-wrap">
        <table class="order-table">
          <thead>
            <tr>
              <th>单号</th><th>楼栋/房间</th><th>问题</th><th>优先级</th><th>状态</th>
              <th>维修人</th><th>上门时间</th><th>预算</th><th>材料费</th><th>人工费</th><th>总费用</th><th>更新时间</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((o) => `
              <tr class="${o.overdue ? "row-overdue" : ""} ${o.status === "verified" ? "row-done" : ""}" data-order="${o.id}">
                <td class="nowrap">${escapeHtml(o.code || "—")}</td>
                <td class="nowrap">${escapeHtml(o.buildingName || "?")} ${escapeHtml(o.roomName)}${o.roomMissing ? ` <span class="warn-tag">房间已删</span>` : ""}</td>
                <td class="title-cell">${escapeHtml(o.title)}${o.deviceName ? ` <span class="muted">(${escapeHtml(o.deviceName)})</span>` : ""}</td>
                <td>${priorityTag(o.priority)}</td>
                <td>${statusBadge(o.status)}</td>
                <td class="nowrap">${escapeHtml(o.assigneeName)}</td>
                <td class="nowrap ${o.overdue ? "overdue-text" : ""}">${fmtTime(o.visitAt)}${o.overdue ? ` <span class="warn-tag">逾期</span>` : ""}</td>
                <td class="nowrap">${money(o.budget)}</td>
                <td class="nowrap">${money(o.materialCost)}</td>
                <td class="nowrap">${money(o.laborCost)}</td>
                <td class="nowrap ${o.budget > 0 && o.total > o.budget ? "overdue-text" : ""}">${money(o.total)}</td>
                <td class="nowrap muted">${fmtTime(o.updatedAt)}</td>
                <td class="nowrap"><button class="btn btn-sm" data-open="${o.id}">处理</button>
                  <button class="link-btn danger" data-delete="${o.id}">删</button></td>
              </tr>`).join("")
              : `<tr><td colspan="13" class="empty-row">没有符合条件的工单</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="muted list-foot">共 ${rows.length} 张工单 · 红色行表示已超过上门时间仍未验收</p>
    </section>`;
}

export function bindList(ctx) {
  const { ui, repo } = ctx;
  const sync = () => {
    ui.save();
    ctx.rerender();
  };

  const bindSelect = (id, key, target = ui.criteria) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      target[key] = e.target.value;
      sync();
    });
  };
  bindSelect("f-building", "buildingId");
  bindSelect("f-status", "status");
  bindSelect("f-priority", "priority");
  bindSelect("f-assignee", "assigneeId");
  bindSelect("f-sortby", "by", ui.sort);
  bindSelect("f-sortdir", "dir", ui.sort);

  const kw = document.getElementById("f-keyword");
  let timer = null;
  kw?.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ui.criteria.keyword = e.target.value;
      sync();
    }, 250);
  });

  document.getElementById("f-reset")?.addEventListener("click", () => {
    ui.reset();
    sync();
  });

  document.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      ctx.openOrder(btn.dataset.open);
    });
  });
  document.querySelectorAll("tr[data-order]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      ctx.openOrder(tr.dataset.order);
    });
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const order = repo.data.orders.find((o) => o.id === btn.dataset.delete);
      if (confirm(`删除工单 ${order?.code || ""}？此操作不可撤销（可在备份中心回退快照）。`)) {
        repo.deleteOrder(btn.dataset.delete);
        ctx.rerender();
      }
    });
  });
}
