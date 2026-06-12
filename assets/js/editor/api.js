// Worker API access: the authenticated fetch wrapper, password auth, editor bootstrap,
// and loading the open-PR badge map.
import { state, API_BASE } from "./state.js";
import { set, del } from "../shared/storage.js";
import { showToast } from "./ui.js";
import { loadChaptersList, updateChapterBadges } from "./chapters.js";

export async function fetchAPI(path, options = {}) {
  const headers = { ...options.headers, Authorization: "Bearer " + state.sessionToken };
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    // Session expired/invalid (tokens last 24h, and resume doesn't pre-check them) — drop the
    // token and return to the password screen instead of leaving a dead "Unauthorized" editor.
    if (res.status === 401) {
      del("gsgw_editor_token");
      state.sessionToken = null;
      document.getElementById("editorContainer").classList.add("hidden");
      document.getElementById("authScreen").classList.remove("hidden");
    }
    const text = await res.text();
    const msg = text
      ? text.startsWith("{")
        ? JSON.parse(text).error || text
        : text
      : res.statusText;
    throw new Error("API error: " + msg);
  }
  return res.json();
}

export async function authenticate() {
  const password = document.getElementById("passwordInput").value;
  try {
    const res = await fetch(API_BASE + "/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error("Invalid password");
    const data = await res.json();
    state.sessionToken = data.token;
    set("gsgw_editor_token", state.sessionToken);
    initializeEditor();
  } catch (e) {
    showToast("Authentication failed: " + e.message, "error");
  }
}

export async function initializeEditor() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("editorContainer").classList.remove("hidden");
  document.getElementById("status").textContent = "GSGW Chapter Editor";
  state.draftPRMap = {};
  await loadChaptersList();
  await loadDraftPRs();
}

export async function loadDraftPRs() {
  try {
    state.draftPRMap = await fetchAPI("/api/draft-prs");
    updateChapterBadges();
  } catch (e) {
    state.draftPRMap = {};
    updateChapterBadges();
  }
}
