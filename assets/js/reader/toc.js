// Chapter list (Contents page): live search filter + oldest/newest sort toggle.
var list = document.querySelector(".chlist");
var search = document.getElementById("toc-search");
var sort = document.getElementById("toc-sort");
if (list && (search || sort)) {
  var items = [].slice.call(list.querySelectorAll("li"));
  function filter() {
    var q = (search ? search.value : "").trim().toLowerCase();
    var shown = 0;
    items.forEach(function (li) {
      var hit =
        !q ||
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
  if (sort)
    sort.addEventListener("click", function () {
      var dir = sort.dataset.dir === "asc" ? "desc" : "asc";
      sort.dataset.dir = dir;
      sort.textContent = dir === "asc" ? "Sort: Oldest first" : "Sort: Newest first";
      items
        .slice()
        .sort(function (a, b) {
          return (dir === "asc" ? 1 : -1) * (+a.dataset.num - +b.dataset.num);
        })
        .forEach(function (li) {
          list.appendChild(li);
        });
    });
}
