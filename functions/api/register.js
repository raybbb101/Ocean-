import { json, fail, handler, readJson, validUsername, validPassword, newSalt, hashPassword, createSession } from '../../server/lib.js';

export const onRequestPost = handler(async ({ request }, DB) => {
  const body = await readJson(request);
  if (!body || !validUsername(body.username)) return fail('Username must be 3-16 letters, numbers or _');
  if (!validPassword(body.password)) return fail('Password must be at least 6 characters');
  const exists = await DB.prepare('SELECT id FROM users WHERE username = ?').bind(body.username).first();
  if (exists) return fail('That username is taken', 409);
  const salt = newSalt();
  const res = await DB.prepare('INSERT INTO users (username, pass_hash, salt, created) VALUES (?, ?, ?, ?)')
    .bind(body.username, await hashPassword(body.password, salt), salt, Date.now()).run();
  const id = res.meta.last_row_id;
  return json({ token: await createSession(DB, id), username: body.username }, 201);
});
