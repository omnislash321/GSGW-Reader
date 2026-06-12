// Shared mutable editor state. ES-module imports are read-only bindings, so the state the
// other editor modules need to read AND write lives on this single object.
export const API_BASE = "https://gsgw-counts.omnislash321.workers.dev";

export const state = {
  sessionToken: null,
  currentChapter: null,
  currentChapterMetadata: {},
  originalChapterHtml: "",
  editor: null, // the contenteditable element (set on DOM ready)
  unsavedChanges: false,
  lastSaveTime: null,
  isLoadingChapter: false,
  isCreatingPR: false,
  pendingModalAction: null,
  draftPRMap: {},
  lastEditorRange: null,
  // KV list() is eventually consistent, so a just-added draft may not appear in
  // /api/chapter-drafts yet (and a just-discarded one may still appear). Track both
  // locally so the sidebar reflects the action immediately.
  committedChapters: new Set(),
  draftChapterSet: new Set(),
  locallyAddedChapters: new Set(),
  locallyDiscardedChapters: new Set(),
};
