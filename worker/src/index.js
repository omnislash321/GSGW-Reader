// GSGW Reader — per-paragraph comment-count Worker (edge-cached GitHub proxy).
//
//   GET /counts?ch=ch222  ->  { "ch222-p5": 3, "ch222-p12": 1 }
//
// Comments themselves live in GitHub Discussions (written by giscus). This Worker reads the
// per-paragraph comment counts from GitHub's GraphQL API and caches the result at the edge
// (caches.default) for a couple of minutes — so readers get always-visible badges without an
// iframe per paragraph, and GitHub is queried at most once per TTL per colo.
//
// No database, no webhook, no cron: nothing to hit the KV write limit, and deletions are
// reflected automatically on the next refresh. The reader who actually posts a comment sees
// their own badge tick up instantly client-side via giscus's emit-metadata message.

const TTL = 120; // seconds the edge holds the full counts snapshot

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (url.pathname === "/counts" && req.method === "GET") return getCounts(url, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*"); // counts are public, read-only
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
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
