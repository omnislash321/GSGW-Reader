// Page-level giscus theme sync: the comment box(es) follow the active site theme.
import { root, GISCUS_THEME } from "./store.js";

var giscusApplied = null;
// Force the next syncGiscus() to re-push, even if the target theme is unchanged
// (used after the reader switches theme, to update any already-open giscus iframes).
export function resetGiscusSync() {
  giscusApplied = null;
}

export function syncGiscus() {
  var target = GISCUS_THEME[root.getAttribute("data-theme")] || "dark";
  if (target === giscusApplied) return; // already in sync (prevents resize loop)
  var frames = document.querySelectorAll("iframe.giscus-frame"); // page-level + any open paragraph embeds
  if (!frames.length) return; // giscus not loaded / no comments on page
  frames.forEach(function (f) {
    if (f.contentWindow)
      f.contentWindow.postMessage(
        { giscus: { setConfig: { theme: target } } },
        "https://giscus.app",
      );
  });
  giscusApplied = target;
}

// giscus posts a message once its iframe is ready (and on resize) — sync the theme then.
window.addEventListener("message", function (e) {
  if (e.origin === "https://giscus.app") syncGiscus();
});
