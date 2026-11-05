// Account + cloud save client. Talks to the Cloudflare Pages Functions under /api.
// When the API isn't reachable (e.g. opened from a plain file server) the game falls back to local saves.
const TOKEN = 'deepDiveExplorers.token';
const USER = 'deepDiveExplorers.account';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

async function call(method, path, body, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = get(TOKEN);
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive: !!opts.keepalive });
  } catch {
    throw Object.assign(new Error('Cannot reach the account server. Check your internet.'), { offline: true });
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};
  if (!isJson) throw Object.assign(new Error('Accounts are not available on this website.'), { unavailable: true });
  if (res.status === 401 && path !== 'login') { set(TOKEN, null); set(USER, null); }
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

let pending = null, timer = null, saving = false;

export const Cloud = {
  available: null, // null = unknown, true/false after probe()
  lastError: null,
  onError() {},
  get user() { return get(TOKEN) ? get(USER) : null; },

  async probe() {
    try {
      const r = await fetch('api/me', { headers: get(TOKEN) ? { authorization: `Bearer ${get(TOKEN)}` } : {} });
      const isJson = (r.headers.get('content-type') || '').includes('application/json');
      this.available = isJson && r.status !== 503;
      if (r.status === 401) { set(TOKEN, null); set(USER, null); }
    } catch { this.available = false; }
    return this.available;
  },

  async register(username, password) { const d = await call('POST', 'register', { username, password }); set(TOKEN, d.token); set(USER, d.username); return d.username; },
  async login(username, password) { const d = await call('POST', 'login', { username, password }); set(TOKEN, d.token); set(USER, d.username); return d.username; },
  async logout() { try { await this.flush(); await call('POST', 'logout'); } catch {} set(TOKEN, null); set(USER, null); },

  async load() { return call('GET', 'save'); },

  // Debounced upload: called on every local save; sends at most every few seconds.
  queue(profile, delay = 3000) {
    if (!this.user) return;
    pending = JSON.parse(JSON.stringify(profile));
    clearTimeout(timer);
    timer = setTimeout(() => this.flush().catch((e) => this.onError(e)), delay);
  },
  async flush(keepalive = false) {
    clearTimeout(timer);
    if (!pending || !this.user || saving) return;
    const save = pending; pending = null; saving = true;
    try { await call('PUT', 'save', { save }, { keepalive }); this.lastError = null; }
    catch (e) { this.lastError = e; if (!pending) pending = save; if (!keepalive) timer = setTimeout(() => this.flush().catch((er) => this.onError(er)), 15000); throw e; }
    finally { saving = false; }
  },
};
