// Dismissible announcement banner. The no-flash hide for an already-dismissed banner
// happens up in the <head> (inline script adds html.announce-dismissed, CSS hides it);
// this only records the dismissal when the × is clicked. Keyed by the banner's id so a
// new/edited announcement (new id in site.json) reappears for everyone.
var banner = document.querySelector(".announce[data-announce-id]");
if (banner) {
  var close = banner.querySelector(".announce-close");
  if (close)
    close.addEventListener("click", function () {
      try {
        localStorage.setItem("gsgw-announce-dismissed", banner.dataset.announceId);
      } catch (e) {}
      document.documentElement.classList.add("announce-dismissed");
    });
}
