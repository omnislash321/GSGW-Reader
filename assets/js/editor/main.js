// Editor entry point — loaded as a native ES module. Wires the DOM on load (theme, editor
// surface, toolbar, metadata, the controls/modals that used to be inline on* handlers, and
// auth resume), plus the unsaved-changes guard and the 5-minute autosave.
import { state } from "./state.js";
import { get } from "../shared/storage.js";
import { runCommand, applyColor, applyFontSize, updateToolbarState } from "./format.js";
import {
  switchTheme,
  toggleSidebar,
  closeSidebar,
  showModal,
  closeModal,
  confirmModal,
  showToast,
  updateStatus,
  promptNewChapter,
  closeNewChapterModal,
} from "./ui.js";
import { authenticate, initializeEditor } from "./api.js";
import { saveChapter, revertChapter, createPR, createNewChapter } from "./chapters.js";

document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = get("gsgw_editor_theme", "nightfall");
  switchTheme(savedTheme);
  document.getElementById("themeSelect").value = savedTheme;

  state.editor = document.getElementById("editor");

  // Make Enter create <p> instead of <div>; format with tags not inline styles
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch (e) {}
  try {
    document.execCommand("styleWithCSS", false, false);
  } catch (e) {}

  state.editor.addEventListener("input", () => {
    if (!state.isLoadingChapter) {
      state.unsavedChanges = true;
      updateStatus();
    }
  });
  state.editor.addEventListener("keyup", updateToolbarState);
  state.editor.addEventListener("mouseup", updateToolbarState);

  // Remember the editor's selection so toolbar inputs can restore it
  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (sel.rangeCount && state.editor.contains(sel.anchorNode)) {
      state.lastEditorRange = sel.getRangeAt(0).cloneRange();
    }
  });

  // Toolbar wiring
  document.getElementById("toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cmd]");
    if (!btn) return;
    e.preventDefault();
    runCommand(btn.dataset.cmd);
  });
  document.getElementById("colorPicker").addEventListener("input", (e) => {
    document.getElementById("colorHex").value = e.target.value;
    applyColor(e.target.value);
  });
  const colorHex = document.getElementById("colorHex");
  colorHex.addEventListener("change", () => {
    let v = colorHex.value.trim();
    if (!v.startsWith("#")) v = "#" + v;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      colorHex.value = v;
      document.getElementById("colorPicker").value =
        v.length === 4
          ? "#" +
            v
              .slice(1)
              .split("")
              .map((c) => c + c)
              .join("")
          : v;
      applyColor(v);
    } else {
      showToast("Invalid hex color", "error");
    }
  });
  document.getElementById("fontSizeSelect").addEventListener("change", (e) => {
    if (e.target.value) applyFontSize(e.target.value);
    e.target.value = "";
  });

  document.getElementById("metaTitle").addEventListener("change", () => {
    if (!state.isLoadingChapter) state.unsavedChanges = true;
    updateStatus();
  });
  document.getElementById("metaNumber").addEventListener("change", () => {
    if (!state.isLoadingChapter) state.unsavedChanges = true;
    updateStatus();
  });

  // Controls + modals (previously inline on* attributes in editor.html)
  document
    .getElementById("themeSelect")
    .addEventListener("change", (e) => switchTheme(e.target.value));
  document.getElementById("menuToggle").addEventListener("click", toggleSidebar);
  document.getElementById("sidebarBackdrop").addEventListener("click", closeSidebar);
  document.getElementById("addChapterBtn").addEventListener("click", promptNewChapter);
  document.getElementById("saveBtn").addEventListener("click", saveChapter);
  document.getElementById("revertBtn").addEventListener("click", revertChapter);
  document.getElementById("prBtn").addEventListener("click", (e) => createPR(e));
  document.getElementById("authEnter").addEventListener("click", authenticate);
  document.getElementById("modalCancel").addEventListener("click", closeModal);
  document.getElementById("modalConfirm").addEventListener("click", confirmModal);
  document.getElementById("newChCancel").addEventListener("click", closeNewChapterModal);
  document.getElementById("newChCreate").addEventListener("click", createNewChapter);

  const pwd = get("gsgw_editor_token", null);
  if (pwd) {
    state.sessionToken = pwd;
    initializeEditor();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (state.unsavedChanges) {
    e.preventDefault();
    e.returnValue = "";
  }
});

setInterval(
  () => {
    if (state.unsavedChanges && state.currentChapter) saveChapter();
  },
  5 * 60 * 1000,
);
