// Public counts endpoint: a per-paragraph map of (comments + reactions), built from GitHub
// Discussions and cached at the edge so every reader shares one snapshot per colo.
import { cors, json } from "./http.js";
import { gql } from "./github.js";

const TTL = 120; // seconds the edge holds the full counts snapshot

// chapter slug for a paragraph term: "ch222-p5" -> "ch222"
function chapterOf(term) {
  return term.replace(/-p\d+$/, "");
}

// GET /counts?ch=ch222 -> { "ch222-p5": 3, "ch222-p12": 1 }
export async function getCounts(url, env, ctx) {
  const ch = url.searchParams.get("ch");
  if (!ch || !/^[\w-]+$/.test(ch)) return cors(json({ error: "bad ch" }, 400));
  try {
    const snap = await snapshot(env, ctx);
    return cors(json(snap[ch] || {}, 200, { "Cache-Control": "public, max-age=60" }));
  } catch (e) {
    return cors(json({ error: String((e && e.message) || e) }, 502)); // surface the GitHub reason
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
    const data = await gql(
      env,
      `
      query($owner:String!,$name:String!,$after:String){
        repository(owner:$owner,name:$name){
          discussions(first:100,after:$after){
            pageInfo{ hasNextPage endCursor }
            nodes{ title comments{ totalCount } reactions{ totalCount } category{ name } }
          }
        }
      }`,
      { owner, name, after },
    );
    const d = data.repository.discussions;
    for (const n of d.nodes) {
      if (env.GITHUB_CATEGORY && n.category && n.category.name !== env.GITHUB_CATEGORY) continue;
      if (!/-p\d+$/.test(n.title)) continue; // only per-paragraph term threads
      // Badge counts comments (incl. replies) + reactions on the discussion body.
      const total = n.comments.totalCount + (n.reactions ? n.reactions.totalCount : 0);
      if (total <= 0) continue;
      (out[chapterOf(n.title)] ||= {})[n.title] = total;
    }
    after = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (after);
  return out;
}
