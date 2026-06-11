// GSGW Reader — comment counts + chapter editor
//
// Routes:
//   GET /counts?ch=ch222  ->  { "ch222-p5": 3, "ch222-p12": 1 }  (public, cached)
//   GET /editor           ->  HTML page (requires password in session)
//   POST /api/auth        ->  { password }  (returns session token)
//   GET /api/chapters     ->  [ch222, ch223, ...]  (auth required)
//   GET /api/chapter/ch222 -> { number, title, html }  (auth required)
//   POST /api/save/ch222  ->  { html }  (auth required, saves to KV)
//   POST /api/create-pr   ->  { pr_url }  (auth required, creates GitHub PR with all drafts)

const TTL = 120; // seconds the edge holds the full counts snapshot
const SESSION_SECRET = "gsgw-session"; // used to sign session tokens
const SESSION_TTL = 24 * 60 * 60; // 24 hours

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      let res;

      if (req.method === "OPTIONS") {
        res = new Response(null, { status: 204 });
      } else if (url.pathname === "/counts" && req.method === "GET") {
        res = await getCounts(url, env, ctx);
      } else if (url.pathname === "/api/auth" && req.method === "POST") {
        res = await authHandler(req, env);
      } else if (url.pathname === "/api/chapters" && req.method === "GET") {
        res = await getChaptersList(env);
      } else if (url.pathname.match(/^\/api\/chapter\//) && req.method === "GET") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          const ch = url.pathname.match(/\/api\/chapter\/(.+)$/)[1];
          res = await getChapter(ch, env);
        }
      } else if (url.pathname.match(/^\/api\/save\//) && req.method === "POST") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          const ch = url.pathname.match(/\/api\/save\/(.+)$/)[1];
          res = await saveChapter(ch, req, env);
        }
      } else if (url.pathname.match(/^\/api\/discard\//) && req.method === "POST") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          const ch = url.pathname.match(/\/api\/discard\/(.+)$/)[1];
          await env.EDITOR_DRAFTS.delete(ch + '-draft');
          res = json({ ok: true });
        }
      } else if (url.pathname === "/api/create-pr" && req.method === "POST") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          res = await createPR(req, env);
        }
      } else if (url.pathname === "/api/draft-prs" && req.method === "GET") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          res = await getDraftPRs(env);
        }
      } else if (url.pathname === "/api/chapter-drafts" && req.method === "GET") {
        const session = await validateSession(req, env);
        if (!session) {
          res = json({ error: "Unauthorized" }, 401);
        } else {
          res = await getChapterDrafts(env);
        }
      } else {
        res = new Response("Not found", { status: 404 });
      }

      return cors(res);
    } catch (e) {
      return cors(json({ error: String(e && e.message || e) }, 500));
    }
  },
};

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", ...extra },
  });
}

// chapter slug for a paragraph term: "ch222-p5" -> "ch222"
function chapterOf(term) { return term.replace(/-p\d+$/, ""); }

async function getCounts(url, env, ctx) {
  const ch = url.searchParams.get("ch");
  if (!ch || !/^[\w-]+$/.test(ch)) return cors(json({ error: "bad ch" }, 400));
  try {
    const snap = await snapshot(env, ctx);
    return cors(json(snap[ch] || {}, 200, { "Cache-Control": "public, max-age=60" }));
  } catch (e) {
    return cors(json({ error: String(e && e.message || e) }, 502)); // surface the GitHub reason
  }
}

// One edge-cached map of ALL paragraph counts: { "ch222": { "ch222-p5": 3 }, ... }.
// Built once per TTL per colo, shared across every reader.
async function snapshot(env, ctx) {
  const cache = caches.default;
  const key = new Request("https://gsgw.internal/snapshot");
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const map = await buildAll(env);
  const res = json(map, 200, { "Cache-Control": "public, max-age=" + TTL });
  ctx.waitUntil(cache.put(key, res.clone()));
  return map;
}

