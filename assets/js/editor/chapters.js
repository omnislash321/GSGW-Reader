// Chapter lifecycle: load the list, create/select/load/save chapters, revert drafts,
// create or update the PR, and paint the per-chapter sidebar badges.
import { state } from "./state.js";
import { fetchAPI, loadDraftPRs } from "./api.js";
import { showToast, showModal, updateStatus, closeNewChapterModal, closeSidebar } from "./ui.js";
import { normalizeOutput } from "./format.js";

export async function loadChaptersList() {
  try {
    const committed = await fetchAPI("/api/chapters");
    state.committedChapters = new Set(committed);
    // Merge in chapters that exist only as drafts (e.g. newly added, not yet committed)
    let draftChapters = [];
    try {
      draftChapters = Object.keys((await fetchAPI("/api/chapter-drafts")) || {});
    } catch (e) {}
    state.locallyAddedChapters.forEach((ch) => draftChapters.push(ch));
    draftChapters = draftChapters.filter((ch) => !state.locallyDiscardedChapters.has(ch));
    state.draftChapterSet = new Set(draftChapters);
    const all = [...new Set([...committed, ...draftChapters])].sort(
      (a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)),
    );

    const list = document.getElementById("chapterList");
    list.innerHTML = "";
    all.forEach((ch) => {
      const li = document.createElement("li");
      li.textContent = ch;
      li.dataset.chapter = ch;
      li.onclick = () => selectChapter(ch);
      list.appendChild(li);
    });
    updateChapterBadges();
  } catch (e) {
    showToast("Failed to load chapters: " + e.message, "error");
  }
}

export async function createNewChapter() {
  const num = document.getElementById("newChNumber").value.trim();
  const title = document.getElementById("newChTitle").value.trim() || "Chapter " + num;
  if (!/^\d+$/.test(num)) return showToast("Chapter number must be digits only", "error");
  const ch = "ch" + num;
  if (
    state.committedChapters.has(ch) ||
    document.querySelector(`.chapter-list li[data-chapter="${ch}"]`)
  ) {
    return showToast("Chapter " + num + " already exists", "error");
  }
  try {
    document.getElementById("loadingOverlay").classList.remove("hidden");
    // Seed a draft so the chapter exists; createPR will write chapters/<num>.html
    await fetchAPI("/api/save/" + ch, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p></p>", metadata: { number: num, title } }),
    });
    state.locallyAddedChapters.add(ch);
    state.locallyDiscardedChapters.delete(ch);
    closeNewChapterModal();
    state.unsavedChanges = false;
    await loadChaptersList();
    await loadChapterContent(ch);
    showToast("Chapter " + num + " created — start writing, then Save");
  } catch (e) {
    showToast("Failed to create chapter: " + e.message, "error");
  } finally {
    document.getElementById("loadingOverlay").classList.add("hidden");
  }
}

export function updateChapterBadges() {
  document.querySelectorAll(".chapter-list li").forEach((li) => {
    const ch = li.dataset.chapter;
    const hasPR = state.draftPRMap[ch];
    const oldBadge = li.querySelector("span");
    if (oldBadge) oldBadge.remove();
    const badge = document.createElement("span");
    badge.style.cssText =
      "position: absolute; right: 0.5rem; font-size: 0.7rem; color: white; padding: 0.2rem 0.5rem; border-radius: 2px;";
    if (hasPR) {
      badge.style.background = "var(--accent)";
      badge.textContent = "PR";
      badge.title = hasPR.pr_title;
      li.appendChild(badge);
    } else if (!state.committedChapters.has(ch)) {
      // exists only as a draft → newly added, not yet committed
      badge.style.background = "#2ea043";
      badge.textContent = "NEW";
      badge.title = "Unpublished — will be created on next PR";
      li.appendChild(badge);
    } else if (state.draftChapterSet.has(ch)) {
      // committed chapter with a saved draft, not yet in a PR
      badge.style.background = "#d29922";
      badge.textContent = "EDITED";
      badge.title = "Saved local changes — not yet in a PR";
      li.appendChild(badge);
    }
  });
}

