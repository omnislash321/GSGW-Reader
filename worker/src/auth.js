// Editor authentication: a password exchanged for a short-lived signed session token.
// Token format: "<issuedAtMs>.<sha256(issuedAt + SECRET + password)>".
import { json } from "./http.js";

const SESSION_SECRET = "gsgw-session"; // used to sign session tokens
const SESSION_TTL = 24 * 60 * 60; // 24 hours

// SHA-256 hex digest.
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// Validate the Bearer session token on a request. Returns { time } or null.
export async function validateSession(req, env) {
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

// POST /api/auth — exchange a password for a session token.
export async function authHandler(req, env) {
  const body = await req.json();
  if (body.password !== env.EDITOR_PASSWORD) {
    return json({ error: "Invalid password" }, 401);
  }
  const time = Date.now().toString();
  const sig = await sha256(time + SESSION_SECRET + env.EDITOR_PASSWORD);
  const token = time + "." + sig;
  return json({ token });
}
