// Chapter read/save endpoints for the editor. Content is resolved with priority:
//   open editor PR branch  ->  locally-saved KV draft  ->  main branch.
import { json } from "./http.js";
import { repo, ghFetch, decodeDraft, EDITOR_BRANCH_PREFIX } from "./github.js";

// GET /api/chapters — list every chapter slug (ch222, …) from the repo's chapters/ dir.
export async function getChaptersList(env) {
  try {
    const [owner, name] = repo(env);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/chapters?ref=main`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GSGW-Reader-Editor",
          Authorization: env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined,
        },
      },
    );
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
      .filter((f) => f.name.match(/^\d+\.html$/))
      .map((f) => "ch" + f.name.replace(".html", ""))
      .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)));
    return json(chapters);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// GET /api/chapter/ch222 — fetch a chapter's content + metadata (resolving PR/draft/main).
export async function getChapter(ch, env) {
  const [owner, name] = repo(env);
  // ch format is "ch222", extract the number
  const num = ch.replace(/^ch/, "");

  // First check if there's an open PR for this chapter
  let branchRef = "main";
  let isPR = false;
  try {
    const prsRes = await ghFetch(
      env,
      `https://api.github.com/repos/${owner}/${name}/pulls?state=open&per_page=50&sort=created&direction=desc`,
    );
    if (prsRes.ok) {
      const prs = await prsRes.json();
      if (Array.isArray(prs)) {
        for (const pr of prs) {
          if (pr.head && pr.head.ref && pr.head.ref.startsWith(EDITOR_BRANCH_PREFIX)) {
            // Check if this PR touches this chapter
            const filesRes = await ghFetch(
              env,
              `https://api.github.com/repos/${owner}/${name}/pulls/${pr.number}/files?per_page=50`,
            );
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
    const commitRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits?path=chapters/${num}.html&per_page=1`,
      {
        headers: {
          "User-Agent": "GSGW-Reader-Editor",
          Authorization: env && env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined,
        },
      },
    );
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
    const draftRaw = await env.EDITOR_DRAFTS.get(ch + "-draft");
    if (draftRaw) {
      const draft = decodeDraft(draftRaw);
      const meta = draft.metadata || {};
      return json({
        number: meta.number,
        title: meta.title,
        html: draft.html,
        publishedDate,
        metadata: meta,
        hasPR: false,
        hasDraft: true,
      });
    }
  }

  let html;

  // Fetch file content - use GitHub API for non-main branches
  if (branchRef !== "main") {
    // Use GitHub API to get content from PR branch
    const apiUrl = `https://api.github.com/repos/${owner}/${name}/contents/chapters/${num}.html?ref=${branchRef}`;
    const res = await ghFetch(env, apiUrl);
    if (!res.ok) return json({ error: "Chapter not found" }, 404);
    const data = await res.json();
    // GitHub API returns base64 encoded content
    const binaryString = atob(data.content);
    html = new TextDecoder().decode(
      new Uint8Array(binaryString.split("").map((c) => c.charCodeAt(0))),
    );
  } else {
    // Use raw.githubusercontent.com for main branch (faster)
    const url = `https://raw.githubusercontent.com/${owner}/${name}/main/chapters/${num}.html`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "GSGW-Reader-Editor",
        Authorization: env && env.GITHUB_TOKEN ? `Bearer ${env.GITHUB_TOKEN}` : undefined,
      },
    });
    if (!res.ok) return json({ error: "Chapter not found" }, 404);
    html = await res.text();
  }
  // Parse frontmatter (YAML between --- ---)
  const match = html.match(/^---([\s\S]*?)---/);
  const frontmatter = match ? match[1] : "";
  const content = html.replace(/^---([\s\S]*?)---/, "").trim();
  const meta = {};
  frontmatter.split("\n").forEach((line) => {
    const [k, v] = line.split(":").map((s) => s.trim());
    if (k) meta[k] = v;
  });

  return json({
    number: meta.number,
    title: meta.title,
    html: content,
    publishedDate,
    metadata: meta,
    hasPR: isPR,
    hasDraft: false,
  });
}

// POST /api/save/ch222 — store a draft (html + metadata) in KV for later PR creation.
export async function saveChapter(ch, req, env) {
  const body = await req.json();
  const key = ch + "-draft";
  // Store both html content and metadata for later reconstruction
  await env.EDITOR_DRAFTS.put(
    key,
    JSON.stringify({ html: body.html, metadata: body.metadata || {} }),
  );
  return json({ ok: true, saved_at: new Date().toISOString() });
}

// GET /api/chapter-drafts — list every chapter that currently has an unsaved KV draft.
export async function getChapterDrafts(env) {
  try {
    const list = await env.EDITOR_DRAFTS.list();
    const drafts = {};
    for (const item of list.keys) {
      const ch = item.name.replace("-draft", "");
      const parsed = decodeDraft(await env.EDITOR_DRAFTS.get(item.name));
      drafts[ch] = { html: parsed.html, metadata: parsed.metadata || {} };
    }
    return json(drafts);
  } catch (e) {
    return json({});
  }
}
