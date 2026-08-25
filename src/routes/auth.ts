import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireAuth, HttpError } from '../middleware/auth';
import { verifyPassword } from '../lib/crypto';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const authRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}));
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Email and password are required.' } }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.password_hash as passwordHash, u.role, u.status,
            u.access_expires_at as accessExpiresAt, u.property_scope as propertyScope
     FROM users u WHERE u.email = ?`,
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      passwordHash: string;
      role: string;
      status: string;
      accessExpiresAt: string | null;
      propertyScope: string | null;
    }>();

  if (!user || user.status !== 'active') {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }, 401);
  }
  if (user.accessExpiresAt && new Date(user.accessExpiresAt).getTime() < Date.now()) {
    return c.json({ error: { code: 'ACCESS_EXPIRED', message: 'This account\'s access has expired.' } }, 401);
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }, 401);
  }

  const sessionId = newId('sess');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days
  await c.env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(sessionId, user.id, expiresAt)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: user.propertyScope,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'login',
    entityType: 'user',
    entityId: user.id,
  });

  // SameSite=None (with Secure) is required here, not Lax: the sandbox
  // preview (and Cloudflare Pages preview deployments generally) is loaded
  // inside a cross-site iframe by the hosting UI. Lax cookies are dropped
  // by the browser in that third-party context, which makes login look
  // like it "succeeds" (200 + Set-Cookie) but every subsequent request is
  // treated as unauthenticated and bounces back to /login.
  setCookie(c, 'pmhub_session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ id: user.id, email: user.email, role: user.role, propertyScope: user.propertyScope });
});

authRoutes.post('/logout', async (c) => {
  // Deletion attributes must match the attributes the cookie was set with
  // (path + sameSite/secure) or some browsers will ignore the deletion.
  deleteCookie(c, 'pmhub_session', { path: '/', secure: true, sameSite: 'None' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  return c.json({ user });
});
