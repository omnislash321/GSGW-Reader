// Chapter loading: read the chapters/ directory, parse frontmatter, render bodies,
// and return a numerically-sorted list of chapter objects for the build to template.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { md } from "./markdown.mjs";

// The canonical chapter slug (ch222, ch301, …). This format is also assumed by the
// Worker (worker/src/) and reader.js; they can't import this file, so keep them in sync.
export function slug(num) {
  return `ch${num}`;
}

// Split leading `--- … ---` frontmatter (simple `key: value` lines) from the body.
export function parse(text) {
  const meta = {};
  let body = text;
  if (text.startsWith("---")) {
    const parts = text.split("---");
    const fm = parts[1];
    body = parts.slice(2).join("---");
    for (const line of fm.trim().split("\n")) {
      const i = line.indexOf(":");
      if (i > -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: body.trim() };
}

// Give every top-level paragraph a stable, chapter-unique id (ch222-p1, -p2, …).
// reader.js uses these as giscus "specific" mapping terms for per-paragraph comments,
// so the id IS the discussion title — keep it stable across rebuilds.
export function addParaIds(html, chapterSlug) {
  let n = 0;
  return html.replace(/<p(\s|>)/g, (_m, after) => `<p id="${chapterSlug}-p${++n}"${after}`);
}

// Load + parse every chapter file into { num, title, slug, html } objects, sorted by number.
// `.html` chapters are pre-rendered fragments (e.g. imported from Google Docs); `.md`
// chapters go through the lightweight markdown converter.
export function loadChapters(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".html"))
    .sort();
  const chapters = files.map((f) => {
    const { meta, body } = parse(readFileSync(join(dir, f), "utf8"));
    const stem = f.replace(/\.(md|html)$/, "");
    const num = String(meta.number ?? stem).replace(/^0+(?=\d)/, ""); // strip leading zeros
    return {
      num,
      title: meta.title ?? "Untitled",
      slug: slug(num),
      html: f.endsWith(".html") ? body : md(body),
    };
  });
  chapters.sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0)); // numeric order
  return chapters;
}