export function revertChapter() {
  if (!state.currentChapter) return showToast("No chapter selected", "error");
  const ch = state.currentChapter;
  const draftOnly = !state.committedChapters.has(ch) && !state.draftPRMap[ch]; // a new, never-committed chapter
  const msg = draftOnly
    ? "Discard the new chapter " +
      ch +
      "? It exists only as an unsaved draft and will be removed entirely."
    : "Discard all saved local changes for " +
      ch +
      " and reload from the published source? This cannot be undone.";
  showModal("Revert Changes", msg, async () => {
    try {
      document.getElementById("loadingOverlay").classList.remove("hidden");
      await fetchAPI("/api/discard/" + ch, { method: "POST" });
      state.locallyAddedChapters.delete(ch);
      state.locallyDiscardedChapters.add(ch);
      state.unsavedChanges = false;
      await loadChaptersList();
      await loadDraftPRs();
      if (draftOnly) {
        state.currentChapter = null;
        state.editor.innerHTML = "";
        document.getElementById("chapterTitle").textContent = "GSGW Chapter Editor";
        document.getElementById("metaTitle").value = "";
        document.getElementById("metaNumber").value = "";
        document.getElementById("publishedDate").textContent = "—";
        document.getElementById("prBtn").textContent = "Create PR";
        showToast("New chapter " + ch + " discarded");
      } else {
        await loadChapterContent(ch);
        showToast("Reverted " + ch + " to published source");
      }
    } catch (e) {
      showToast("Failed to revert: " + e.message, "error");
    } finally {
      document.getElementById("loadingOverlay").classList.add("hidden");
    }
  });
}

export async function selectChapter(ch) {
  closeSidebar();
  if (state.unsavedChanges) {
    showModal("Unsaved Changes", "You have unsaved changes. Discard them?", () =>
      loadChapterContent(ch),
    );
    return;
  }
  await loadChapterContent(ch);
}

export async function loadChapterContent(ch) {
  try {
    state.currentChapter = ch;
    document.getElementById("loadingOverlay").classList.remove("hidden");

    // Always fetch fresh: server decides PR -> saved draft -> main
    const data = await fetchAPI("/api/chapter/" + ch);

    state.currentChapterMetadata = data.metadata || {};
    document.getElementById("metaTitle").value = data.title || "";
    document.getElementById("metaNumber").value = data.number || "";

    state.originalChapterHtml = data.html;
    state.isLoadingChapter = true;
    state.editor.innerHTML = data.html;
    state.unsavedChanges = false;
    state.lastSaveTime = new Date();
    updateStatus();
    document.getElementById("chapterTitle").textContent = data.title || ch;

    setTimeout(() => {
      state.isLoadingChapter = false;
    }, 100);

    document.querySelectorAll(".chapter-list li").forEach((li) => {
      li.classList.remove("active");
      if (li.dataset.chapter === ch) li.classList.add("active");
    });

    const pubDateEl = document.getElementById("publishedDate");
    if (data.hasPR) {
      pubDateEl.textContent = "📝 Open PR (changes pending)";
      document.getElementById("prBtn").textContent = "Update PR";
    } else {
      document.getElementById("prBtn").textContent = "Create PR";
      if (data.hasDraft) {
        pubDateEl.textContent = "💾 Unpublished saved draft";
      } else if (data.publishedDate) {
        const date = new Date(data.publishedDate);
        pubDateEl.textContent = date.toLocaleDateString() + " " + date.toLocaleTimeString();
      } else {
        pubDateEl.textContent = "—";
      }
    }
  } catch (e) {
    showToast("Failed to load chapter: " + e.message, "error");
  } finally {
    document.getElementById("loadingOverlay").classList.add("hidden");
  }
}