async function buildAll(env) {
  const [owner, name] = env.GITHUB_REPO.split("/");
  const out = {};
  let after = null;
  do {
    const data = await gql(env, `
      query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          discussions(first:100,after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ title comments{ totalCount } category{ name } }
          }
        }
      }`, { owner, name, after });
    const d = data.repository.discussions;
    for (const n of d.nodes) {
      if (env.GITHUB_CATEGORY && n.category && n.category.name !== env.GITHUB_CATEGORY) continue;
      if (!/-p\d+$/.test(n.title)) continue;               // only per-paragraph term threads
      if (n.comments.totalCount <= 0) continue;
      (out[chapterOf(n.title)] ||= {})[n.title] = n.comments.totalCount;
    }
    after = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function gql(env, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Content-Type": "application/json",
      "User-Agent": "gsgw-counts-worker",
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error("GraphQL: " + JSON.stringify(j.errors));
  if (!j.data) throw new Error("GitHub " + res.status + ": " + (j.message || JSON.stringify(j)));
  return j.data;
}

// ============================================================================
// EDITOR ENDPOINTS
// ============================================================================

async function validateSession(req, env) {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const [time, sig] = token.split(".");
    if (!time || !sig) return null;
    const t = parseInt(time, 10);
    if (isNaN(t) || Date.now() - t > SESSION_TTL * 1000) return null;
    if (!env.EDITOR_PASSWORD) {
      throw new Error("EDITOR_PASSWORD not set in worker");
    }
    const expected = await sha256(time + SESSION_SECRET + env.EDITOR_PASSWORD);
    return sig === expected ? { time: t } : null;
  } catch (e) {
    return null;
  }
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function authHandler(req, env) {
  const body = await req.json();
  if (body.password !== env.EDITOR_PASSWORD) {
    return json({ error: "Invalid password" }, 401);
  }
  const time = Date.now().toString();
  const sig = await sha256(time + SESSION_SECRET + env.EDITOR_PASSWORD);
  const token = time + "." + sig;
  return json({ token });
}

async function getChaptersList(env) {
  try {
    // Fetch chapter list from GitHub API
    const [owner, repo] = "omnislash321/GSGW-Reader".split("/");
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/chapters?ref=main`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'GSGW-Reader-Editor',
        'Authorization': env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const text = await res.text();
    const files = JSON.parse(text);
    if (!Array.isArray(files)) {
      throw new Error(`Expected array, got ${typeof files}`);
    }
    const chapters = files
      .filter(f => f.name.match(/^\d+\.html$/))
      .map(f => 'ch' + f.name.replace('.html', ''))
      .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
    return json(chapters);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

async function getChapter(ch, env) {
  const [owner, repo] = "omnislash321/GSGW-Reader".split("/");
  // ch format is "ch222", extract the number
  const num = ch.replace(/^ch/, '');

  // First check if there's an open PR for this chapter
  let branchRef = 'main';
  let isPR = false;
  try {
    const prsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50&sort=created&direction=desc`, {
      headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
    });
    if (prsRes.ok) {
      const prs = await prsRes.json();
      if (Array.isArray(prs)) {
        for (const pr of prs) {
          if (pr.head && pr.head.ref && pr.head.ref.startsWith('editor-draft-')) {
            // Check if this PR touches this chapter
            const filesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=50`, {
              headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
            });
            if (filesRes.ok) {
              const files = await filesRes.json();
              if (Array.isArray(files)) {
                for (const file of files) {
                  if (file.filename === `chapters/${num}.html`) {
                    branchRef = pr.head.ref;
                    isPR = true;
                    break;
                  }
                }
              }
            }
            if (isPR) break;
          }
        }
      }
    }
  } catch (e) {
    // Silently fail, use main branch
  }

  // Fetch last commit date for this chapter (for the "Last published" display)
  let publishedDate = null;
  try {
    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?path=chapters/${num}.html&per_page=1`, {
      headers: {
        'User-Agent': 'GSGW-Reader-Editor',
        'Authorization': env && env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined
      }
    });
    if (commitRes.ok) {
      const commits = await commitRes.json();
      if (Array.isArray(commits) && commits.length > 0) {
        publishedDate = commits[0].commit.author.date;
      }
    }
  } catch (e) {
    // Silently fail, publishedDate stays null
  }

  // No open PR? Fall back to a locally-saved draft in KV before reading main.
  // Priority: PR branch -> saved draft -> main.
  if (!isPR) {
    const draftRaw = await env.EDITOR_DRAFTS.get(ch + '-draft');
    if (draftRaw) {
      const draft = draftRaw.startsWith('{') ? JSON.parse(draftRaw) : { html: draftRaw, metadata: {} };
      const meta = draft.metadata || {};
      return json({ number: meta.number, title: meta.title, html: draft.html, publishedDate, metadata: meta, hasPR: false, hasDraft: true });
    }
  }

  let html;

  // Fetch file content - use GitHub API for non-main branches
  if (branchRef !== 'main') {
    // Use GitHub API to get content from PR branch
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/chapters/${num}.html?ref=${branchRef}`;
    const res = await fetch(apiUrl, {
      headers: {
        'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'User-Agent': 'GSGW-Reader-Editor'
      }
    });
    if (!res.ok) return json({ error: 'Chapter not found' }, 404);
    const data = await res.json();
    // GitHub API returns base64 encoded content
    const binaryString = atob(data.content);
    html = new TextDecoder().decode(new Uint8Array(binaryString.split('').map(c => c.charCodeAt(0))));
  } else {
    // Use raw.githubusercontent.com for main branch (faster)
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/chapters/${num}.html`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'GSGW-Reader-Editor',
        'Authorization': env && env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined
      }
    });
    if (!res.ok) return json({ error: 'Chapter not found' }, 404);
    html = await res.text();
  }
  // Parse frontmatter (YAML between --- ---)
  const match = html.match(/^---([\s\S]*?)---/);
  const frontmatter = match ? match[1] : '';
  const content = html.replace(/^---([\s\S]*?)---/, '').trim();
  const meta = {};
  frontmatter.split('\n').forEach(line => {
    const [k, v] = line.split(':').map(s => s.trim());
    if (k) meta[k] = v;
  });

  return json({ number: meta.number, title: meta.title, html: content, publishedDate, metadata: meta, hasPR: isPR, hasDraft: false });
}

async function saveChapter(ch, req, env) {
  const body = await req.json();
  const key = ch + '-draft';
  // Store both html content and metadata for later reconstruction
  await env.EDITOR_DRAFTS.put(key, JSON.stringify({ html: body.html, metadata: body.metadata || {} }));
  return json({ ok: true, saved_at: new Date().toISOString() });
}

async function createPR(req, env) {
  try {
    // Fetch all drafts from KV
    const list = await env.EDITOR_DRAFTS.list();
    const drafts = {};
    for (const item of list.keys) {
      const ch = item.name.replace('-draft', '');
      const data = await env.EDITOR_DRAFTS.get(item.name);
      // Handle both old format (plain html string) and new format (JSON with metadata)
      drafts[ch] = data.startsWith('{') ? JSON.parse(data) : { html: data, metadata: {} };
    }

    if (Object.keys(drafts).length === 0) {
      return json({ error: 'No drafts to create PR' }, 400);
    }

    // Create a commit with the changes
    const [owner, repo] = env.GITHUB_REPO.split('/');
    const baseRef = 'main';

    // Check if any of these chapters already have open editor PRs
    let existingBranch = null;
    let existingPrNumber = null;
    try {
      const prsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, {
        headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
      });
      if (prsRes.ok) {
        const prs = await prsRes.json();
        for (const pr of prs) {
          if (pr.head.ref.startsWith('editor-draft-')) {
            // Check if this PR touches any of our draft chapters
            const filesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`, {
              headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
            });
            if (filesRes.ok) {
              const files = await filesRes.json();
              for (const file of files) {
                const match = file.filename.match(/chapters\/(\d+)\.html$/);
                if (match) {
                  const ch = 'ch' + match[1];
                  if (drafts[ch]) {
                    existingBranch = pr.head.ref;
                    existingPrNumber = pr.number;
                    break;
                  }
                }
              }
              if (existingBranch) break;
            }
          }
        }
      }
    } catch (e) {
      // Silently fail, will create new PR
    }

    const branch = existingBranch || ('editor-draft-' + Date.now());

    // Get the latest commit SHA on main
    const tokenValue = env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN.slice(0, 10)}...` : 'UNDEFINED';
    const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${baseRef}`, {
      headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'GSGW-Reader-Editor' }
    });
    if (!refRes.ok) {
      const text = await refRes.text();
      throw new Error(`Failed to fetch ref: ${refRes.status} (token: ${tokenValue}) - ${text.slice(0, 200)}`);
    }
    const refData = await refRes.json();
    const baseCommitSha = refData.object.sha;

    // Get the tree from the latest commit
    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, {
      headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
    });
    if (!commitRes.ok) throw new Error('Failed to fetch commit: ' + commitRes.statusText);
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // Get chapter numbers for commit/PR title
    const chapterNumbers = Object.keys(drafts).map(ch => ch.replace(/^ch/, '')).sort((a, b) => parseInt(a) - parseInt(b));

    // Create a new tree with the updated chapters (with frontmatter)
    const treeItems = Object.entries(drafts).map(([ch, draft]) => {
      const num = ch.replace(/^ch/, '');
      const meta = draft.metadata || {};
      const frontmatter = `---\nnumber: ${meta.number || num}\ntitle: ${meta.title || 'Chapter ' + num}\n---\n`;
      const content = frontmatter + draft.html;
      return {
        path: 'chapters/' + num + '.html',
        mode: '100644',
        type: 'blob',
        content
      };
    });

    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'GSGW-Reader-Editor'
      },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
    });
    if (!treeRes.ok) throw new Error('Failed to create tree: ' + treeRes.statusText);
    const treeData = await treeRes.json();
    const newTreeSha = treeData.sha;

    // Create a new commit
    const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': 'GSGW-Reader-Editor'
      },
      body: JSON.stringify({
        message: 'Update chapters ' + chapterNumbers.join(', '),
        tree: newTreeSha,
        parents: [baseCommitSha]
      })
    });
    if (!newCommitRes.ok) throw new Error('Failed to create commit: ' + newCommitRes.statusText);
    const newCommitData = await newCommitRes.json();
    const newCommitSha = newCommitData.sha;

    // If updating existing PR, just update the branch ref; otherwise create new branch
    let prData;
    if (existingBranch) {
      // Update existing branch
      const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${existingBranch}`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'GSGW-Reader-Editor'
        },
        body: JSON.stringify({ sha: newCommitSha })
      });
      if (!updateRefRes.ok) throw new Error('Failed to update branch: ' + updateRefRes.statusText);
      // Return existing PR URL
      prData = { html_url: `https://github.com/${owner}/${repo}/pull/${existingPrNumber}` };
    } else {
      // Create new branch
      const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'GSGW-Reader-Editor'
        },
        body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: newCommitSha })
      });
      if (!branchRes.ok) throw new Error('Failed to create branch: ' + branchRes.statusText);

      // Create a PR with specific chapter numbers in title
      let prTitle = 'Chapter ' + chapterNumbers.join(', ') + ' edit';
      if (chapterNumbers.length > 3) {
        prTitle = 'Chapters ' + chapterNumbers.length + ' edits';
      }

      const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': 'GSGW-Reader-Editor'
        },
        body: JSON.stringify({
          title: prTitle,
          body: 'Chapter updates from the web editor. Created at ' + new Date().toISOString(),
          head: branch,
          base: baseRef
        })
      });
      if (!prRes.ok) throw new Error('Failed to create PR: ' + prRes.statusText);
      prData = await prRes.json();
    }

    // Clear all drafts from KV
    for (const item of list.keys) {
      await env.EDITOR_DRAFTS.delete(item.name);
    }

    return json({ ok: true, pr_url: prData.html_url });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

