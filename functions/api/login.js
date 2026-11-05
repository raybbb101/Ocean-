import { json, fail, handler, readJson, hashPassword, same, createSession } from '../../server/lib.js';

export const onRequestPost = handler(async ({ request }, DB) => {
  const body = await readJson(request);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return fail('Missing username or password');
  const user = await DB.prepare('SELECT id, username, pass_hash, salt FROM users WHERE username = ?').bind(body.username).first();
  // Hash even when the user doesn't exist so timing doesn't reveal which usernames are real.
  const hash = await hashPassword(body.password, user ? user.salt : '00'.repeat(16));
  if (!user || !same(hash, user.pass_hash)) return fail('Wrong username or password', 401);
  return json({ token: await createSession(DB, user.id), username: user.username });
});
