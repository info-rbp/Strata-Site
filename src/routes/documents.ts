import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireAuth, requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const documentRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Generic evidence/document upload to R2. Any authenticated user may upload
// (residents attach photos to requests, contractors attach service reports);
// visibility and linkage to a business record are enforced by the specific
// entity route (e.g. POST /defects/:id/evidence), not here.
documentRoutes.post('/uploads', async (c) => {
  const user = requireAuth(c);
  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    throw new HttpError(400, 'EMPTY_UPLOAD', 'Upload body is empty.');
  }
  if (body.byteLength > 15 * 1024 * 1024) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Files must be under 15MB.');
  }
  const ext = contentType.split('/')[1] ?? 'bin';
  const key = `${user.propertyScope ?? 'shared'}/${new Date().toISOString().slice(0, 10)}/${newId('upl')}.${ext}`;
  await c.env.EVIDENCE.put(key, body, { httpMetadata: { contentType } });
  return c.json({ r2Key: key, contentType, size: body.byteLength }, 201);
});

documentRoutes.get('/uploads/:key{.+}', async (c) => {
  requireAuth(c);
  const key = c.req.param('key');
  const object = await c.env.EVIDENCE.get(key);
  if (!object) return c.notFound();
  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream' },
  });
});

// --- Document register (Section 15.3) ------------------------------------

documentRoutes.get('/documents', async (c) => {
  const user = requireCapability(c, 'document.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM documents WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND visibility = 'resident_visible'`;
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

documentRoutes.post('/documents', async (c) => {
  const user = requireCapability(c, 'document.manage');
  const body = await c.req.json<{
    propertyId?: string;
    title: string;
    category?: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
    r2Key: string;
    contentType?: string;
    version?: string;
    visibility?: 'internal' | 'resident_visible' | 'restricted';
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const id = newId('doc');
  await c.env.DB.prepare(
    `INSERT INTO documents (id, property_id, title, category, linked_entity_type, linked_entity_id, r2_key, content_type, version, visibility, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      body.title,
      body.category ?? null,
      body.linkedEntityType ?? null,
      body.linkedEntityId ?? null,
      body.r2Key,
      body.contentType ?? null,
      body.version ?? null,
      body.visibility ?? 'internal',
      user.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'document',
    entityId: id,
    after: { title: body.title, category: body.category },
  });

  return c.json({ id }, 201);
});
