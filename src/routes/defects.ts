import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { captureOperationalForm, findExistingCapturedEntity } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  booleanValue,
  validDateOnly,
  resolveIdempotencyKey,
} from '../lib/operationalInput';
import {
  DEFECT_CATEGORIES,
  PRIORITIES,
  RESPONSIBILITY_OPTIONS,
  RISK_LEVELS,
  isOptionValue,
} from '../domain/operationalForms';
import {
  canTransitionDefect,
  canCloseDefect,
  isImmediateEscalation,
  type DefectStatus,
} from '../domain/workflow';

export const defectRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

async function assertRelatedRecord(
  db: D1Database,
  table: 'locations' | 'units',
  id: string | null,
  propertyId: string,
): Promise<void> {
  if (!id) return;
  const sql = table === 'locations'
    ? `SELECT id FROM locations WHERE id = ? AND property_id = ?`
    : `SELECT id FROM units WHERE id = ? AND property_id = ?`;
  const record = await db.prepare(sql).bind(id, propertyId).first();
  if (!record) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', `${table.slice(0, -1)} does not belong to this property.`);
}

defectRoutes.get('/defects', async (c) => {
  const user = requireCapability(c, 'defect.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
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
  sql += ` ORDER BY CASE d.risk_level WHEN 'immediate_danger' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, d.created_at DESC LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

defectRoutes.get('/defects/:id', async (c) => {
  const user = requireCapability(c, 'defect.read');
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id as string);
  const { results: evidence } = await c.env.DB.prepare(`SELECT * FROM defect_evidence WHERE defect_id = ? ORDER BY created_at`)
    .bind(defect.id)
    .all();
  const { results: workOrders } = await c.env.DB.prepare(`SELECT * FROM work_orders WHERE defect_id = ? ORDER BY created_at`)
    .bind(defect.id)
    .all();
  const { results: quotes } = await c.env.DB.prepare(`SELECT * FROM quotes WHERE defect_id = ? ORDER BY created_at`)
    .bind(defect.id)
    .all();
  return c.json({ defect, evidence: evidence ?? [], workOrders: workOrders ?? [], quotes: quotes ?? [] });
});

// Building Manager creates a defect directly from a field observation. Rich
// fields mirror the paper/Google Form design and are retained for monthly
// reporting instead of being compressed into one unsearchable notes box.
defectRoutes.post('/defects', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{
    propertyId?: string;
    unitId?: string;
    locationId?: string;
    specificLocation?: string;
    category: string;
    description: string;
    riskLevel?: 'normal' | 'high' | 'immediate_danger';
    priority?: string;
    source?: string;
    sourceInspectionId?: string;
    sourceIncidentId?: string;
    isCommonProperty?: boolean;
    responsibility?: string;
    immediateResponse?: string;
    contractorRequired?: boolean;
    assignedContractorId?: string;
    strataApprovalRequired?: boolean;
    quoteRequired?: boolean;
    dueDate?: string;
    nextFollowUpDate?: string;
    evidenceR2Key?: string;
    evidenceContentType?: string;
    evidenceCaption?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, status: 'bm_assessment', duplicate: true });

  if (!isOptionValue(DEFECT_CATEGORIES, body.category)) {
    throw new HttpError(400, 'INVALID_CATEGORY', 'Unknown defect category.');
  }
  const riskLevel = body.riskLevel ?? 'normal';
  if (!isOptionValue(RISK_LEVELS, riskLevel)) throw new HttpError(400, 'INVALID_RISK', 'Unknown risk level.');
  const priority = body.priority ?? (riskLevel === 'normal' ? 'routine' : riskLevel === 'high' ? 'high' : 'urgent');
  if (!isOptionValue(PRIORITIES, priority)) throw new HttpError(400, 'INVALID_PRIORITY', 'Unknown priority.');
  if (body.responsibility && !isOptionValue(RESPONSIBILITY_OPTIONS, body.responsibility)) {
    throw new HttpError(400, 'INVALID_RESPONSIBILITY', 'Unknown responsibility option.');
  }

  const unitId = optionalString(body.unitId, 120);
  const locationId = optionalString(body.locationId, 120);
  await Promise.all([
    assertRelatedRecord(c.env.DB, 'units', unitId, propertyId),
    assertRelatedRecord(c.env.DB, 'locations', locationId, propertyId),
  ]);
  const description = requiredString(body.description, 'description', 5, 5000);
  const responsibility = optionalString(body.responsibility, 80);
  const isCommonProperty = responsibility === 'lot_property'
    ? false
    : body.isCommonProperty === undefined
      ? true
      : booleanValue(body.isCommonProperty);
  const contractorRequired = booleanValue(body.contractorRequired);
  const quoteRequired = booleanValue(body.quoteRequired);
  const nextFollowUpDate = validDateOnly(body.nextFollowUpDate, 'nextFollowUpDate');
  const dueDate = validDateOnly(body.dueDate, 'dueDate');
  const id = newId('defect');
  const normalized = {
    propertyId,
    unitId,
    locationId,
    specificLocation: optionalString(body.specificLocation, 240),
    category: body.category,
    description,
    riskLevel,
    priority,
    source: optionalString(body.source, 80) ?? 'building_manager',
    sourceInspectionId: optionalString(body.sourceInspectionId, 120),
    sourceIncidentId: optionalString(body.sourceIncidentId, 120),
    isCommonProperty,
    responsibility,
    immediateResponse: optionalString(body.immediateResponse, 3000),
    contractorRequired,
    assignedContractorId: optionalString(body.assignedContractorId, 120),
    strataApprovalRequired: booleanValue(body.strataApprovalRequired),
    quoteRequired,
    dueDate,
    nextFollowUpDate,
    evidenceR2Key: optionalString(body.evidenceR2Key, 500),
  };

  await c.env.DB.prepare(
    `INSERT INTO defects
      (id, property_id, unit_id, location_id, specific_location, category, source,
       source_inspection_id, source_incident_id, description, risk_level, priority,
       is_common_property, responsibility, immediate_response, status,
       assigned_contractor_id, quote_required, due_date, strata_approval_required,
       next_follow_up_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bm_assessment', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      unitId,
      locationId,
      normalized.specificLocation,
      body.category,
      normalized.source,
      normalized.sourceInspectionId,
      normalized.sourceIncidentId,
      description,
      riskLevel,
      priority,
      isCommonProperty ? 1 : 0,
      responsibility,
      normalized.immediateResponse,
      normalized.assignedContractorId,
      quoteRequired ? 1 : 0,
      dueDate,
      normalized.strataApprovalRequired ? 1 : 0,
      nextFollowUpDate,
    )
    .run();

  if (normalized.evidenceR2Key) {
    await c.env.DB.prepare(
      `INSERT INTO defect_evidence (id, defect_id, r2_key, content_type, caption, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('evid'),
        id,
        normalized.evidenceR2Key,
        optionalString(body.evidenceContentType, 160),
        optionalString(body.evidenceCaption, 500),
        user.id,
      )
      .run();
  }

  if (nextFollowUpDate || contractorRequired || normalized.strataApprovalRequired) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Follow up defect: ${description.slice(0, 100)}`,
      taskType: normalized.strataApprovalRequired ? 'approval_followup' : 'triage',
      linkedEntityType: 'defect',
      linkedEntityId: id,
      dueAt: nextFollowUpDate ?? dueDate,
      priority: isImmediateEscalation(riskLevel) ? 'urgent' : 'normal',
      assigneeRole: normalized.strataApprovalRequired ? 'strata_manager' : 'building_manager',
    });
  }

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'maintenance_defect',
    entityType: 'defect',
    entityId: id,
    payload: normalized,
    submittedByUserId: user.id,
    clientSubmissionId,
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'defect',
    entityId: id,
    after: normalized,
  });

  if (isImmediateEscalation(riskLevel)) {
    await notifyRole(c.env.DB, {
      propertyId,
      role: 'strata_manager',
      title: `High-risk defect: ${body.category}`,
      body: description.slice(0, 180),
      linkedEntityType: 'defect',
      linkedEntityId: id,
    });
  }

  return c.json({ id, status: 'bm_assessment', duplicate: false }, 201);
});

