# gsgw-counts — per-paragraph comment-count Worker

A tiny Cloudflare Worker that serves per-paragraph comment counts for the reader, so each
paragraph can show an always-visible badge without loading a giscus iframe per paragraph.

It reads the counts straight from GitHub Discussions (where giscus stores the comments) via
the GraphQL API and caches the result at the edge for ~2 minutes. **No database, no webhook,
no cron** — so there's nothing to hit a KV write limit, and deleted comments drop off on the
next refresh. The reader who posts a comment sees their own badge update instantly client-side
(via giscus's `emit-metadata` message); everyone else picks it up within the cache TTL.

## Endpoint

```
GET /counts?ch=ch222  ->  { "ch222-p5": 3, "ch222-p12": 1 }
```

Only paragraphs that have at least one comment appear in the map.

## Deploy

1. **Install wrangler & log in**
   ```sh
   npm i -g wrangler
   wrangler login
   ```

2. **Add a GitHub token as a secret** — a fine-grained PAT scoped to the `GSGW-Reader` repo
   with **Discussions: Read-only** (classic `public_repo` also works for a public repo):
   ```sh
   cd worker
   wrangler secret put GITHUB_TOKEN
   ```

3. **Deploy**
   ```sh
   wrangler deploy
   ```
   Note the deployed URL, e.g. `https://gsgw-counts.<subdomain>.workers.dev`.

4. **Point the site at it** — set `counts_api` in `site.json` to that URL + `/counts`:
   ```json
   "counts_api": "https://gsgw-counts.<subdomain>.workers.dev/counts"
   ```
   Rebuild (`node scripts/build.mjs`) and deploy the site. If `counts_api` is empty the reader
   silently skips bulk counts and still shows the per-paragraph comments + the poster's own +1.

## Config (`wrangler.toml`)

- `GITHUB_REPO` — `owner/name` of the repo holding the discussions.
- `GITHUB_CATEGORY` — only count discussions in this category (matches giscus's category).
- `GITHUB_TOKEN` — **secret**, set via `wrangler secret put` (never commit it).

## Tuning

- Edge cache TTL is `TTL` in `src/index.js` (default 120s). Lower = fresher counts, more
  GitHub calls; higher = the opposite.
- The reader also caches a chapter's counts in `localStorage` and only re-fetches when that
  cache is older than 60s, so repeat visits / back-button don't call the Worker at all.
