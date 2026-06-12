// Zero-dependency text helpers used by the build: HTML escaping and the lightweight
// markdown converter for `.md` chapters. Extracted verbatim from the old build.mjs.

// Escape text for HTML. `quote=false` leaves " untouched (for text nodes, not attributes).
export function esc(s, quote = true) {
  s = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quote ? s.replace(/"/g, "&quot;") : s;
}

// Inline markdown: **bold** and *italic*. Runs on already-escaped text.
export function inline(t) {
  return esc(t, false)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

// Block markdown: blank line = paragraph, `***`/`---` = scene break, `>` = blockquote,
// `## ` = subheading. Everything else is a paragraph.
export function md(text) {
  const out = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b) continue;
    if (b === "---" || b === "***" || b === "* * *") {
      out.push('<hr class="sb">');
    } else if (b.startsWith("## ")) {
      out.push(`<h2>${inline(b.slice(3))}</h2>`);
    } else if (b.split("\n").every((l) => l.trimStart().startsWith(">"))) {
      const q = b
        .split("\n")
        .map((l) => l.replace(/^\s*>\s?/, "").trimEnd())
        .join(" ");
      out.push(`<blockquote>${inline(q)}</blockquote>`);
    } else {
      const p = b
        .split("\n")
        .map((l) => l.trim())
        .join(" ");
      out.push(`<p>${inline(p)}</p>`);
    }
  }
  return out.join("\n");
}
