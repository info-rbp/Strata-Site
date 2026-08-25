import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { canTransitionWorkOrder, type WorkOrderStatus } from '../domain/workflow';

export const workOrderRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

workOrderRoutes.get('/work-orders', async (c) => {
  const user = requireCapability(c, 'workorder.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const contractorId = c.req.query('contractorId');
  let sql = `SELECT w.*, d.category as defectCategory, ctr.company_name as contractorName
             FROM work_orders w
             LEFT JOIN defects d ON d.id = w.defect_id
             LEFT JOIN contractors ctr ON ctr.id = w.contractor_id
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
  sql += ` ORDER BY w.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

workOrderRoutes.get('/work-orders/:id', async (c) => {
  const user = requireCapability(c, 'workorder.read');
  const wo = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE id = ?`).bind(c.req.param('id')).first();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, wo.property_id as string);
  return c.json(wo);
});

// Created from a defect (or standalone) per Section 8.3.
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

  const id = newId('wo');
  await c.env.DB.prepare(
    `INSERT INTO work_orders
      (id, property_id, defect_id, scope, location_id, asset_id, contractor_id, scheduled_at, access_needs, shutdown_required, resident_impact_notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      body.defectId ?? null,
      body.scope,
      body.locationId ?? null,
      body.assetId ?? null,
      body.contractorId ?? null,
      body.scheduledAt ?? null,
      body.accessNeeds ?? null,
      body.shutdownRequired ? 1 : 0,
      body.residentImpactNotes ?? null,
      body.contractorId && body.scheduledAt ? 'scheduled' : 'created',
    )
    .run();

  if (body.defectId) {
    await c.env.DB.prepare(`UPDATE defects SET assigned_contractor_id = COALESCE(?, assigned_contractor_id) WHERE id = ?`)
      .bind(body.contractorId ?? null, body.defectId)
      .run();
  }

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'work_order',
    entityId: id,
    after: body,
  });

  if (body.scheduledAt) {
    await c.env.DB.prepare(
      `INSERT INTO calendar_events (id, property_id, event_type, title, starts_at, linked_entity_type, linked_entity_id)
       VALUES (?, ?, 'contractor_visit', ?, ?, 'work_order', ?)`,
    )
      .bind(newId('cal'), propertyId, `Contractor visit: ${body.scope.slice(0, 60)}`, body.scheduledAt, id)
      .run();
  }

  return c.json({ id, status: body.contractorId && body.scheduledAt ? 'scheduled' : 'created' }, 201);
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

// Contractor completion: findings, work performed, recommendations, report.
workOrderRoutes.post('/work-orders/:id/complete', async (c) => {
  const user = requireCapability(c, 'workorder.manage');
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
  }>();
  if (!wo) return c.json({ error: { code: 'NOT_FOUND', message: 'Work order not found.' } }, 404);
  assertPropertyAccess(user, wo.property_id);
  if (!canTransitionWorkOrder(wo.status, 'completed')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot complete a work order in status '${wo.status}'.`);
  }

  await c.env.DB.prepare(
    `UPDATE work_orders SET status = 'completed', findings = ?, work_performed = ?, recommendations = ?,
       service_report_r2_key = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.findings ?? null, body.workPerformed, body.recommendations ?? null, body.serviceReportR2Key ?? null, wo.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: wo.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'work_order',
    entityId: wo.id,
    before: { status: wo.status },
    after: { status: 'completed', ...body },
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
    `UPDATE work_orders SET status = 'verified', verified_by_user_id = ?, verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
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
