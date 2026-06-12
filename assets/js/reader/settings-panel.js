// The settings panel: open/close behaviour for the floating gear button.
var panel = document.getElementById("settings-panel");
var openBtn = document.getElementById("ab-settings");
function setPanel(open) {
  if (panel) panel.hidden = !open;
}
if (openBtn)
  openBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    setPanel(panel.hidden);
  });
var closeBtn = document.getElementById("sp-close");
if (closeBtn)
  closeBtn.addEventListener("click", function () {
    setPanel(false);
  });
document.addEventListener("click", function (e) {
  if (
    panel &&
    !panel.hidden &&
    !panel.contains(e.target) &&
    openBtn &&
    e.target !== openBtn &&
    !openBtn.contains(e.target)
  )
    setPanel(false);
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") setPanel(false);
});
