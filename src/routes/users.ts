import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, requireAuth, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { hashPassword } from '../lib/crypto';
import { recordAudit } from '../lib/audit';
import type { Role } from '../domain/security';

export const userRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

userRoutes.get('/users', async (c) => {
  const user = requireCapability(c, 'user.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT u.id, u.email, u.role, u.status, u.property_scope as propertyScope, u.access_expires_at as accessExpiresAt,
                    p.full_name as fullName
             FROM users u LEFT JOIN people p ON p.id = u.person_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND (u.property_scope = ? OR u.property_scope IS NULL)`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY u.role, p.full_name`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

userRoutes.post('/users/invite', async (c) => {
  const actor = requireCapability(c, 'user.invite');
  const body = await c.req.json<{
    email: string;
    fullName: string;
    role: Role;
    propertyScope?: string | null;
    temporaryPassword: string;
  }>();

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(body.email.toLowerCase()).first();
  if (existing) throw new HttpError(409, 'EMAIL_IN_USE', 'A user with this email already exists.');

  const personId = newId('person');
  await c.env.DB.prepare(`INSERT INTO people (id, full_name, email) VALUES (?, ?, ?)`)
    .bind(personId, body.fullName, body.email.toLowerCase())
    .run();

  const userId = newId('user');
  const passwordHash = await hashPassword(body.temporaryPassword);
  await c.env.DB.prepare(
    `INSERT INTO users (id, person_id, email, password_hash, role, property_scope) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, personId, body.email.toLowerCase(), passwordHash, body.role, body.propertyScope ?? null)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: body.propertyScope,
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'create',
    entityType: 'user',
    entityId: userId,
    after: { email: body.email, role: body.role, propertyScope: body.propertyScope },
  });

  return c.json({ id: userId }, 201);
});

userRoutes.post('/users/:id/suspend', async (c) => {
  const actor = requireCapability(c, 'user.manage');
  await c.env.DB.prepare(`UPDATE users SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`)
    .bind(c.req.param('id'))
    .run();
  await recordAudit(c.env.DB, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'update',
    entityType: 'user',
    entityId: c.req.param('id'),
    after: { status: 'suspended' },
  });
  return c.json({ ok: true });
});

userRoutes.post('/users/:id/reactivate', async (c) => {
  const actor = requireCapability(c, 'user.manage');
  await c.env.DB.prepare(`UPDATE users SET status = 'active', updated_at = datetime('now') WHERE id = ?`)
    .bind(c.req.param('id'))
    .run();
  await recordAudit(c.env.DB, {
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'update',
    entityType: 'user',
    entityId: c.req.param('id'),
    after: { status: 'active' },
  });
  return c.json({ ok: true });
});
