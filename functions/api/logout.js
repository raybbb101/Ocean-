import { json, handler, dropSession } from '../../server/lib.js';

export const onRequestPost = handler(async ({ request }, DB) => {
  await dropSession(request, DB);
  return json({ ok: true });
});
