# gsgw-counts + Chapter Editor — Cloudflare Worker

A Cloudflare Worker serving two functions:
1. **Comment counts** — per-paragraph comment counts cached at the edge (public, read-only)
2. **Chapter Editor** — password-protected web editor for formatting/updating chapters

## Endpoints

### Comment counts (public)
```
GET /counts?ch=ch222  ->  { "ch222-p5": 3, "ch222-p12": 1 }
```

### Chapter editor
```
GET /editor                    -> HTML page (password form, editor UI)
POST /api/auth                 -> authenticate with password
GET /api/chapters              -> list of all chapter slugs
GET /api/chapter/ch222         -> fetch chapter content + metadata
POST /api/save/ch222           -> save draft to KV
POST /api/create-pr            -> create GitHub PR with all accumulated changes, clear KV
```

## Setup & Deploy

### 1. Log in to Cloudflare
```sh
npm i -g wrangler
wrangler login
```

### 2. Create KV namespace
```sh
cd worker
wrangler kv:namespace create EDITOR_DRAFTS
```
This outputs a namespace ID like `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Copy it.

### 3. Update wrangler.toml
Edit `worker/wrangler.toml` and set the KV ID:
```toml
[[kv_namespaces]]
binding = "EDITOR_DRAFTS"
id = "paste_the_id_here"
```

### 4. Set secrets
```sh
wrangler secret put EDITOR_PASSWORD
# (paste the password for the editor, e.g. "correct-horse-battery-staple")

wrangler secret put GITHUB_TOKEN
# (paste your GitHub PAT with repo + pull request write access)
```

**Note:** If `GITHUB_TOKEN` is already set (from the counts setup), you can skip re-entering it.

### 5. Deploy
```sh
wrangler deploy
```

### 6. Update site.json (optional)
If you want to link to the editor from the site, add:
```json
"editor_url": "https://gsgw-counts.<subdomain>.workers.dev/editor"
```

## Config (wrangler.toml)

- `GITHUB_REPO` — `owner/name` of the repo holding chapters and discussions
- `GITHUB_CATEGORY` — only count discussions in this category (matches giscus)
- `GITHUB_TOKEN` — **secret**, set via `wrangler secret put`
- `EDITOR_PASSWORD` — **secret**, set via `wrangler secret put`
- `EDITOR_DRAFTS` — KV namespace binding for saving chapter drafts

## Editor workflow

1. Open `/editor` → enter password
2. Select a chapter from the list
3. Edit the HTML in the left pane (with Quill RTE toolbar)
4. Preview updates in real-time on the right
5. Click "Save" to save the draft to KV (or it auto-saves every 5 minutes)
6. Edit other chapters freely
7. When done, click "Create PR" → Worker creates a GitHub PR with all changes
8. KV drafts are cleared after PR is created

## Notes

- Session tokens expire after 24 hours
- Drafts persist in KV even if the editor closes/refreshes
- Editor can swap between chapters without losing unsaved changes (with a confirmation)
- The "Create PR" button requires a valid GitHub token with write access to the repo
