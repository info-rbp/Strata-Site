import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { AppBindings, AppVariables } from '../middleware/auth';
import {
  requireAuth,
  HttpError,
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
} from '../middleware/auth';
import { verifyPassword, hashPassword } from '../lib/crypto';
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
     FROM users u WHERE lower(u.email) = ?`,
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

  // SameSite=None (with Secure) remains necessary for the existing embedded
  // Cloudflare preview workflow. The visible product name is now ProInspect,
  // but the legacy cookie is deleted after each successful login.
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  deleteCookie(c, LEGACY_SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });

  return c.json({ id: user.id, email: user.email, role: user.role, propertyScope: user.propertyScope });
});

authRoutes.post('/logout', async (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });
  deleteCookie(c, LEGACY_SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

// Allows initial production credentials to be rotated without direct database
// access. The current password is always required and passwords are never
// returned by the API or written to the audit log.
authRoutes.post('/change-password', async (c) => {
  const user = requireAuth(c);
  const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>().catch(() => ({}));
  const currentPassword = body.currentPassword ?? '';
  const newPassword = body.newPassword ?? '';
  if (newPassword.length < 14) {
    throw new HttpError(400, 'WEAK_PASSWORD', 'New password must be at least 14 characters.');
  }
  if (newPassword.length > 200) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'New password is too long.');
  }

  const row = await c.env.DB.prepare(`SELECT password_hash as passwordHash FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ passwordHash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new HttpError(403, 'CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(passwordHash, user.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: user.propertyScope,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'user_security',
    entityId: user.id,
    after: { passwordChanged: true },
  });

  return c.json({ ok: true });
});
