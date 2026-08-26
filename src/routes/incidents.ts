import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { INCIDENT_CATEGORIES, BYLAW_CATEGORIES, isOptionValue } from '../domain/operationalForms';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { captureOperationalForm, findExistingCapturedEntity } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  booleanValue,
  validDateOnly,
  validIsoDateTime,
  resolveIdempotencyKey,
} from '../lib/operationalInput';

export const incidentRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

async function assertRelatedRecord(
  db: D1Database,
  table: 'locations' | 'units',
  id: string | null,
  propertyId: string,
) {
  if (!id) return;
  const sql = table === 'locations'
    ? `SELECT id FROM locations WHERE id = ? AND property_id = ?`
    : `SELECT id FROM units WHERE id = ? AND property_id = ?`;
  const row = await db.prepare(sql).bind(id, propertyId).first();
  if (!row) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', `${table.slice(0, -1)} does not belong to this property.`);
}

incidentRoutes.get('/incidents', async (c) => {
  const user = requireCapability(c, 'incident.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT i.*, l.name as locationName, u.unit_number as unitNumber
             FROM incidents i
             LEFT JOIN locations l ON l.id = i.location_id
             LEFT JOIN units u ON u.id = i.unit_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND i.property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY CASE i.severity WHEN 'high' THEN 0 ELSE 1 END,
                   COALESCE(i.incident_at, i.created_at) DESC LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// Incident / security form. High severity records alert Strata immediately;
// temporary repairs create a permanent-remediation defect so they cannot be
// forgotten once the emergency is over.
incidentRoutes.post('/incidents', async (c) => {
  const user = requireCapability(c, 'incident.manage');
  const body = await c.req.json<{
    propertyId?: string;
    incidentAt?: string;
    locationId?: string;
    unitId?: string;
    category: string;
    description: string;
    severity?: 'normal' | 'high';
    personInvolved?: string;
    witnesses?: string;
    immediateRisk?: string;
    actionsTaken?: string;
    emergencyServiceContractor?: string;
    damageNotes?: string;
    temporaryRepairNotes?: string;
    cctvAvailable?: boolean;
    cctvReviewed?: boolean;
    cctvTimestamp?: string;
    policeOrSecurityContacted?: boolean;
    externalReference?: string;
    strataNotified?: boolean;
    strataNotifiedAt?: string;
    followUpRequired?: boolean;
    followUpDate?: string;
    resolution?: string;
    evidenceR2Key?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, duplicate: true });
  if (!isOptionValue(INCIDENT_CATEGORIES, body.category)) {
    throw new HttpError(400, 'INVALID_INCIDENT_CATEGORY', 'Unknown incident category.');
  }

  const locationId = optionalString(body.locationId, 120);
  const unitId = optionalString(body.unitId, 120);
  await Promise.all([
    assertRelatedRecord(c.env.DB, 'locations', locationId, propertyId),
    assertRelatedRecord(c.env.DB, 'units', unitId, propertyId),
  ]);
  const severity = body.severity ?? 'normal';
  if (!['normal', 'high'].includes(severity)) throw new HttpError(400, 'INVALID_SEVERITY', 'Severity must be normal or high.');
  const incidentAt = validIsoDateTime(body.incidentAt, 'incidentAt', new Date().toISOString());
  const evidenceR2Key = optionalString(body.evidenceR2Key, 500);
  if (evidenceR2Key && !evidenceR2Key.startsWith(`${propertyId}/`) && !evidenceR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Evidence object does not belong to this property.');
  }
  const followUpRequired = booleanValue(body.followUpRequired) || Boolean(body.temporaryRepairNotes);
  const followUpDate = validDateOnly(body.followUpDate, 'followUpDate');
  const strataNotified = booleanValue(body.strataNotified) || severity === 'high';
  const strataNotifiedAt = strataNotified
    ? body.strataNotifiedAt
      ? validIsoDateTime(body.strataNotifiedAt, 'strataNotifiedAt')
      : new Date().toISOString()
    : null;
  const id = newId('inc');
  const description = requiredString(body.description, 'description', 5, 5000);
  const temporaryRepairNotes = optionalString(body.temporaryRepairNotes, 3000);
  let linkedDefectId: string | null = null;

  if (temporaryRepairNotes) {
    linkedDefectId = newId('defect');
    await c.env.DB.prepare(
      `INSERT INTO defects
        (id, property_id, location_id, unit_id, category, source, source_incident_id,
         description, risk_level, priority, immediate_response, status,
         requires_permanent_followup, next_follow_up_date)
       VALUES (?, ?, ?, ?, ?, 'incident', ?, ?, ?, ?, ?, 'bm_assessment', 1, ?)`,
    )
      .bind(
        linkedDefectId,
        propertyId,
        locationId,
        unitId,
        body.category,
        id,
        `Permanent remediation required following incident: ${description}`,
        severity === 'high' ? 'high' : 'normal',
        severity === 'high' ? 'urgent' : 'routine',
        temporaryRepairNotes,
        followUpDate,
      )
      .run();
    if (evidenceR2Key) {
      await c.env.DB.prepare(
        `INSERT INTO defect_evidence (id, defect_id, r2_key, caption, uploaded_by_user_id)
         VALUES (?, ?, ?, 'Incident evidence', ?)`,
      )
        .bind(newId('evid'), linkedDefectId, evidenceR2Key, user.id)
        .run();
    }
  }

  const normalized = {
    propertyId,
    incidentAt,
    locationId,
    unitId,
    category: body.category,
    description,
    severity,
    personInvolved: optionalString(body.personInvolved, 300),
    witnesses: optionalString(body.witnesses, 1000),
    immediateRisk: optionalString(body.immediateRisk, 2000),
    actionsTaken: optionalString(body.actionsTaken, 3000),
    emergencyServiceContractor: optionalString(body.emergencyServiceContractor, 300),
    damageNotes: optionalString(body.damageNotes, 3000),
    temporaryRepairNotes,
    cctvAvailable: booleanValue(body.cctvAvailable),
    cctvReviewed: booleanValue(body.cctvReviewed),
    cctvTimestamp: optionalString(body.cctvTimestamp, 120),
    policeOrSecurityContacted: booleanValue(body.policeOrSecurityContacted),
    externalReference: optionalString(body.externalReference, 300),
    strataNotified,
    strataNotifiedAt,
    followUpRequired,
    followUpDate,
    resolution: optionalString(body.resolution, 3000),
    evidenceR2Key,
    linkedDefectId,
    status: followUpRequired ? 'monitoring' : 'open',
  };

  await c.env.DB.prepare(
    `INSERT INTO incidents
      (id, property_id, location_id, unit_id, category, reported_by_user_id,
       description, severity, immediate_risk, actions_taken,
       emergency_service_contractor, damage_notes, temporary_repair_notes,
       linked_defect_id, status, incident_at, person_involved, witnesses,
       cctv_available, cctv_reviewed, cctv_timestamp,
       police_or_security_contacted, external_reference, strata_notified,
       strata_notified_at, follow_up_required, follow_up_date, resolution,
       evidence_r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      locationId,
      unitId,
      body.category,
      user.id,
      description,
      severity,
      normalized.immediateRisk,
      normalized.actionsTaken,
      normalized.emergencyServiceContractor,
      normalized.damageNotes,
      temporaryRepairNotes,
      linkedDefectId,
      normalized.status,
      incidentAt,
      normalized.personInvolved,
      normalized.witnesses,
      normalized.cctvAvailable ? 1 : 0,
      normalized.cctvReviewed ? 1 : 0,
      normalized.cctvTimestamp,
      normalized.policeOrSecurityContacted ? 1 : 0,
      normalized.externalReference,
      strataNotified ? 1 : 0,
      strataNotifiedAt,
      followUpRequired ? 1 : 0,
      followUpDate,
      normalized.resolution,
      evidenceR2Key,
    )
    .run();

  if (followUpRequired) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Incident follow-up: ${description.slice(0, 100)}`,
      taskType: 'triage',
      linkedEntityType: 'incident',
      linkedEntityId: id,
      dueAt: followUpDate,
      priority: severity === 'high' ? 'urgent' : 'normal',
      assigneeRole: 'building_manager',
    });
  }
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'incident',
    entityType: 'incident',
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
    entityType: 'incident',
    entityId: id,
    after: normalized,
  });

  if (severity === 'high') {
    for (const role of ['strata_manager', 'building_manager']) {
      await notifyRole(c.env.DB, {
        propertyId,
        role,
        title: `HIGH SEVERITY incident: ${body.category.replace(/_/g, ' ')}`,
        body: description.slice(0, 180),
        linkedEntityType: 'incident',
        linkedEntityId: id,
      });
    }
  }
  return c.json({ id, linkedDefectId, status: normalized.status, duplicate: false }, 201);
});

