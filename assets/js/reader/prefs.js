// Theme + reading preferences (font size, line height), persisted to localStorage and
// applied as CSS variables. The settings panel's controls live here.
import { root, get, set, del } from "./store.js";
import { syncGiscus, resetGiscusSync } from "./giscus-sync.js";
import { applyThemeAssets } from "../shared/theme-assets.js";

var DEF = { theme: "nightfall", fs: 1.125, lh: 1.7, readable: false };
var sel = document.getElementById("theme");
var readableBox = document.getElementById("sp-readable");
var fs, lh;
function applyText() {
  root.style.setProperty("--read-size", fs + "rem");
  root.style.setProperty("--read-lh", lh);
}
// Accessible-fonts mode: a single data-readable flag CSS keys off (see main.css) to drop the
// serif/decorative faces in favour of a plain system sans-serif.
function applyReadable(on) {
  if (on) root.setAttribute("data-readable", "1");
  else root.removeAttribute("data-readable");
  if (readableBox) readableBox.checked = on;
}
function loadPrefs() {
  var t = get("gsgw-theme", DEF.theme);
  root.setAttribute("data-theme", t);
  applyThemeAssets(t);
  if (sel) sel.value = t;
  fs = parseFloat(get("gsgw-fs", DEF.fs));
  lh = parseFloat(get("gsgw-lh", DEF.lh));
  applyText();
  applyReadable(get("gsgw-readable", "") === "1");
}
loadPrefs();

if (readableBox)
  readableBox.addEventListener("change", function () {
    applyReadable(readableBox.checked);
    if (readableBox.checked) set("gsgw-readable", "1");
    else del("gsgw-readable");
  });

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
    del("gsgw-readable");
    root.setAttribute("data-theme", DEF.theme);
    applyThemeAssets(DEF.theme);
    if (sel) sel.value = DEF.theme;
    fs = DEF.fs;
    lh = DEF.lh;
    applyText();
    applyReadable(DEF.readable);
    resetGiscusSync();
    syncGiscus();
  });