// Generic status-transition endpoint. Every jump is validated against the
// state machine in src/domain/workflow.ts; the client cannot skip steps.
defectRoutes.post('/defects/:id/transition', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{
    toStatus: DefectStatus;
    notes?: string;
    assignedContractorId?: string;
    dueDate?: string;
    quoteRequired?: boolean;
    nextFollowUpDate?: string;
  }>();
  const defect = await c.env.DB.prepare(`SELECT * FROM defects WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: DefectStatus;
  }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);

  if (!canTransitionDefect(defect.status, body.toStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move defect from '${defect.status}' to '${body.toStatus}'.`);
  }

  const dueDate = validDateOnly(body.dueDate, 'dueDate');
  const nextFollowUpDate = validDateOnly(body.nextFollowUpDate, 'nextFollowUpDate');
  await c.env.DB.prepare(
    `UPDATE defects SET status = ?, assigned_contractor_id = COALESCE(?, assigned_contractor_id),
       due_date = COALESCE(?, due_date), quote_required = COALESCE(?, quote_required),
       next_follow_up_date = COALESCE(?, next_follow_up_date), updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.toStatus,
      optionalString(body.assignedContractorId, 120),
      dueDate,
      body.quoteRequired === undefined ? null : body.quoteRequired ? 1 : 0,
      nextFollowUpDate,
      defect.id,
    )
    .run();

  const change = {
    fromStatus: defect.status,
    toStatus: body.toStatus,
    notes: optionalString(body.notes, 2000),
    assignedContractorId: optionalString(body.assignedContractorId, 120),
    dueDate,
    nextFollowUpDate,
  };
  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'defect',
    entityId: defect.id,
    before: { status: defect.status },
    after: change,
  });
  await captureOperationalForm(c.env.DB, {
    propertyId: defect.property_id,
    formType: 'maintenance_defect',
    entityType: 'defect',
    entityId: defect.id,
    payload: change,
    submittedByUserId: user.id,
    eventType: 'updated',
  });

  return c.json({ id: defect.id, status: body.toStatus });
});

defectRoutes.post('/defects/:id/complete', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{
    workCompletedNotes: string;
    costAmount?: number;
    requiresPermanentFollowup?: boolean;
    nextFollowUpDate?: string;
    evidenceR2Key?: string;
    evidenceContentType?: string;
  }>();
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
  const workCompletedNotes = requiredString(body.workCompletedNotes, 'workCompletedNotes', 3, 5000);
  const nextFollowUpDate = validDateOnly(body.nextFollowUpDate, 'nextFollowUpDate');
  const requiresPermanentFollowup = booleanValue(body.requiresPermanentFollowup);
  await c.env.DB.prepare(
    `UPDATE defects SET status = 'completed', work_completed_notes = ?, cost_amount = ?,
       completion_date = datetime('now'), requires_permanent_followup = ?,
       next_follow_up_date = COALESCE(?, next_follow_up_date), updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(workCompletedNotes, body.costAmount ?? null, requiresPermanentFollowup ? 1 : 0, nextFollowUpDate, defect.id)
    .run();

  const evidenceR2Key = optionalString(body.evidenceR2Key, 500);
  if (evidenceR2Key) {
    await c.env.DB.prepare(
      `INSERT INTO defect_evidence (id, defect_id, r2_key, content_type, caption, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, 'Completion evidence', ?)`,
    )
      .bind(newId('evid'), defect.id, evidenceR2Key, optionalString(body.evidenceContentType, 160), user.id)
      .run();
  }

  const completion = {
    workCompletedNotes,
    costAmount: body.costAmount ?? null,
    requiresPermanentFollowup,
    nextFollowUpDate,
    evidenceR2Key,
  };
  await recordAudit(c.env.DB, {
    propertyId: defect.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'defect',
    entityId: defect.id,
    before: { status: defect.status },
    after: { status: 'completed', ...completion },
  });
  await captureOperationalForm(c.env.DB, {
    propertyId: defect.property_id,
    formType: 'maintenance_defect',
    entityType: 'defect',
    entityId: defect.id,
    payload: completion,
    submittedByUserId: user.id,
    eventType: 'completed',
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
  if (!gate.allowed) throw new HttpError(409, 'CLOSE_BLOCKED', gate.reason ?? 'Defect cannot be closed yet.');

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
  await captureOperationalForm(c.env.DB, {
    propertyId: defect.property_id,
    formType: 'maintenance_defect',
    entityType: 'defect',
    entityId: defect.id,
    payload: { status: 'closed' },
    submittedByUserId: user.id,
    eventType: 'completed',
  });

  return c.json({ id: defect.id, status: 'closed' });
});

// Evidence upload metadata. The bytes are stored in R2 through /api/uploads;
// this endpoint links the resulting object key to the property-scoped defect.
defectRoutes.post('/defects/:id/evidence', async (c) => {
  const user = requireCapability(c, 'defect.manage');
  const body = await c.req.json<{ r2Key: string; contentType?: string; caption?: string }>();
  const defect = await c.env.DB.prepare(`SELECT property_id FROM defects WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ property_id: string }>();
  if (!defect) return c.json({ error: { code: 'NOT_FOUND', message: 'Defect not found.' } }, 404);
  assertPropertyAccess(user, defect.property_id);
  const r2Key = requiredString(body.r2Key, 'r2Key', 3, 500);
  if (!r2Key.startsWith(`${defect.property_id}/`) && !r2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Evidence object does not belong to this property.');
  }
  const id = newId('evid');
  await c.env.DB.prepare(
    `INSERT INTO defect_evidence (id, defect_id, r2_key, content_type, caption, uploaded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      c.req.param('id'),
      r2Key,
      optionalString(body.contentType, 160),
      optionalString(body.caption, 500),
      user.id,
    )
    .run();
  return c.json({ id }, 201);
});
