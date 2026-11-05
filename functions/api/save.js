import { json, fail, handler, currentUser, MAX_SAVE_BYTES } from '../../server/lib.js';

// GET: load this account's save. PUT: store it.
export const onRequestGet = handler(async ({ request }, DB) => {
  const user = await currentUser(request, DB);
  if (!user) return fail('Please log in again', 401);
  const row = await DB.prepare('SELECT data, updated FROM saves WHERE user_id = ?').bind(user.id).first();
  return json({ username: user.username, save: row ? JSON.parse(row.data) : null, updated: row ? row.updated : 0 });
});

export const onRequestPut = handler(async ({ request }, DB) => {
  const user = await currentUser(request, DB);
  if (!user) return fail('Please log in again', 401);
  const text = await request.text();
  if (text.length > MAX_SAVE_BYTES) return fail('Save is too large', 413);
  let body;
  try { body = JSON.parse(text); } catch { return fail('Bad save data'); }
  const save = body && body.save;
  if (!save || typeof save !== 'object' || typeof save.coins !== 'number' || typeof save.upgrades !== 'object') return fail('Bad save data');
  save.name = user.username; // the diver always carries the account name
  const now = Date.now();
  await DB.prepare('INSERT INTO saves (user_id, data, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .bind(user.id, JSON.stringify(save), now).run();
  return json({ ok: true, updated: now });
});
