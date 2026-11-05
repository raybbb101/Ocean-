import { json, fail, handler, currentUser } from '../../server/lib.js';

// Health check + "who am I". Lets the game detect whether accounts are available.
export const onRequestGet = handler(async ({ request }, DB) => {
  const user = await currentUser(request, DB);
  return user ? json({ username: user.username }) : fail('Not logged in', 401);
});
