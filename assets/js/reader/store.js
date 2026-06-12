// Reader-local shared bits. The safe localStorage helpers come from the cross-app
// shared module so the editor can reuse the exact same implementation.
export { get, set, del } from "../shared/storage.js";

export var root = document.documentElement;

// Which giscus light/dark theme each site theme maps to (the embed has no per-palette theme).
export var GISCUS_THEME = {
  nightfall: "dark",
  charcoal: "dark",
  ghost: "dark",
  "after-dark": "dark",
  office: "light",
  daydream: "light",
};
