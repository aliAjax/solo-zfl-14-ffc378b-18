// 备份中心：导出、导入、自动快照回退
import { openModal } from "./modal.js";
import { escapeHtml, fmtDateTime, toast } from "./widgets.js";

export function openBackup(ctx) {
  const { repo } = ctx;
  const snaps = repo.listSnapshots();

  const modal = openModal({
    title: "备份与恢复",
    wide: true,
    body: `
      <div class="backup-wrap">
        <section class="panel-box">
          <h4>导出备份</h4>
          <p class="muted">数据只保存在本机浏览器，不联网。建议定期导出为 JSON 文件留档。</p>
          <button class="btn btn-primary" id="btn-export">导出为 JSON 文件</button>
          <button class="btn" id="btn-copy">复制到剪贴板</button>
        </section>

        <section class="panel-box">
          <h4>导入备份</h4>
          <p class="muted">导入会覆盖当前全部数据（覆盖前自动留存快照，可回退）。</p>
          <input type="file" id="import-file" accept="application/json,.json">
          <textarea id="import-text" rows="5" placeholder="也可以直接粘贴备份 JSON 文本"></textarea>
          <div>
            <button class="btn btn-primary" id="btn-import-file">导入文件</button>
            <button class="btn" id="btn-import-text">导入文本</button>
          </div>
        </section>

        <section class="panel-box span-2">
          <h4>自动快照（最近 ${snaps.length} 份）</h4>
          <p class="muted">每次保存前自动保留最近 10 份数据快照；主数据损坏时会自动回退到最近一份完好快照。</p>
          <ul class="reg-list">
            ${snaps.length
              ? snaps.slice().reverse().map((s) => `
                <li>
                  <span>${fmtDateTime(s.savedAt)}</span>
                  <span class="muted">${(s.data.orders || []).length} 张工单 · ${(s.data.buildings || []).length} 栋楼</span>
                  <button class="btn" data-rollback="${s.id}">回退到此版本</button>
                </li>`).join("")
              : `<li class="muted">还没有快照，保存几次数据后自动生成。</li>`}
          </ul>
        </section>
      </div>`
  });

  modal.body.querySelector("#btn-export").addEventListener("click", () => {
    const text = repo.exportBackup();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `维修派单备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("已导出备份文件", "success");
  });

  modal.body.querySelector("#btn-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(repo.exportBackup());
      toast("备份 JSON 已复制", "success");
    } catch {
      toast("复制失败，请用导出文件", "error");
    }
  });

  const doImport = (text, sourceName) => {
    try {
      repo.importBackup(text);
      toast(`已导入${sourceName}`, "success");
      modal.close();
      ctx.rerender();
    } catch (err) {
      toast(`导入失败：${err.message}`, "error");
    }
  };

  modal.body.querySelector("#btn-import-file").addEventListener("click", () => {
    const input = modal.body.querySelector("#import-file");
    const file = input.files?.[0];
    if (!file) {
      toast("请先选择备份文件", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result), "文件");
    reader.onerror = () => toast("读取文件失败", "error");
    reader.readAsText(file);
  });

  modal.body.querySelector("#btn-import-text").addEventListener("click", () => {
    const text = modal.body.querySelector("#import-text").value.trim();
    if (!text) {
      toast("请粘贴备份 JSON", "error");
      return;
    }
    doImport(text, "文本");
  });

  modal.body.querySelectorAll("[data-rollback]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const snapshotId = btn.dataset.rollback;
      if (!confirm("确定回退到该快照？当前数据会先留存一份快照。")) return;
      try {
        repo.rollback(savedAt);
        toast("已回退", "success");
        modal.close();
        ctx.rerender();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}
