// Reader entry point — loaded as a native ES module via <script type="module">.
// Importing each feature module runs it; there is no bundler.
//
// localStorage keys used across these modules:
//   gsgw-theme / gsgw-fs / gsgw-lh   reader preferences            (prefs.js)
//   gsgw-cmap:<chapterSlug>          cached paragraph comment counts (paragraph-comments.js)
//   gsgw-progress                    per-chapter reading-progress map (progress.js)
//   gsgw-last                        slug of the most recently read chapter (progress.js)
import "./prefs.js";
import "./settings-panel.js";
import "./paragraph-comments.js";
import "./progress.js";
import "./toc.js";

// Floating action bar: jump to the comments section + back to top.
var cBtn = document.getElementById("ab-comments");
if (cBtn)
  cBtn.addEventListener("click", function () {
    var c = document.querySelector(".comments");
    if (c) c.scrollIntoView({ behavior: "smooth" });
  });
var topBtn = document.getElementById("ab-top");
if (topBtn)
  topBtn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
