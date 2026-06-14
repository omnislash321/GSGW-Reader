// Theme + reading preferences (font size, line height), persisted to localStorage and
// applied as CSS variables. The settings panel's controls live here.
import { root, get, set, del } from "./store.js";
import { syncGiscus, resetGiscusSync } from "./giscus-sync.js";
import { applyThemeAssets } from "../shared/theme-assets.js";

var DEF = { theme: "nightfall", fs: 1.125, lh: 1.7 };
var sel = document.getElementById("theme");
var fs, lh;
function applyText() {
  root.style.setProperty("--read-size", fs + "rem");
  root.style.setProperty("--read-lh", lh);
}
function loadPrefs() {
  var t = get("gsgw-theme", DEF.theme);
  root.setAttribute("data-theme", t);
  applyThemeAssets(t);
  if (sel) sel.value = t;
  fs = parseFloat(get("gsgw-fs", DEF.fs));
  lh = parseFloat(get("gsgw-lh", DEF.lh));
  applyText();
}
loadPrefs();

if (sel)
  sel.addEventListener("change", function () {
    root.setAttribute("data-theme", sel.value);
    applyThemeAssets(sel.value);
    set("gsgw-theme", sel.value);
    resetGiscusSync();
    syncGiscus(); // push the new light/dark theme to any open giscus iframes
  });
document.querySelectorAll("[data-font]").forEach(function (b) {
  b.addEventListener("click", function () {
    fs = Math.min(1.8, Math.max(0.85, fs + 0.0625 * parseInt(b.dataset.font, 10)));
    set("gsgw-fs", fs);
    applyText();
  });
});
document.querySelectorAll("[data-lh]").forEach(function (b) {
  b.addEventListener("click", function () {
    lh = Math.min(2.4, Math.max(1.3, lh + 0.1 * parseInt(b.dataset.lh, 10)));
    set("gsgw-lh", lh);
    applyText();
  });
});
var reset = document.getElementById("sp-reset");
if (reset)
  reset.addEventListener("click", function () {
    del("gsgw-theme");
    del("gsgw-fs");
    del("gsgw-lh");
    root.setAttribute("data-theme", DEF.theme);
    applyThemeAssets(DEF.theme);
    if (sel) sel.value = DEF.theme;
    fs = DEF.fs;
    lh = DEF.lh;
    applyText();
    resetGiscusSync();
    syncGiscus();
  });