// Find open PRs created by editor that have changes to chapters
async function getDraftPRs(env) {
  try {
    const [owner, repo] = env.GITHUB_REPO.split('/');
    // Get all open PRs with editor- prefix
    const prsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:&per_page=100`, {
      headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
    });
    if (!prsRes.ok) return json({});
    const prs = await prsRes.json();

    const draftMap = {};
    for (const pr of prs) {
      // Look for editor draft PRs (branch name starts with editor-draft-)
      if (pr.head.ref.startsWith('editor-draft-')) {
        // Get files changed in this PR
        const filesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`, {
          headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'User-Agent': 'GSGW-Reader-Editor' }
        });
        if (filesRes.ok) {
          const files = await filesRes.json();
          for (const file of files) {
            // Extract chapter slug from path (chapters/222.html -> ch222)
            const match = file.filename.match(/chapters\/(\d+)\.html$/);
            if (match) {
              const ch = 'ch' + match[1];
              draftMap[ch] = { pr_number: pr.number, pr_url: pr.html_url, pr_title: pr.title };
            }
          }
        }
      }
    }
    return json(draftMap);
  } catch (e) {
    return json({});
  }
}

// List chapters that have unsaved drafts
async function getChapterDrafts(env) {
  try {
    const list = await env.EDITOR_DRAFTS.list();
    const drafts = {};
    for (const item of list.keys) {
      const ch = item.name.replace('-draft', '');
      const raw = await env.EDITOR_DRAFTS.get(item.name);
      const parsed = raw && raw.startsWith('{') ? JSON.parse(raw) : { html: raw || '', metadata: {} };
      drafts[ch] = { html: parsed.html, metadata: parsed.metadata || {} };
    }
    return json(drafts);
  } catch (e) {
    return json({});
  }
}
