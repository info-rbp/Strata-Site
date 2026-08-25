import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole } from '../lib/notify';
import {
  canTransitionDefect,
  canCloseDefect,
  isImmediateEscalation,
  type DefectStatus,
} from '../domain/workflow';

export const defectRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

defectRoutes.get('/defects', async (c) => {
  const user = requireCapability(c, 'defect.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const status = c.req.query('status');
  let sql = `SELECT d.*, u.unit_number as unitNumber, l.name as locationName, ctr.company_name as contractorName
             FROM defects d
             LEFT JOIN units u ON u.id = d.unit_id
             LEFT JOIN locations l ON l.id = d.location_id
             LEFT JOIN contractors ctr ON ctr.id = d.assigned_contractor_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND d.property_id = ?`;
    binds.push(propertyId);
  }
  if (status) {
    sql += ` AND d.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY CASE d.risk_level WHEN 'immediate_danger' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, d.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

defectRoutes.get('/defects/:id', async (c) => {
  const user = requireCapability(c, 'defect.read');
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id as string);
  const { results: evidence } = await c.env.DB.prepare(`SELECT * FROM defect_evidence WHERE defect_id = ?`)
    .bind(defect.id)
    .all();
  const { results: workOrders } = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE defect_id = ?`)
    .bind(defect.id)
    .all();
  const { results: quotes } = await c.env.DB.prepare(`SELECT * FROM quotes WHERE defect_id = ?`)
    .bind(defect.id)
    .all();
  return c.json({ defect, evidence: evidence ?? [], workOrders: workOrders ?? [], quotes: quotes ?? [] });
});

// BM creates a defect directly (inspection failures, direct BM observation).
defectRoutes.post('/defects', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{
    propertyId?: string;
    unitId?: string;
    locationId?: string;
    category: string;
    description: string;
    riskLevel?: 'normal' | 'high' | 'immediate_danger';
    source?: string;
    sourceInspectionId?: string;
    isCommonProperty?: boolean;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  const id = newId('defect');
  await c.env.DB.prepare(
    `INSERT INTO defects
      (id, property_id, unit_id, location_id, category, source, source_inspection_id, description, risk_level, is_common_property, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bm_assessment')`,
  )
    .bind(
      id,
      propertyId,
      body.unitId ?? null,
      body.locationId ?? null,
      body.category,
      body.source ?? 'building_manager',
      body.sourceInspectionId ?? null,
      body.description,
      body.riskLevel ?? 'normal',
      body.isCommonProperty === false ? 0 : 1,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'defect',
    entityId: id,
    after: body,
  });

  if (isImmediateEscalation(body.riskLevel ?? 'normal')) {
    await notifyRole(c.env.DB, {
      propertyId,
      role: 'strata_manager',
      title: `High-risk defect: ${body.category}`,
      linkedEntityType: 'defect',
      linkedEntityId: id,
    });
  }

  return c.json({ id, status: 'bm_assessment' }, 201);
});

// Generic status-transition endpoint. Every jump is validated against the
// state machine in src/domain/workflow.ts — the client cannot skip steps.
defectRoutes.post('/defects/:id/transition', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{ toStatus: DefectStatus; notes?: string; assignedContractorId?: string; dueDate?: string; quoteRequired?: boolean }>();
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: DefectStatus;
  }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);

  if (!canTransitionDefect(defect.status, body.toStatus)) {
    throw new HttpError(
      409,
      'INVALID_TRANSITION',
      `Cannot move defect from '${defect.status}' to '${body.toStatus}'.`,
    );
  }

  await c.env.DB.prepare(
    `UPDATE defects SET status = ?, assigned_contractor_id = COALESCE(?, assigned_contractor_id),
       due_date = COALESCE(?, due_date), quote_required = COALESCE(?, quote_required),
       updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.toStatus,
      body.assignedContractorId ?? null,
      body.dueDate ?? null,
      body.quoteRequired === undefined ? null : body.quoteRequired ? 1 : 0,
      defect.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'defect',
    entityId: defect.id,
    before: { status: defect.status },
    after: { status: body.toStatus, notes: body.notes },
  });

  return c.json({ id: defect.id, status: body.toStatus });
});

defectRoutes.post('/defects/:id/complete', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{ workCompletedNotes: string; costAmount?: number; requiresPermanentFollowup?: boolean }>();
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: DefectStatus;
  }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);
  if (!canTransitionDefect(defect.status, 'completed')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot complete a defect in status '${defect.status}'.`);
  }
  await c.env.DB.prepare(
    `UPDATE defects SET status = 'completed', work_completed_notes = ?, cost_amount = ?, completion_date = datetime('now'),
       requires_permanent_followup = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.workCompletedNotes, body.costAmount ?? null, body.requiresPermanentFollowup ? 1 : 0, defect.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'defect',
    entityId: defect.id,
    before: { status: defect.status },
    after: { status: 'completed', ...body },
  });

  return c.json({ id: defect.id, status: 'completed' });
});

defectRoutes.post('/defects/:id/verify', async (c) => {
  const user = requireCapability(c, 'defect.verify');
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: DefectStatus;
  }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);
  await c.env.DB.prepare(`UPDATE defects SET verified_by_user_id = ?, verified_at = datetime('now') WHERE id = ?`)
    .bind(user.id, defect.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'verify',
    entityType: 'defect',
    entityId: defect.id,
  });
  return c.json({ id: defect.id, verified: true });
});

defectRoutes.post('/defects/:id/close', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: DefectStatus;
    verified_by_user_id: string | null;
  }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);

  const { results: evidence } = await c.env.DB.prepare(`SELECT id FROM defect_evidence WHERE defect_id = ?`)
    .bind(defect.id)
    .all();

  const gate = canCloseDefect({
    status: defect.status,
    hasCompletionEvidence: (evidence?.length ?? 0) > 0,
    verifiedByUserId: defect.verified_by_user_id,
  });
  if (!gate.allowed) {
    throw new HttpError(409, 'CLOSE_BLOCKED', gate.reason ?? 'Defect cannot be closed yet.');
  }

  await c.env.DB.prepare(`UPDATE defects SET status = 'closed', updated_at = datetime('now') WHERE id = ?`)
    .bind(defect.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'defect',
    entityId: defect.id,
    before: { status: defect.status },
    after: { status: 'closed' },
  });

  return c.json({ id: defect.id, status: 'closed' });
});

// Evidence upload metadata (actual bytes go to R2 via /api/documents/upload,
// this links the resulting r2Key to the defect).
defectRoutes.post('/defects/:id/evidence', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{ r2Key: string; contentType?: string; caption?: string }>();
  const defect = await c.env.DB.prepare(`SELECT property_id FROM defects WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ property_id: string }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);
  const id = newId('evid');
  await c.env.DB.prepare(
    `INSERT INTO defect_evidence (id, defect_id, r2_key, content_type, caption, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, c.req.param('id'), body.r2Key, body.contentType ?? null, body.caption ?? null, user.id)
    .run();
  return c.json({ id }, 201);
});