export async function saveChapter() {
  if (!state.currentChapter) return showToast("No chapter selected", "error");
  if (!state.unsavedChanges) return showToast("No changes to save"); // skip no-op saves (no draft, no EDITED badge)
  try {
    const html = normalizeOutput(state.editor.innerHTML);

    const metadata = {
      ...state.currentChapterMetadata,
      title: document.getElementById("metaTitle").value || state.currentChapterMetadata.title,
      number: document.getElementById("metaNumber").value || state.currentChapterMetadata.number,
    };

    await fetchAPI("/api/save/" + state.currentChapter, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, metadata }),
    });

    state.originalChapterHtml = html;
    state.currentChapterMetadata = metadata;
    state.unsavedChanges = false;
    state.lastSaveTime = new Date();
    // This chapter now has a saved draft again — reflect it in the sidebar
    state.locallyDiscardedChapters.delete(state.currentChapter);
    state.draftChapterSet.add(state.currentChapter);
    updateChapterBadges();
    updateStatus();
    showToast("Saved!");
  } catch (e) {
    showToast("Save failed: " + e.message, "error");
  }
}

export async function createPR(event) {
  if (state.isCreatingPR) return;
  const debugMode = event && event.shiftKey;

  if (state.unsavedChanges && state.currentChapter) {
    await saveChapter();
    // saveChapter clears unsavedChanges on success — only then wait for KV's eventually-consistent
    // list() to surface the just-written draft, so the PR/debug below don't miss it.
    if (!state.unsavedChanges) await waitForDraft(state.currentChapter);
  }

  state.draftPRMap = await fetchAPI("/api/draft-prs");
  const drafts = await fetchAPI("/api/chapter-drafts");
  const chaptersWithPRs = Object.keys(drafts || {}).filter((ch) => state.draftPRMap[ch]);

  let message = "Create a PR with all accumulated draft changes?";
  if (chaptersWithPRs.length > 0) {
    message = `Push changes to existing PR for ${chaptersWithPRs.join(", ")} and create new PR for others?`;
  }
  if (debugMode) {
    message += "\n\n[DEBUG MODE — download HTML files instead of creating a PR]";
  }

  showModal("Create/Push PR", message, async () => {
    try {
      state.isCreatingPR = true;
      document.querySelector(".create-pr-btn").disabled = true;
      document.getElementById("loadingOverlay").classList.remove("hidden");

      if (debugMode) {
        const dr = await fetchAPI("/api/chapter-drafts");
        const entries = Object.entries(dr || {});
        for (const [ch, d] of entries) {
          const html = d.html || d;
          const num = ch.replace("ch", "");
          console.log(`=== ${num}.html ===\n` + html);
          downloadFile(html, num + ".html");
        }
        showToast(
          entries.length
            ? `DEBUG: downloaded ${entries.length} file(s) + logged to console`
            : "DEBUG: no saved drafts to download — Save a chapter first",
          entries.length ? "info" : "error",
        );
      } else {
        const res = await fetchAPI("/api/create-pr", { method: "POST" });
        showToast("PR created/updated: " + res.pr_url);
        await loadDraftPRs();
        await loadChaptersList();
        if (state.currentChapter) await loadChapterContent(state.currentChapter);
      }
    } catch (e) {
      showToast("Failed to create PR: " + e.message, "error");
    } finally {
      state.isCreatingPR = false;
      document.querySelector(".create-pr-btn").disabled = false;
      document.getElementById("loadingOverlay").classList.add("hidden");
    }
  });
}

// Poll /api/chapter-drafts until the just-saved chapter appears (KV list() is eventually
// consistent, so a fresh draft can lag the write). Resolves once seen, or after the timeout.
async function waitForDraft(ch, tries = 8, delayMs = 600) {
  for (let i = 0; i < tries; i++) {
    try {
      const drafts = await fetchAPI("/api/chapter-drafts");
      if (drafts && drafts[ch]) return;
    } catch (e) {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
