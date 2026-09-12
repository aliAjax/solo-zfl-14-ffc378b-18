// 通用模态框
import { el, escapeHtml } from "./widgets.js";

export function openModal({ title, body = "", footer = "", onClose, wide = false }) {
  const overlay = el(`
    <div class="modal-overlay">
      <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="modal-close icon-btn" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
      </div>
    </div>`);
  document.body.appendChild(overlay);

  const close = () => {
    if (!overlay.isConnected) return;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  return {
    overlay,
    close,
    body: overlay.querySelector(".modal-body"),
    foot: overlay.querySelector(".modal-foot")
  };
}

// 给提交按钮加防重复提交锁，返回解除函数
export function lockButton(button) {
  if (button.disabled) return () => {};
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = "处理中…";
  return () => {
    button.disabled = false;
    button.textContent = button.dataset.originalText;
  };
}
