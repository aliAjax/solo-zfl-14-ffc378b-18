import "./styles.css";
import { Repo } from "./model/repo.js";
import { MemoryStorage } from "./model/store.js";
import { dashboardStats } from "./model/query.js";
import { toDatetimeLocalInput } from "./model/util.js";
import { addBuilding, addRoom, addDevice, addWorker, createOrderSafe } from "./model/seed.js";
import { renderStats } from "./ui/stats.js";
import { renderList, bindList } from "./ui/list.js";
import { openNewOrder } from "./ui/order-form.js";
import { openOrderDetail } from "./ui/order-detail.js";
import { openRegistry } from "./ui/registry.js";
import { openBackup } from "./ui/backup.js";
import { toast } from "./ui/widgets.js";

const FILTER_KEY = "prd:ui:v1";

class AppUI {
  constructor() {
    this.criteria = { buildingId: "", status: "", priority: "", assigneeId: "", keyword: "" };
    this.sort = { by: "visitAt", dir: "asc" };
    this.load();
  }
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(FILTER_KEY) || "null");
      if (raw) {
        this.criteria = { ...this.criteria, ...(raw.criteria || {}) };
        this.sort = { ...this.sort, ...(raw.sort || {}) };
      }
    } catch { /* 忽略损坏的 UI 偏好 */ }
  }
  save() {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ criteria: this.criteria, sort: this.sort }));
  }
  reset() {
    this.criteria = { buildingId: "", status: "", priority: "", assigneeId: "", keyword: "" };
    this.sort = { by: "visitAt", dir: "asc" };
    this.save();
  }
}

function chooseStorage() {
  try {
    const probe = "__prd_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return new MemoryStorage();
  }
}

const storage = chooseStorage();
const repo = new Repo({ storage });

// 首次使用：写入演示基础数据，便于直接体验（可在备份中心清空/覆盖）
if (repo.data.buildings.length === 0 && repo.data.orders.length === 0) {
  seedDemo(repo, storage);
}

if (repo.loadInfo.source === "snapshot") {
  setTimeout(() => toast(`检测到本地数据损坏，已自动回退到 ${new Date(repo.loadInfo.snapshotAt).toLocaleString()} 的快照`, "error"), 400);
} else if (repo.loadInfo.source === "empty" && repo.loadInfo.error) {
  setTimeout(() => toast("本地数据损坏且无可用快照，已使用空库启动", "error"), 400);
}

const ui = new AppUI();
const app = document.querySelector("#app");

const ctx = {
  repo,
  ui,
  now: () => Date.now(),
  rerender: render,
  openOrder: (id) => openOrderDetail(ctx, id)
};

function render() {
  const stats = dashboardStats(repo.data, ctx.now());
  app.innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>物业维修派单台</h1>
          <span class="muted">离线版 · 数据仅存本机浏览器</span>
        </div>
        <nav class="top-actions">
          <button class="btn btn-primary" id="btn-new">＋ 新建维修单</button>
          <button class="btn" id="btn-registry">登记管理</button>
          <button class="btn" id="btn-backup">备份与恢复</button>
        </nav>
      </header>
      ${renderStats(stats)}
      <main class="content">${renderList(ctx)}</main>
      <footer class="footer muted">待派单 → 已接单 → 维修中 → 待验收 → 已验收；验收不通过退回已接单。</footer>
    </main>`;

  document.getElementById("btn-new").addEventListener("click", () => openNewOrder(ctx));
  document.getElementById("btn-registry").addEventListener("click", () => openRegistry(ctx));
  document.getElementById("btn-backup").addEventListener("click", () => openBackup(ctx));
  bindList(ctx);
}

function seedDemo(repoInstance, store) {
  // 用空数据建好后直接持久化，避免 demo 数据与真实数据混淆
  const b1 = addBuilding(repoInstance.data, { name: "1栋" });
  const b2 = addBuilding(repoInstance.data, { name: "2栋" });
  const r1 = addRoom(repoInstance.data, { buildingId: b1.id, name: "301", ownerName: "王女士", phone: "13800000001" });
  const r2 = addRoom(repoInstance.data, { buildingId: b1.id, name: "502", ownerName: "李先生", phone: "13800000002" });
  const r3 = addRoom(repoInstance.data, { buildingId: b2.id, name: "101", ownerName: "赵先生", phone: "13800000003" });
  addDevice(repoInstance.data, { name: "空调", brand: "通用", defaultPrice: 300 });
  addDevice(repoInstance.data, { name: "水管", brand: "PPR", defaultPrice: 25 });
  addDevice(repoInstance.data, { name: "门锁", brand: "", defaultPrice: 120 });
  const w1 = addWorker(repoInstance.data, { name: "张师傅", trade: "水电", phone: "13900000001" });
  const w2 = addWorker(repoInstance.data, { name: "陈师傅", trade: "综合", phone: "13900000002" });

  const now = Date.now();
  const HOUR = 3600_000;
  const visitLocal = (offset) => toDatetimeLocalInput(new Date(now + offset));
  createOrderSafe(repoInstance.data, {
    roomId: r1.id, title: "厨房水槽下渗水", priority: "high",
    budget: 400, visitAt: visitLocal(-26 * HOUR),
    assigneeId: w1.id, advance: ["accepted", "repairing"],
    workHours: 1.5, materials: [{ name: "PPR 弯头", qty: 2, price: 12 }]
  }, now);
  createOrderSafe(repoInstance.data, {
    roomId: r2.id, title: "卧室空调不制冷", priority: "medium",
    budget: 300, visitAt: visitLocal(-2 * HOUR),
    assigneeId: w2.id, advance: ["accepted", "repairing", "accepting_check"],
    workHours: 2, hourlyRate: 90, materials: [{ name: "制冷剂", qty: 1, price: 220 }]
  }, now);
  createOrderSafe(repoInstance.data, {
    roomId: r3.id, title: "入户门门锁松动", priority: "low",
    budget: 200, visitAt: visitLocal(24 * HOUR)
  }, now);
  createOrderSafe(repoInstance.data, {
    roomId: r2.id, title: "走廊吸顶灯不亮", priority: "low",
    budget: 150, visitAt: visitLocal(-50 * HOUR),
    assigneeId: w2.id, advance: ["accepted", "repairing", "accepting_check", "verified"],
    workHours: 1, hourlyRate: 80, materials: [{ name: "LED 灯盘", qty: 1, price: 35 }]
  }, now);
  store.save(repoInstance.data);
}

render();
