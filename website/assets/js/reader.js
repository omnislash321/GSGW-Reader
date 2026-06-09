(function () {
  var root = document.documentElement;
  var DEF = { theme: "nightfall", fs: 1.125, lh: 1.7 };
  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---- giscus theme sync (comment box follows the active site theme) ----
  var GISCUS_THEME = { nightfall: "dark", charcoal: "dark", ghost: "dark", "after-dark": "dark", office: "light", daydream: "light" };
  var giscusApplied = null;
  function syncGiscus() {
    var target = GISCUS_THEME[root.getAttribute("data-theme")] || "dark";
    if (target === giscusApplied) return;            // already in sync (prevents resize loop)
    var frames = document.querySelectorAll("iframe.giscus-frame"); // page-level + any open paragraph embeds
    if (!frames.length) return;                      // giscus not loaded / no comments on page
    frames.forEach(function (f) {
      if (f.contentWindow)
        f.contentWindow.postMessage({ giscus: { setConfig: { theme: target } } }, "https://giscus.app");
    });
    giscusApplied = target;
  }
  // giscus posts a message once its iframe is ready (and on resize) — sync the theme then
  window.addEventListener("message", function (e) {
    if (e.origin === "https://giscus.app") syncGiscus();
  });

  // ---- theme + reading preferences ----
  var sel = document.getElementById("theme");
  var fs, lh;
  function applyText() {
    root.style.setProperty("--read-size", fs + "rem");
    root.style.setProperty("--read-lh", lh);
  }
  function loadPrefs() {
    var t = get("gsgw-theme", DEF.theme);
    root.setAttribute("data-theme", t);
    if (sel) sel.value = t;
    fs = parseFloat(get("gsgw-fs", DEF.fs));
    lh = parseFloat(get("gsgw-lh", DEF.lh));
    applyText();
  }
  loadPrefs();

  if (sel) sel.addEventListener("change", function () {
    root.setAttribute("data-theme", sel.value);
    set("gsgw-theme", sel.value);
    giscusApplied = null; syncGiscus();              // push the new light/dark theme to any open giscus iframes
  });
  document.querySelectorAll("[data-font]").forEach(function (b) {
    b.addEventListener("click", function () {
      fs = Math.min(1.8, Math.max(0.85, fs + 0.0625 * parseInt(b.dataset.font, 10)));
      set("gsgw-fs", fs); applyText();
    });
  });
  document.querySelectorAll("[data-lh]").forEach(function (b) {
    b.addEventListener("click", function () {
      lh = Math.min(2.4, Math.max(1.3, lh + 0.1 * parseInt(b.dataset.lh, 10)));
      set("gsgw-lh", lh); applyText();
    });
  });
  var reset = document.getElementById("sp-reset");
  if (reset) reset.addEventListener("click", function () {
    del("gsgw-theme"); del("gsgw-fs"); del("gsgw-lh");
    root.setAttribute("data-theme", DEF.theme);
    if (sel) sel.value = DEF.theme;
    fs = DEF.fs; lh = DEF.lh; applyText();
    giscusApplied = null; syncGiscus();
  });

  // ---- settings panel ----
  var panel = document.getElementById("settings-panel");
  var openBtn = document.getElementById("ab-settings");
  function setPanel(open) { if (panel) panel.hidden = !open; }
  if (openBtn) openBtn.addEventListener("click", function (e) {
    e.stopPropagation(); setPanel(panel.hidden);
  });
  var closeBtn = document.getElementById("sp-close");
  if (closeBtn) closeBtn.addEventListener("click", function () { setPanel(false); });
  document.addEventListener("click", function (e) {
    if (panel && !panel.hidden && !panel.contains(e.target) &&
        openBtn && e.target !== openBtn && !openBtn.contains(e.target)) setPanel(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setPanel(false); });

  // ---- comments + back to top ----
  var cBtn = document.getElementById("ab-comments");
  if (cBtn) cBtn.addEventListener("click", function () {
    var c = document.querySelector(".comments");
    if (c) c.scrollIntoView({ behavior: "smooth" });
  });
  var topBtn = document.getElementById("ab-top");
  if (topBtn) topBtn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- per-paragraph inline comments (lazy giscus embeds + count badges) ----
  // Each paragraph has a build-time id (ch222-p5) used as the giscus "specific" mapping term,
  // so it gets its own discussion thread. Embeds mount only on click (one at a time).
  // Always-visible counts come from the counts Worker (edge-cached GitHub proxy); they're
  // mirrored to localStorage so badges paint instantly on revisit/back-button and we only
  // re-fetch when that cache is stale. The reader who posts sees their own +1 immediately via
  // giscus's emit-metadata message — no webhook needed.
  (function () {
    var cfgEl = document.getElementById("giscus-cfg");
    var paras = document.querySelectorAll(".cbody > p[id]");
    if (!cfgEl || !paras.length) return;
    var CFG; try { CFG = JSON.parse(cfgEl.textContent); } catch (e) { return; }
    var BUBBLE = '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    var openTerm = null, openBtn = null, activePara = null;

    // one reusable side panel (built once) that hosts the giscus embed for the active paragraph
    var panel = document.createElement("div");
    panel.className = "cp-panel";
    panel.innerHTML =
      '<div class="cp-panel-head"><span>Paragraph comments</span>' +
      '<button class="cp-panel-close" type="button" aria-label="Close comments">×</button></div>' +
      '<div class="cp-panel-body"></div>';
    // Insert the panel as <body>'s first element so its giscus container is the first ".giscus"
    // in the DOM — giscus binds to the first one, which must be the panel, not the bottom embed.
    document.body.insertBefore(panel, document.body.firstChild);
    var panelBody = panel.querySelector(".cp-panel-body");
    panel.querySelector(".cp-panel-close").addEventListener("click", function () { close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && openTerm) close(); });

    function chapterOf(t) { return t.replace(/-p\d+$/, ""); }
    var slug = chapterOf(paras[0].id);
    var CKEY = "gsgw-cmap:" + slug;                   // localStorage mirror of this chapter's counts
    var btnByTerm = {};
    var counts = {}, cacheAge = Infinity;
    try {
      var cache = JSON.parse(localStorage.getItem(CKEY));
      if (cache && cache.m) { counts = cache.m; cacheAge = Date.now() - (cache.t || 0); }
    } catch (e) {}

    function gTheme() { return GISCUS_THEME[root.getAttribute("data-theme")] || "dark"; }
    // Dock the panel flush to the right of the reading column when there's room beside it;
    // otherwise fall back to the right-edge drawer (CSS default) on narrow screens.
    function positionPanel() {
      if (!panel.classList.contains("open")) return;
      var ref = document.querySelector(".page") || document.querySelector(".chapter");
      if (!ref) return;
      var right = ref.getBoundingClientRect().right;
      var avail = window.innerWidth - right - 8;        // 8px gutter between text and panel
      if (avail >= 360) {
        panel.style.left = (right + 8) + "px"; panel.style.right = "auto"; panel.style.width = avail + "px";
      } else {
        panel.style.left = panel.style.right = panel.style.width = "";
      }
    }
    window.addEventListener("resize", positionPanel);
    function close() {
      panel.classList.remove("open");
      panelBody.innerHTML = "";                         // unmount the giscus iframe
      panel.style.left = panel.style.right = panel.style.width = "";
      if (activePara) activePara.classList.remove("cp-active");
      openBtn = openTerm = activePara = null;
    }
    function badge(btn, n) {
      n = +n || 0;
      btn.querySelector(".cp-n").textContent = n > 0 ? n : "";
      btn.classList.toggle("has", n > 0);
    }
    function persist() {
      try { localStorage.setItem(CKEY, JSON.stringify({ m: counts, t: Date.now() })); } catch (e) {}
    }
    function setCount(term, n) {                       // update one paragraph everywhere
      n = +n || 0;
      if (n > 0) counts[term] = n; else delete counts[term];
      if (btnByTerm[term]) badge(btnByTerm[term], n);
      persist();
    }
    function open(p, term, btn) {
      if (openTerm === term) { close(); return; }      // same paragraph -> toggle the panel shut
      if (activePara) activePara.classList.remove("cp-active");
      panelBody.innerHTML = "";                         // swap out the previous paragraph's embed
      // giscus binds to the first ".giscus" container in the DOM. The panel is <body>'s first
      // element, so this host wins over the chapter-wide embed at the bottom of the page.
      var host = document.createElement("div");
      host.className = "giscus";
      var empty = document.createElement("p");          // giscus clears the host when it paints
      empty.className = "cp-empty";
      empty.textContent = "Be the first to comment.";
      host.appendChild(empty);
      panelBody.appendChild(host);
      var s = document.createElement("script");
      s.src = "https://giscus.app/client.js";
      var attrs = {
        "data-repo": CFG.repo, "data-repo-id": CFG.repoId,
        "data-category": CFG.category, "data-category-id": CFG.categoryId,
        "data-mapping": "specific", "data-term": term,
        "data-reactions-enabled": "1", "data-emit-metadata": "1",
        "data-input-position": "top", "data-theme": gTheme(), "data-lang": "en"
      };
      Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
      s.crossOrigin = "anonymous"; s.async = true;
      panelBody.appendChild(s);
      p.classList.add("cp-active"); activePara = p;
      openTerm = term; openBtn = btn;
      panel.classList.add("open");
      positionPanel();
    }

    paras.forEach(function (p) {
      var term = p.id;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cp-btn";
      btn.title = "Comment on this paragraph";
      btn.setAttribute("aria-label", "Comment on this paragraph");
      btn.innerHTML = BUBBLE + '<span class="cp-n"></span>';
      btnByTerm[term] = btn;
      badge(btn, counts[term]);                        // paint from cache instantly
      btn.addEventListener("click", function (e) { e.stopPropagation(); open(p, term, btn); });
      p.appendChild(btn);                              // absolutely positioned in the margin
    });

    // Refresh all badges from the counts Worker — but only if our local mirror is stale,
    // so repeat visits / back-button don't call the Worker at all.
    if (CFG.countsApi && cacheAge > 60000) {
      fetch(CFG.countsApi + "?ch=" + encodeURIComponent(slug))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (map) {
          if (!map || map.error) return;
          counts = map; persist();
          Object.keys(btnByTerm).forEach(function (t) { badge(btnByTerm[t], counts[t]); });
        })
        .catch(function () {});
    }

    // giscus emits discussion metadata once an embed loads — and again right after the user
    // posts — so the poster's own paragraph badge ticks up instantly with no round-trip.
    window.addEventListener("message", function (e) {
      if (e.origin !== "https://giscus.app") return;
      var d = e.data && e.data.giscus && e.data.giscus.discussion;
      if (d && openTerm) setCount(openTerm, d.totalCommentCount);
    });
  })();

  // ---- chapter list: search + sort ----
  var list = document.querySelector(".chlist");
  var search = document.getElementById("toc-search");
  var sort = document.getElementById("toc-sort");
  if (list && (search || sort)) {
    var items = [].slice.call(list.querySelectorAll("li"));
    function filter() {
      var q = (search ? search.value : "").trim().toLowerCase();
      var shown = 0;
      items.forEach(function (li) {
        var hit = !q ||
          (li.dataset.title && li.dataset.title.indexOf(q) > -1) ||
          (li.dataset.num && li.dataset.num.indexOf(q) > -1);
        li.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      var empty = list.querySelector(".empty");
      if (shown === 0) {
        if (!empty) {
          empty = document.createElement("li");
          empty.className = "empty";
          empty.textContent = "No chapters found.";
          list.appendChild(empty);
        }
      } else if (empty) empty.remove();
    }
    if (search) search.addEventListener("input", filter);
    if (sort) sort.addEventListener("click", function () {
      var dir = sort.dataset.dir === "asc" ? "desc" : "asc";
      sort.dataset.dir = dir;
      sort.textContent = dir === "asc" ? "Sort: Oldest first" : "Sort: Newest first";
      items.slice()
        .sort(function (a, b) { return (dir === "asc" ? 1 : -1) * (+a.dataset.num - +b.dataset.num); })
        .forEach(function (li) { list.appendChild(li); });
    });
  }
})();
