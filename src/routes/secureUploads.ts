import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireAuth, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const secureUploadRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
]);

function safeFileName(raw: string | undefined): string {
  let name = raw || 'upload';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the original header value if it was not URI encoded.
  }
  const base = name.split(/[\\/]/).pop() || 'upload';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'upload';
}

function propertyFromKey(key: string): string | null {
  const [prefix] = key.split('/');
  return prefix && prefix.startsWith('prop_') ? prefix : null;
}

function objectContentDisposition(contentType: string, fileName: string): string {
  const mode = contentType.startsWith('image/') || contentType === 'application/pdf' ? 'inline' : 'attachment';
  return `${mode}; filename="${fileName.replace(/["\\]/g, '_')}"`;
}

/**
 * New evidence objects are always property-prefixed and stamped with uploader
 * metadata. This closes the old pattern where possession of an R2 key was
 * effectively treated as authorisation.
 */
secureUploadRoutes.post('/uploads', async (c) => {
  const user = requireAuth(c);
  const suppliedPropertyId = c.req.header('X-Property-Id')?.trim() || null;
  const propertyId = user.propertyScope ?? suppliedPropertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'X-Property-Id is required for uploads.');
  assertPropertyAccess(user, propertyId);

  const property = await c.env.DB.prepare(`SELECT id FROM properties WHERE id = ?`).bind(propertyId).first();
  if (!property) throw new HttpError(404, 'PROPERTY_NOT_FOUND', 'Property not found.');

  const contentType = (c.req.header('Content-Type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload an image, PDF or plain-text document.');
  }
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Files must be 15 MB or smaller.');
  }

  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, 'EMPTY_UPLOAD', 'The uploaded file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'Files must be 15 MB or smaller.');
  }

  const fileName = safeFileName(c.req.header('X-File-Name'));
  const now = new Date();
  const key = `${propertyId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${newId('upload')}-${fileName}`;
  await c.env.EVIDENCE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      propertyId,
      uploadedByUserId: user.id,
      uploadedByRole: user.role,
      originalFileName: fileName,
      uploadedAt: now.toISOString(),
    },
  });

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'evidence_object',
    entityId: key,
    after: { contentType, size: bytes.byteLength, originalFileName: fileName },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      r2Key: key,
      contentType,
      originalFileName: fileName,
      size: bytes.byteLength,
      propertyId,
    },
    201,
  );
});

async function serveObject(c: Parameters<typeof requireAuth>[0], key: string): Promise<Response> {
  const user = requireAuth(c);
  const decodedKey = decodeURIComponent(key).replace(/^\/+/, '');
  if (!decodedKey || decodedKey.includes('..')) {
    throw new HttpError(400, 'INVALID_OBJECT_KEY', 'Invalid evidence object key.');
  }

  const object = await c.env.EVIDENCE.get(decodedKey);
  if (!object) throw new HttpError(404, 'FILE_NOT_FOUND', 'Evidence file not found.');
  const metadataPropertyId = object.customMetadata?.propertyId || null;
  const propertyId = metadataPropertyId ?? propertyFromKey(decodedKey);
  if (!propertyId) {
    // Legacy unscoped objects are intentionally unavailable through this public
    // route. They can be migrated by an administrator rather than guessed at.
    throw new HttpError(403, 'LEGACY_OBJECT_UNSCOPED', 'This legacy file must be migrated before it can be viewed.');
  }
  assertPropertyAccess(user, propertyId);

  if (user.role === 'resident' || user.role === 'contractor') {
    const uploadedByUserId = object.customMetadata?.uploadedByUserId || null;
    if (!uploadedByUserId || uploadedByUserId !== user.id) {
      throw new HttpError(403, 'FILE_ACCESS_DENIED', 'This evidence file is not available to your account.');
    }
  }

  const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
  const fileName = object.customMetadata?.originalFileName || decodedKey.split('/').pop() || 'evidence';
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', objectContentDisposition(contentType, fileName));
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

// Wildcard route supports property-prefixed keys containing folders.
secureUploadRoutes.get('/uploads/*', async (c) => {
  const prefix = '/api/uploads/';
  const key = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : c.req.path.split('/uploads/')[1] || '';
  return serveObject(c, key);
});
