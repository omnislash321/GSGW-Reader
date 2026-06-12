// Shared GitHub API helpers used by the editor + counts endpoints.

// Branch-name prefix for editor-created draft PRs. Used both to name new branches and to
// recognise the editor's own PRs when searching open PRs.
export const EDITOR_BRANCH_PREFIX = "editor-draft-";

// [owner, name] for the configured repo (GITHUB_REPO = "owner/name", set in wrangler.toml).
export function repo(env) {
  return env.GITHUB_REPO.split("/");
}

// fetch() against the GitHub REST API with the standard auth + User-Agent headers.
// Per-call headers (Accept, Content-Type) merge in and override.
export function ghFetch(env, url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "User-Agent": "GSGW-Reader-Editor",
      ...(opts.headers || {}),
    },
  });
}

// GitHub GraphQL helper (used by the comment-counts snapshot).
export async function gql(env, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
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

// A KV draft value is either the new JSON shape {html, metadata} or a legacy raw-HTML string.
export function decodeDraft(raw) {
  return raw && raw.startsWith("{") ? JSON.parse(raw) : { html: raw || "", metadata: {} };
}
