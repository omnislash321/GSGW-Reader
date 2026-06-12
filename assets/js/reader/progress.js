// Reading progress: per-chapter state (unread / in progress / read).
// Per-device only (localStorage). Each chapter is in one of three states:
//   unread   — no record
//   reading  — scrolled partway (auto-tracked); we also remember the scroll position
//   read     — finished by scrolling, or marked read manually (sticky `r` flag)
// The splash + TOC surface a resume card; the TOC also shows a clickable state toggle per
// chapter, and the settings panel can mark the current chapter read/unread without scrolling.
(function () {
  var PKEY = "gsgw-progress"; // map: slug -> { n:num, t:title, p:pct, y:scrollY, r:readFlag, u:updated }
  var LKEY = "gsgw-last"; // slug of the most recently read chapter
  function readMap() {
    try {
      return JSON.parse(localStorage.getItem(PKEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function writeMap(m) {
    try {
      localStorage.setItem(PKEY, JSON.stringify(m));
    } catch (e) {}
  }

  // The three states. `r` (manual mark) or a near-complete scroll both count as "read".
  function stateOf(rec) {
    if (rec && (rec.r || rec.p >= 98)) return "read";
    if (rec && rec.p > 0) return "reading";
    return "unread";
  }
  // Mark a chapter read (sticky) or unread (clears the record). info: {slug,num,title}.
  function setRead(info, read) {
    var m = readMap();
    if (read) {
      var prev = m[info.slug] || {};
      m[info.slug] = { n: info.num, t: info.title, p: 100, y: prev.y || 0, r: true, u: Date.now() };
    } else {
      delete m[info.slug];
      try {
        if (localStorage.getItem(LKEY) === info.slug) localStorage.removeItem(LKEY);
      } catch (e) {}
    }
    writeMap(m);
  }

  var suppress = false; // stop re-recording after a manual clear
  var refreshMark = null; // set by wireMark(); lets clearUI relabel the button
  var chap = document.querySelector("main.chapter");
  if (!chap) {
    // off a chapter page -> drop the whole per-chapter row
    var prow = document.getElementById("sp-progress-row");
    if (prow) prow.style.display = "none";
  }
  if (chap) track(chap);
  renderResume();
  markToc();
  wireClear();
  wireMark();

  function track(main) {
    var slug = main.getAttribute("data-slug");
    if (!slug) return;
    var num = main.getAttribute("data-num") || "";
    var title = main.getAttribute("data-title") || document.title;
    var article = document.getElementById("cbody") || main;

    // Fraction of the article that has scrolled past the bottom of the viewport (0..1).
    function frac() {
      var top = article.getBoundingClientRect().top + window.scrollY;
      var h = article.offsetHeight || 1;
      var seen = window.scrollY + window.innerHeight - top;
      return Math.max(0, Math.min(1, seen / h));
    }
    function save() {
      if (suppress) return;
      var m = readMap();
      var prev = m[slug];
      m[slug] = {
        n: num,
        t: title,
        p: Math.round(frac() * 100),
        y: Math.round(window.scrollY),
        r: prev ? !!prev.r : false,
        u: Date.now(),
      }; // keep a manual "read" mark sticky
      writeMap(m);
      try {
        localStorage.setItem(LKEY, slug);
      } catch (e) {}
    }
    var raf = 0;
    window.addEventListener(
      "scroll",
      function () {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          save();
        });
      },
      { passive: true },
    );
    window.addEventListener("beforeunload", save);
    save(); // record the visit even without scrolling

    if (location.hash === "#resume") {
      // arrived via a resume card
      var rec = readMap()[slug];
      if (rec && rec.y) window.scrollTo(0, rec.y);
      if (history.replaceState) history.replaceState(null, "", location.pathname);
    }
  }

  // Idempotent: rebuilds (or hides) the resume card from current state. Only shows while the
  // most-recent chapter is genuinely mid-read — marking it read or unread clears the card.
  function renderResume() {
    var slot = document.querySelector("[data-resume]");
    if (!slot) return;
    slot.innerHTML = "";
    slot.hidden = true;
    var slug;
    try {
      slug = localStorage.getItem(LKEY);
    } catch (e) {}
    var rec = slug && readMap()[slug];
    if (!rec || stateOf(rec) !== "reading") return; // nothing in progress -> no card
    var a = document.createElement("a");
    a.className = "resume-card";
    a.href = "/chapters/" + slug + ".html#resume";
    a.innerHTML =
      '<span class="resume-k">Continue where you left off</span>' +
      '<span class="resume-t"></span>' +
      '<span class="resume-bar"><span style="width:' +
      rec.p +
      '%"></span></span>' +
      '<span class="resume-p">' +
      rec.p +
      "% read</span>";
    a.querySelector(".resume-t").textContent = rec.t; // title via textContent (avoids HTML injection)
    slot.appendChild(a);
    slot.hidden = false;
  }

  // Give each TOC row a clickable state pill: Unread / NN% / Read. Clicking toggles read⇄unread.
  // Idempotent — re-running (e.g. after a clear) repaints existing rows instead of duplicating.
  function markToc() {
    var lis = document.querySelectorAll(".chlist li[data-num]");
    if (!lis.length) return;
    lis.forEach(function (li) {
      var num = li.dataset.num,
        slug = "ch" + num;
      var a = li.querySelector("a");
      var info = { slug: slug, num: num, title: a ? a.textContent : "" };
      var btn = li.querySelector(".ch-toggle");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        li.appendChild(btn);
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation(); // don't follow the row's chapter link
          setRead(info, stateOf(readMap()[slug]) !== "read");
          paint();
          renderResume(); // mark/unmark may add or drop the resume card
        });
      }
      function paint() {
        var rec = readMap()[slug],
          st = stateOf(rec);
        li.classList.remove("read", "reading", "unread");
        li.classList.add(st);
        btn.className = "ch-toggle is-" + st;
        btn.textContent = st === "read" ? "Read" : st === "reading" ? rec.p + "%" : "Unread";
        btn.title = st === "read" ? "Marked read — click to mark unread" : "Click to mark read";
        btn.setAttribute("aria-pressed", st === "read" ? "true" : "false");
      }
      paint();
    });
  }

  // Reset on-page progress UI after a clear: rebuild the resume card, repaint TOC + mark button.
  function clearUI() {
    renderResume();
    markToc();
    if (refreshMark) refreshMark();
  }
  function flash(btn) {
    // brief "Cleared" confirmation on a button
    var t = btn.textContent;
    btn.textContent = "Cleared";
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = t;
      btn.disabled = false;
    }, 1200);
  }

  // Settings panel: mark the current chapter read/unread (no scrolling needed).
  function wireMark() {
    var btn = document.getElementById("sp-mark-read");
    if (!btn || !chap) return; // row is hidden off a chapter page
    var info = {
      slug: chap.getAttribute("data-slug"),
      num: chap.getAttribute("data-num"),
      title: chap.getAttribute("data-title") || document.title,
    };
    refreshMark = function () {
      var read = stateOf(readMap()[info.slug]) === "read";
      btn.textContent = read ? "Mark unread" : "Mark read";
      btn.setAttribute("aria-pressed", read ? "true" : "false");
    };
    btn.addEventListener("click", function () {
      var read = stateOf(readMap()[info.slug]) === "read";
      setRead(info, !read);
      suppress = read ? false : true; // once read, don't let scrolling rewrite the %
      refreshMark();
    });
    refreshMark();
  }

  // Settings panel: clear progress for this chapter or for everything.
  function wireClear() {
    var chBtn = document.getElementById("sp-clear-ch");
    var allBtn = document.getElementById("sp-clear-all");
    if (chBtn && chap)
      chBtn.addEventListener("click", function () {
        // row is hidden off a chapter page
        var slug = chap.getAttribute("data-slug");
        var m = readMap();
        delete m[slug];
        writeMap(m);
        try {
          if (localStorage.getItem(LKEY) === slug) localStorage.removeItem(LKEY);
        } catch (e) {}
        suppress = true;
        clearUI();
        flash(chBtn); // stay cleared until the reader navigates away
      });
    if (allBtn)
      allBtn.addEventListener("click", function () {
        try {
          localStorage.removeItem(PKEY);
          localStorage.removeItem(LKEY);
        } catch (e) {}
        suppress = true;
        clearUI();
        flash(allBtn);
      });
  }
})();
