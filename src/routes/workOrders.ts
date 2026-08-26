import { Hono } from 'hono';
import type { AppBindings, AppVariables, AuthUser } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole } from '../lib/notify';
import { requiredString, optionalString, booleanValue } from '../lib/operationalInput';
import { canTransitionWorkOrder, type WorkOrderStatus } from '../domain/workflow';

export const workOrderRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

async function contractorIdForUser(db: D1Database, user: AuthUser): Promise<string | null> {
  if (user.role !== 'contractor') return null;
  const row = await db.prepare(`SELECT id FROM contractors WHERE lower(contact_email) = lower(?) AND status = 'active'`)
    .bind(user.email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

workOrderRoutes.get('/work-orders', async (c) => {
  const user = requireCapability(c, 'workorder.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let contractorId = c.req.query('contractorId') ?? null;
  if (user.role === 'contractor') {
    contractorId = await contractorIdForUser(c.env.DB, user);
    if (!contractorId) return c.json([]);
  }
  let sql = `SELECT w.*, d.category as defectCategory, ctr.company_name as contractorName,
                    l.name as locationName
             FROM work_orders w
             LEFT JOIN defects d ON d.id = w.defect_id
             LEFT JOIN contractors ctr ON ctr.id = w.contractor_id
             LEFT JOIN locations l ON l.id = w.location_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND w.property_id = ?`;
    binds.push(propertyId);
  }
  if (contractorId) {
    sql += ` AND w.contractor_id = ?`;
    binds.push(contractorId);
  }
  sql += ` ORDER BY CASE w.status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, w.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

workOrderRoutes.get('/work-orders/:id', async (c) => {
  const user = requireCapability(c, 'workorder.read');
  const wo = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, String(wo.property_id));
  if (user.role === 'contractor') {
    const contractorId = await contractorIdForUser(c.env.DB, user);
    if (!contractorId || contractorId !== wo.contractor_id) {
      throw new HttpError(403, 'WORK_ORDER_NOT_ASSIGNED', 'This work order is not assigned to your company.');
    }
  }
  return c.json(wo);
});

// Created from a defect (or standalone) by Building Management.
workOrderRoutes.post('/work-orders', async (c) => {
  const user = requireCapability(c, 'workorder.manage');
  const body = await c.req.json<{
    propertyId?: string;
    defectId?: string;
    scope: string;
    locationId?: string;
    assetId?: string;
    contractorId?: string;
    scheduledAt?: string;
    accessNeeds?: string;
    shutdownRequired?: boolean;
    residentImpactNotes?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const defectId = optionalString(body.defectId, 120);
  const locationId = optionalString(body.locationId, 120);
  const contractorId = optionalString(body.contractorId, 120);
  if (defectId) {
    const defect = await c.env.DB.prepare(`SELECT id FROM defects WHERE id = ? AND property_id = ?`)
      .bind(defectId, propertyId)
      .first();
    if (!defect) throw new HttpError(400, 'DEFECT_NOT_FOUND', 'Defect does not belong to this property.');
  }
  if (locationId) {
    const location = await c.env.DB.prepare(`SELECT id FROM locations WHERE id = ? AND property_id = ?`)
      .bind(locationId, propertyId)
      .first();
    if (!location) throw new HttpError(400, 'LOCATION_NOT_FOUND', 'Location does not belong to this property.');
  }
  if (contractorId) {
    const contractor = await c.env.DB.prepare(`SELECT id FROM contractors WHERE id = ? AND status = 'active'`)
      .bind(contractorId)
      .first();
    if (!contractor) throw new HttpError(400, 'CONTRACTOR_NOT_FOUND', 'Contractor is not active.');
  }

  const id = newId('wo');
  const scope = requiredString(body.scope, 'scope', 5, 5000);
  const scheduledAt = optionalString(body.scheduledAt, 80);
  const status = contractorId && scheduledAt ? 'scheduled' : 'created';
  const normalized = {
    propertyId,
    defectId,
    scope,
    locationId,
    assetId: optionalString(body.assetId, 120),
    contractorId,
    scheduledAt,
    accessNeeds: optionalString(body.accessNeeds, 2000),
    shutdownRequired: booleanValue(body.shutdownRequired),
    residentImpactNotes: optionalString(body.residentImpactNotes, 3000),
    status,
  };
  await c.env.DB.prepare(
    `INSERT INTO work_orders
      (id, property_id, defect_id, scope, location_id, asset_id, contractor_id,
       scheduled_at, access_needs, shutdown_required, resident_impact_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      defectId,
      scope,
      locationId,
      normalized.assetId,
      contractorId,
      scheduledAt,
      normalized.accessNeeds,
      normalized.shutdownRequired ? 1 : 0,
      normalized.residentImpactNotes,
      status,
    )
    .run();

  if (defectId) {
    await c.env.DB.prepare(
      `UPDATE defects SET assigned_contractor_id = COALESCE(?, assigned_contractor_id),
       status = CASE WHEN ? IS NOT NULL THEN 'contractor_booked' ELSE status END,
       updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(contractorId, scheduledAt, defectId)
      .run();
  }

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'work_order',
    entityId: id,
    after: normalized,
  });

  if (scheduledAt) {
    await c.env.DB.prepare(
      `INSERT INTO calendar_events
        (id, property_id, event_type, title, starts_at, linked_entity_type, linked_entity_id)
       VALUES (?, ?, 'contractor_visit', ?, ?, 'work_order', ?)`,
    )
      .bind(newId('cal'), propertyId, `Contractor visit: ${scope.slice(0, 60)}`, scheduledAt, id)
      .run();
  }

  return c.json({ id, status }, 201);
});

workOrderRoutes.post('/work-orders/:id/transition', async (c) => {
  const user = requireCapability(c, 'workorder.manage');
  const body = await c.req.json<{ toStatus: WorkOrderStatus }>();
  const wo = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: WorkOrderStatus;
  }>();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, wo.property_id);
  if (!canTransitionWorkOrder(wo.status, body.toStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move work order from '${wo.status}' to '${body.toStatus}'.`);
  }
  await c.env.DB.prepare(`UPDATE work_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.toStatus, wo.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: wo.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'work_order',
    entityId: wo.id,
    before: { status: wo.status },
    after: { status: body.toStatus },
  });
  return c.json({ id: wo.id, status: body.toStatus });
});

// Contractor or Building Manager completion: findings, work performed,
// recommendations and service report. Contractors are limited to work orders
// assigned to their own company.
workOrderRoutes.post('/work-orders/:id/complete', async (c) => {
  const user = requireCapability(c, 'workorder.complete');
  const body = await c.req.json<{
    findings?: string;
    workPerformed: string;
    recommendations?: string;
    serviceReportR2Key?: string;
  }>();
  const wo = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: WorkOrderStatus;
    defect_id: string | null;
    contractor_id: string | null;
  }>();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, wo.property_id);
  if (user.role === 'contractor') {
    const contractorId = await contractorIdForUser(c.env.DB, user);
    if (!contractorId || contractorId !== wo.contractor_id) {
      throw new HttpError(403, 'WORK_ORDER_NOT_ASSIGNED', 'This work order is not assigned to your company.');
    }
  }
  if (!canTransitionWorkOrder(wo.status, 'completed')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot complete a work order in status '${wo.status}'.`);
  }
  const workPerformed = requiredString(body.workPerformed, 'workPerformed', 3, 5000);
  const serviceReportR2Key = optionalString(body.serviceReportR2Key, 500);
  if (serviceReportR2Key && !serviceReportR2Key.startsWith(`${wo.property_id}/`) && !serviceReportR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Service report does not belong to this property.');
  }
  const normalized = {
    findings: optionalString(body.findings, 3000),
    workPerformed,
    recommendations: optionalString(body.recommendations, 3000),
    serviceReportR2Key,
  };

  await c.env.DB.prepare(
    `UPDATE work_orders SET status = 'completed', findings = ?, work_performed = ?, recommendations = ?,
       service_report_r2_key = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(
      normalized.findings,
      workPerformed,
      normalized.recommendations,
      serviceReportR2Key,
      wo.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId: wo.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'work_order',
    entityId: wo.id,
    before: { status: wo.status },
    after: { status: 'completed', ...normalized },
  });
  await notifyRole(c.env.DB, {
    propertyId: wo.property_id,
    role: 'building_manager',
    title: 'Work order submitted for verification',
    body: workPerformed.slice(0, 180),
    linkedEntityType: 'work_order',
    linkedEntityId: wo.id,
  });

  return c.json({ id: wo.id, status: 'completed' });
});

// BM verification of completed work order (may unblock linked defect close).
workOrderRoutes.post('/work-orders/:id/verify', async (c) => {
  const user = requireCapability(c, 'workorder.verify');
  const wo = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: WorkOrderStatus;
    defect_id: string | null;
  }>();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, wo.property_id);
  if (!canTransitionWorkOrder(wo.status, 'verified')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot verify a work order in status '${wo.status}'.`);
  }
  await c.env.DB.prepare(
    `UPDATE work_orders SET status = 'verified', verified_by_user_id = ?, verified_at = datetime('now'),
       updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(user.id, wo.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: wo.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'verify',
    entityType: 'work_order',
    entityId: wo.id,
  });
  return c.json({ id: wo.id, status: 'verified' });
});
