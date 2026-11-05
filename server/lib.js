// Shared helpers for the account API (Cloudflare Pages Functions + D1 database).
// The database binding must be named DB. Tables are created automatically on first use.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const fail = (message, status = 400) => json({ error: message }, status);

const SESSION_DAYS = 90;
const MAX_SAVE_BYTES = 64 * 1024;
export { MAX_SAVE_BYTES };

let schemaReady = false;
export async function db(env) {
  if (!env.DB) throw new Error('NO_DB');
  if (!schemaReady) {
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS saves (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)'),
    ]);
    schemaReady = true;
  }
  return env.DB;
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
export const newSalt = () => randomHex(16);

// Constant-time string compare.
export function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function createSession(DB, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await DB.batch([
    DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    DB.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)').bind(await sha256(token), userId, now + SESSION_DAYS * 864e5),
  ]);
  return token;
}

export async function currentUser(request, DB) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') || '');
  if (!m) return null;
  return DB.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?')
    .bind(await sha256(m[1]), Date.now()).first();
}

export async function dropSession(request, DB) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') || '');
  if (m) await DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
}

export const validUsername = (u) => typeof u === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(u);
export const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 128;

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// Wrap a handler so a missing database gives a clear message instead of a crash.
export const handler = (fn) => async (ctx) => {
  try { return await fn(ctx, await db(ctx.env)); }
  catch (e) {
    if (e.message === 'NO_DB') return fail('Account server is not set up: bind a D1 database named DB to this Pages project.', 503);
    console.error(e);
    return fail('Server error', 500);
  }
};
