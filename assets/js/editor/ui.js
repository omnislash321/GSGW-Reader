// Editor UI chrome: theme, sidebar drawer, the confirm + new-chapter modals, status line, toasts.
import { state } from "./state.js";
import { set } from "../shared/storage.js";
import { applyThemeAssets } from "../shared/theme-assets.js";

export function switchTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  applyThemeAssets(theme);
  set("gsgw_editor_theme", theme);
}

export function toggleSidebar() {
  const open = document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarBackdrop").classList.toggle("open", open);
}
export function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebarBackdrop").classList.remove("open");
}

export function showModal(title, message, onConfirm) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalMessage").textContent = message;
  state.pendingModalAction = onConfirm;
  document.getElementById("confirmModal").classList.remove("hidden");
}
export function closeModal() {
  document.getElementById("confirmModal").classList.add("hidden");
  state.pendingModalAction = null;
}
export function confirmModal() {
  if (state.pendingModalAction) state.pendingModalAction();
  closeModal();
}

export function promptNewChapter() {
  document.getElementById("newChNumber").value = "";
  document.getElementById("newChTitle").value = "";
  document.getElementById("newChapterModal").classList.remove("hidden");
  document.getElementById("newChNumber").focus();
}
export function closeNewChapterModal() {
  document.getElementById("newChapterModal").classList.add("hidden");
}

export function updateStatus() {
  const status = document.getElementById("status");
  if (state.lastSaveTime) {
    const time = state.lastSaveTime.toLocaleTimeString();
    status.textContent = state.unsavedChanges ? "Unsaved changes" : "Saved at " + time;
  }
}

export function showToast(msg, type = "info", duration = 3000) {
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
