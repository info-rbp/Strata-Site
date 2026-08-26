import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Capability, Role } from '../domain/security';
import { roleHasCapability } from '../domain/security';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  propertyScope: string | null;
  personId: string | null;
  fullName: string;
}

export type AppBindings = {
  DB: D1Database;
  EVIDENCE: R2Bucket;
};

export type AppVariables = {
  user: AuthUser | null;
};

export const SESSION_COOKIE = 'proinspect_bm_session';
export const LEGACY_SESSION_COOKIE = 'pmhub_session';

// Resolve the renamed ProInspect cookie first, but accept the old PM Hub
// cookie during the release transition so existing authenticated sessions do
// not mysteriously evaporate between deployments.
export async function attachSession(c: Context<{ Bindings: AppBindings; Variables: AppVariables }>, next: Next) {
  const sessionId = getCookie(c, SESSION_COOKIE) ?? getCookie(c, LEGACY_SESSION_COOKIE);
  if (!sessionId) {
    c.set('user', null);
    return next();
  }
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.role, u.property_scope as propertyScope, u.person_id as personId,
              u.status, u.access_expires_at as accessExpiresAt,
              COALESCE(p.full_name, u.email) as fullName
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN people p ON p.id = u.person_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
    .bind(sessionId)
    .first<{
      id: string;
      email: string;
      role: Role;
      propertyScope: string | null;
      personId: string | null;
      status: string;
      accessExpiresAt: string | null;
      fullName: string;
    }>();

  if (!row || row.status !== 'active') {
    c.set('user', null);
    return next();
  }
  // Relief Building Manager time-limited access expiry check.
  if (row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() < Date.now()) {
    c.set('user', null);
    return next();
  }

  c.set('user', {
    id: row.id,
    email: row.email,
    role: row.role,
    propertyScope: row.propertyScope,
    personId: row.personId,
    fullName: row.fullName,
  });
  return next();
}

export function requireAuth(c: Context<{ Bindings: AppBindings; Variables: AppVariables }>): AuthUser {
  const user = c.get('user');
  if (!user) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Login required.');
  }
  return user;
}

export function requireCapability(
  c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  capability: Capability,
): AuthUser {
  const user = requireAuth(c);
  if (!roleHasCapability(user.role, capability)) {
    throw new HttpError(403, 'FORBIDDEN', `Role '${user.role}' lacks capability '${capability}'.`);
  }
  return user;
}

// Enforces property scoping: single-property roles (BM, relief BM,
// contractor, resident) may only touch records for their own property.
// Multi-property roles (strata, council, admin) may pass any propertyId, or
// omit it to mean "all".
export function assertPropertyAccess(user: AuthUser, propertyId: string | null | undefined) {
  if (user.propertyScope && propertyId && user.propertyScope !== propertyId) {
    throw new HttpError(403, 'PROPERTY_SCOPE_VIOLATION', 'You do not have access to this property.');
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Maps each role to its portal home path — used both for post-login
// redirects and for bouncing a signed-in user away from a portal that
// doesn't belong to their role.
export const ROLE_HOME_PATH: Record<Role, string> = {
  system_administrator: '/strata',
  strata_manager: '/strata',
  council_member: '/strata',
  building_manager: '/bm',
  relief_building_manager: '/bm',
  contractor: '/contractor',
  resident: '/resident',
};

// Server-rendered page guard (as opposed to the JSON-error API guards
// above). Redirects to /login if unauthenticated, or to the user's own
// portal home if their role isn't allowed on this page. Returns the
// AuthUser on success so the caller can render with it.
export function pageGuard(
  c: Context<{ Bindings: AppBindings; Variables: AppVariables }>,
  allowedRoles: Role[],
): AuthUser | Response {
  const user = c.get('user');
  if (!user) {
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  if (!allowedRoles.includes(user.role)) {
    return c.redirect(ROLE_HOME_PATH[user.role] ?? '/login');
  }
  return user;
}
