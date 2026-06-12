# Contributing to GSGW Reader

A static reading site built by a tiny Node build step and deployed to Cloudflare Pages, plus
a Cloudflare Worker that powers comment counts and a password-protected chapter editor.

There is **no framework and no client bundler** — the reader ships hand-written HTML/CSS and
native ES modules. Markup lives in templates, not in JavaScript.

## Repo layout

```
chapters/            Chapter source — pre-rendered HTML fragments with frontmatter (number/title)
site.json            Site config: branding, themes list, giscus + counts-API URLs
templates/           Eta templates (all site HTML lives here)
  layouts/base.eta   The <html> shell
  pages/             splash, toc, chapter, 404 (wrapped in base) + editor (standalone)
  partials/          actionbar, settings-panel, chapter-nav, giscus, giscus-config
scripts/
  build.mjs          The build: load data -> render templates -> write website/
  lib/               markdown.mjs (esc/inline/md), chapters.mjs (load + slug + para ids)
assets/              Hand-authored, copied verbatim into website/assets/
  css/themes.css     Theme palette — the ONE source of truth (reader + editor both use it)
  css/main.css       Reader styles (@imports themes.css)
  css/editor.css     Chapter editor styles
  js/shared/         Code shared by reader + editor (storage.js: safe localStorage)
  js/reader/         Reader behaviour, native ES modules (entry: main.js)
  js/editor/         Chapter editor, native ES modules (entry: main.js; state.js holds shared state)
worker/src/          Cloudflare Worker (counts + editor backend), split by concern
website/             100% generated output — gitignored, never edit by hand
```

## Where do I edit…?

| To change… | Edit… |
|---|---|
| Page markup / layout | `templates/` (e.g. `partials/actionbar.eta`, `pages/chapter.eta`) |
| Build logic / data wiring | `scripts/build.mjs` and `scripts/lib/` |
| Reader behaviour (themes, progress, comments) | `assets/js/reader/*.js` |
| Reader styling | `assets/css/main.css` (colors → `assets/css/themes.css`) |
| A theme's colors, or adding a theme | `assets/css/themes.css` **and** the `themes` list in `site.json` |
| Branding / giscus / counts URL | `site.json` |
| The chapter editor UI | `templates/pages/editor.eta`, `assets/css/editor.css`, `assets/js/editor/*.js` |
| Comment counts or editor backend | `worker/src/*.js` |

## Build & preview

```sh
npm run build      # render chapters/ + templates/ -> website/
npm run serve      # build, then serve website/ locally (npx serve)
```

`website/` is generated and gitignored — always edit the sources above, never `website/`.
The live site rebuilds from source on every push (Cloudflare Pages), so a git push deploys it.

### How a page is built

`scripts/build.mjs` reads `site.json` + `chapters/`, builds a small data object per page, and
renders an Eta page template wrapped in `layouts/base.eta`. Eta is configured with
`autoEscape:false` (the build pre-escapes text via `esc()`), so templates insert values raw —
keep escaping in the build, markup in the templates.

### Adding a chapter

Drop a `chapters/NNN.html` file with frontmatter, or use the editor (below). `.md` files are
also supported and run through the minimal converter in `scripts/lib/markdown.mjs` (blank line =
paragraph, `***` = scene break, `>` = blockquote, `## ` = heading).

## Reader JavaScript (`assets/js/reader/`)

Loaded as a native ES module via `<script type="module" src="/assets/js/reader/main.js">`.
`main.js` imports each feature module:

- `store.js` — reader-local `root` + `GISCUS_THEME`; re-exports the shared `storage.js` helpers
- `giscus-sync.js` — keep the giscus comment box's light/dark in sync with the site theme
- `prefs.js` — theme + font-size + line-height controls (persisted)
- `settings-panel.js` — the floating gear panel
- `paragraph-comments.js` — lazy per-paragraph giscus embeds + count badges
- `progress.js` — per-chapter reading progress + the "resume" card
- `toc.js` — Contents-page search + sort

localStorage keys are documented at the top of `main.js`.

## Worker (`worker/src/`)

Bundled by Wrangler (esbuild), so the modules just `import` each other:

- `index.js` — request router + auth gate
- `http.js` — `cors()` / `json()` response helpers
- `github.js` — `repo(env)`, `ghFetch()`, `gql()`, `decodeDraft()`, the `editor-draft-` branch prefix
- `counts.js` — `/counts`: per-paragraph counts from GitHub Discussions, edge-cached
- `auth.js` — password → signed session token
- `chapters.js` — read/save chapters + list drafts
- `pr.js` — bundle KV drafts into a GitHub PR

Config is in `worker/wrangler.toml` (`GITHUB_REPO`, KV binding) + secrets set via
`wrangler secret put` (`GITHUB_TOKEN`, `EDITOR_PASSWORD`). See `worker/README.md` for setup.

```sh
npm run preview    # wrangler dev (run the Worker locally)
npm run deploy     # wrangler deploy
```

### Editor draft → PR lifecycle

1. Editor authenticates with the password → session token.
2. Editing a chapter saves a **draft** to the Worker's KV (`<ch>-draft`).
3. Chapter content is resolved with priority **open editor PR → KV draft → `main`**.
4. "Create PR" commits every saved draft to an `editor-draft-*` branch (reusing an existing
   editor PR branch if one already covers a chapter), opens/updates the PR, and clears KV.

## Conventions

- Chapter slug is `ch<number>` (e.g. `ch222`); the canonical helper is `slug()` in
  `scripts/lib/chapters.mjs`.
- The editor is native ES modules (`assets/js/editor/`, entry `main.js`). Its cross-cutting
  mutable state lives on the single `state` object in `state.js` (ES-module imports are
  read-only, so shared state goes through an object). No inline `on*` handlers — events are
  wired with `addEventListener` in `main.js`.
- Code used by both the reader and the editor lives in `assets/js/shared/` (e.g. the safe
  localStorage helpers). Don't duplicate theme colors either — they live only in
  `assets/css/themes.css`.
