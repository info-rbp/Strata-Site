import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, requireAuth, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { isImmediateEscalation } from '../domain/workflow';

export const requestRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Resident submits "Report a Problem" (Section 5.2).
requestRoutes.post('/requests', async (c) => {
  const user = requireCapability(c, 'request.create');
  const body = await c.req.json<{
    unitId?: string;
    propertyId?: string;
    locationText?: string;
    category: string;
    description: string;
    urgency?: 'normal' | 'urgent';
    apartmentAccessRequired?: boolean;
    contactDetails?: string;
  }>();

  if (!body.description || body.description.trim().length < 5) {
    throw new HttpError(400, 'INVALID_INPUT', 'Description must be a meaningful length.');
  }

  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  const id = newId('req');
  await c.env.DB.prepare(
    `INSERT INTO resident_requests
      (id, property_id, unit_id, requested_by_person_id, location_text, category, description, urgency, apartment_access_required, contact_details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      body.unitId ?? null,
      user.personId,
      body.locationText ?? null,
      body.category,
      body.description.trim(),
      body.urgency ?? 'normal',
      body.apartmentAccessRequired ? 1 : 0,
      body.contactDetails ?? null,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'resident_request',
    entityId: id,
    after: body,
  });

  await createTask(c.env.DB, {
    propertyId,
    title: `Triage resident request: ${body.category}`,
    taskType: 'triage',
    linkedEntityType: 'resident_request',
    linkedEntityId: id,
    priority: body.urgency === 'urgent' ? 'urgent' : 'normal',
    assigneeRole: 'building_manager',
  });

  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `New resident request: ${body.category}`,
    body: body.description.slice(0, 140),
    linkedEntityType: 'resident_request',
    linkedEntityId: id,
  });

  return c.json({ id, referenceNumber: id, status: 'new' }, 201);
});

requestRoutes.get('/requests', async (c) => {
  const user = requireCapability(c, 'request.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const isResidentSelf = user.role === 'resident';
  let sql = `SELECT r.*, u.unit_number as unitNumber FROM resident_requests r LEFT JOIN units u ON u.id = r.unit_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND r.property_id = ?`;
    binds.push(propertyId);
  }
  if (isResidentSelf) {
    sql += ` AND r.requested_by_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

requestRoutes.get('/requests/:id', async (c) => {
  const user = requireCapability(c, 'request.read');
  const row = await c.env.DB.prepare(`SELECT * FROM resident_requests WHERE id = ?`).bind(c.req.param('id')).first();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  assertPropertyAccess(user, row.property_id as string);
  if (user.role === 'resident' && row.requested_by_person_id !== user.personId) {
    throw new HttpError(403, 'FORBIDDEN', 'Not your request.');
  }
  return c.json(row);
});

// Building Manager converts/accepts a resident request into a defect
// (Section 5.2 automation: "same record converts into the maintenance
// workflow without re-entry").
requestRoutes.post('/requests/:id/convert-to-defect', async (c) => {
  const user = requireCapability(c, 'request.triage');
  const requestId = c.req.param('id');
  const body = await c.req
    .json<{
      riskLevel?: 'normal' | 'high' | 'immediate_danger';
      isCommonProperty?: boolean;
      immediateResponse?: string;
    }>()
    .catch(() => ({}));

  const request = await c.env.DB.prepare(`SELECT * FROM resident_requests WHERE id = ?`).bind(requestId).first<{
    id: string;
    property_id: string;
    unit_id: string | null;
    category: string;
    description: string;
    urgency: string;
    status: string;
  }>();
  if (!request) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  assertPropertyAccess(user, request.property_id);
  if (request.status === 'converted_to_defect') {
    throw new HttpError(409, 'ALREADY_CONVERTED', 'This request has already been converted to a defect.');
  }

  const riskLevel = body.riskLevel ?? (request.urgency === 'urgent' ? 'high' : 'normal');
  const defectId = newId('defect');
  await c.env.DB.prepare(
    `INSERT INTO defects
      (id, property_id, unit_id, category, source, source_resident_request_id, description, risk_level, priority, is_common_property, immediate_response, status)
     VALUES (?, ?, ?, ?, 'resident', ?, ?, ?, ?, ?, ?, 'bm_assessment')`,
  )
    .bind(
      defectId,
      request.property_id,
      request.unit_id,
      request.category,
      request.id,
      request.description,
      riskLevel,
      request.urgency === 'urgent' ? 'urgent' : 'normal',
      body.isCommonProperty === false ? 0 : 1,
      body.immediateResponse ?? null,
    )
    .run();

  await c.env.DB.prepare(`UPDATE resident_requests SET status = 'converted_to_defect', defect_id = ? WHERE id = ?`)
    .bind(defectId, requestId)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: request.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'defect',
    entityId: defectId,
    after: { source: 'resident_request', requestId },
  });

  if (isImmediateEscalation(riskLevel)) {
    await notifyRole(c.env.DB, {
      propertyId: request.property_id,
      role: 'strata_manager',
      title: `High-risk defect created: ${request.category}`,
      body: request.description.slice(0, 140),
      linkedEntityType: 'defect',
      linkedEntityId: defectId,
    });
    await createTask(c.env.DB, {
      propertyId: request.property_id,
      title: `URGENT: assess high-risk defect (${request.category})`,
      taskType: 'triage',
      linkedEntityType: 'defect',
      linkedEntityId: defectId,
      priority: 'urgent',
      assigneeRole: 'building_manager',
    });
  }

  return c.json({ defectId, status: 'bm_assessment' }, 201);
});
