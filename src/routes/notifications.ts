import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

export const notificationRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

notificationRoutes.get('/notifications', async (c) => {
  const user = requireAuth(c);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(user.id)
    .all();
  return c.json(results ?? []);
});

notificationRoutes.post('/notifications/:id/read', async (c) => {
  const user = requireAuth(c);
  await c.env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`)
    .bind(c.req.param('id'), user.id)
    .run();
  return c.json({ ok: true });
});

notificationRoutes.post('/notifications/read-all', async (c) => {
  const user = requireAuth(c);
  await c.env.DB.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).bind(user.id).run();
  return c.json({ ok: true });
});