incidentRoutes.post('/incidents/:id/close', async (c) => {
  const user = requireCapability(c, 'incident.manage');
  const body = await c.req.json<{ resolution: string }>();
  const incident = await c.env.DB.prepare(`SELECT * FROM incidents WHERE id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!incident) return c.json({ error: { code: 'NOT_FOUND', message: 'Incident not found.' } }, 404);
  const propertyId = String(incident.property_id);
  assertPropertyAccess(user, propertyId);
  const resolution = requiredString(body.resolution, 'resolution', 3, 5000);
  await c.env.DB.prepare(
    `UPDATE incidents SET status = 'closed', resolution = ?, follow_up_required = 0 WHERE id = ?`,
  )
    .bind(resolution, incident.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'incident',
    entityId: String(incident.id),
    after: { status: 'closed', resolution },
  });
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'incident',
    entityType: 'incident',
    entityId: String(incident.id),
    payload: { status: 'closed', resolution },
    submittedByUserId: user.id,
    eventType: 'completed',
  });
  return c.json({ id: incident.id, status: 'closed' });
});

// --- Objective by-law observations; Strata makes the governance decision. --

incidentRoutes.get('/bylaw-observations', async (c) => {
  const user = requireCapability(c, 'bylaw.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT b.*, l.name as locationName, u.unit_number as unitNumber
             FROM bylaw_observations b
             LEFT JOIN locations l ON l.id = b.location_id
             LEFT JOIN units u ON u.id = b.unit_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND b.property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY COALESCE(b.occurred_at, b.created_at) DESC LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

incidentRoutes.post('/bylaw-observations', async (c) => {
  const user = requireCapability(c, 'bylaw.create');
  const body = await c.req.json<{
    propertyId?: string;
    locationId?: string;
    unitId?: string;
    occurredAt?: string;
    category: string;
    observation: string;
    actionTaken?: string;
    evidenceR2Key?: string;
    followUpDate?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, strataOutcome: 'pending', duplicate: true });
  if (!isOptionValue(BYLAW_CATEGORIES, body.category)) {
    throw new HttpError(400, 'INVALID_BYLAW_CATEGORY', 'Unknown by-law category.');
  }

  const locationId = optionalString(body.locationId, 120);
  const unitId = optionalString(body.unitId, 120);
  await Promise.all([
    assertRelatedRecord(c.env.DB, 'locations', locationId, propertyId),
    assertRelatedRecord(c.env.DB, 'units', unitId, propertyId),
  ]);
  const occurredAt = validIsoDateTime(body.occurredAt, 'occurredAt', new Date().toISOString());
  const evidenceR2Key = optionalString(body.evidenceR2Key, 500);
  if (evidenceR2Key && !evidenceR2Key.startsWith(`${propertyId}/`) && !evidenceR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Evidence object does not belong to this property.');
  }
  const id = newId('bylaw');
  const normalized = {
    propertyId,
    locationId,
    unitId,
    occurredAt,
    category: body.category,
    observation: requiredString(body.observation, 'observation', 5, 5000),
    actionTaken: optionalString(body.actionTaken, 2000),
    evidenceR2Key,
    followUpDate: validDateOnly(body.followUpDate, 'followUpDate'),
    strataOutcome: 'pending',
  };
  await c.env.DB.prepare(
    `INSERT INTO bylaw_observations
      (id, property_id, unit_id, location_id, category, observation,
       observed_by_user_id, occurred_at, action_taken, evidence_r2_key, follow_up_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      unitId,
      locationId,
      body.category,
      normalized.observation,
      user.id,
      occurredAt,
      normalized.actionTaken,
      evidenceR2Key,
      normalized.followUpDate,
    )
    .run();

  if (normalized.followUpDate) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Review by-law observation: ${body.category.replace(/_/g, ' ')}`,
      taskType: 'approval_followup',
      linkedEntityType: 'bylaw_observation',
      linkedEntityId: id,
      dueAt: normalized.followUpDate,
      assigneeRole: 'strata_manager',
    });
  }
  await notifyRole(c.env.DB, {
    propertyId,
    role: 'strata_manager',
    title: `By-law observation recorded: ${body.category.replace(/_/g, ' ')}`,
    linkedEntityType: 'bylaw_observation',
    linkedEntityId: id,
  });
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'bylaw_observation',
    entityType: 'bylaw_observation',
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
    entityType: 'bylaw_observation',
    entityId: id,
    after: normalized,
  });
  return c.json({ id, strataOutcome: 'pending', duplicate: false }, 201);
});

incidentRoutes.post('/bylaw-observations/:id/decide', async (c) => {
  const user = requireCapability(c, 'bylaw.decide');
  const body = await c.req.json<{
    outcome: 'information_only' | 'resident_contact' | 'formal_breach_action' | 'no_action' | 'monitor';
  }>();
  const allowedOutcomes = ['information_only', 'resident_contact', 'formal_breach_action', 'no_action', 'monitor'];
  if (!allowedOutcomes.includes(body.outcome)) throw new HttpError(400, 'INVALID_OUTCOME', 'Unknown by-law outcome.');
  const observation = await c.env.DB.prepare(`SELECT * FROM bylaw_observations WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!observation) return c.json({ error: { code: 'NOT_FOUND', message: 'Observation not found.' } }, 404);
  const propertyId = String(observation.property_id);
  assertPropertyAccess(user, propertyId);
  await c.env.DB.prepare(
    `UPDATE bylaw_observations
     SET strata_outcome = ?, strata_decided_by_user_id = ?, strata_decided_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(body.outcome, user.id, observation.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'bylaw_observation',
    entityId: String(observation.id),
    after: { outcome: body.outcome },
  });
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'bylaw_observation',
    entityType: 'bylaw_observation',
    entityId: String(observation.id),
    payload: { outcome: body.outcome },
    submittedByUserId: user.id,
    eventType: 'completed',
  });
  return c.json({ id: observation.id, outcome: body.outcome });
});
