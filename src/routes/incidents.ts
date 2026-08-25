import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole } from '../lib/notify';

export const incidentRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

incidentRoutes.get('/incidents', async (c) => {
  const user = requireCapability(c, 'incident.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM incidents WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// Section 13.1: high-severity incident creates immediate alert + escalation,
// and a temporary emergency repair automatically creates a permanent defect.
incidentRoutes.post('/incidents', async (c) => {
  const user = requireCapability(c, 'incident.manage');
  const body = await c.req.json<{
    propertyId?: string;
    locationId?: string;
    category: string;
    description: string;
    severity?: 'normal' | 'high';
    immediateRisk?: string;
    actionsTaken?: string;
    emergencyServiceContractor?: string;
    damageNotes?: string;
    temporaryRepairNotes?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  const id = newId('inc');
  let linkedDefectId: string | null = null;
  if (body.temporaryRepairNotes) {
    linkedDefectId = newId('defect');
    await c.env.DB.prepare(
      `INSERT INTO defects (id, property_id, location_id, category, source, source_incident_id, description, risk_level, status, requires_permanent_followup)
       VALUES (?, ?, ?, ?, 'incident', ?, ?, ?, 'bm_assessment', 1)`,
    )
      .bind(
        linkedDefectId,
        propertyId,
        body.locationId ?? null,
        body.category,
        id,
        `Permanent remediation required following incident: ${body.description}`,
        body.severity === 'high' ? 'high' : 'normal',
      )
      .run();
  }

  await c.env.DB.prepare(
    `INSERT INTO incidents
      (id, property_id, location_id, category, reported_by_user_id, description, severity, immediate_risk, actions_taken, emergency_service_contractor, damage_notes, temporary_repair_notes, linked_defect_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      body.locationId ?? null,
      body.category,
      user.id,
      body.description,
      body.severity ?? 'normal',
      body.immediateRisk ?? null,
      body.actionsTaken ?? null,
      body.emergencyServiceContractor ?? null,
      body.damageNotes ?? null,
      body.temporaryRepairNotes ?? null,
      linkedDefectId,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'incident',
    entityId: id,
    after: body,
  });

  if (body.severity === 'high') {
    await notifyRole(c.env.DB, {
      propertyId,
      role: 'strata_manager',
      title: `HIGH SEVERITY incident: ${body.category}`,
      body: body.description.slice(0, 140),
      linkedEntityType: 'incident',
      linkedEntityId: id,
    });
    await notifyRole(c.env.DB, {
      propertyId,
      role: 'building_manager',
      title: `HIGH SEVERITY incident: ${body.category}`,
      body: body.description.slice(0, 140),
      linkedEntityType: 'incident',
      linkedEntityId: id,
    });
  }

  return c.json({ id, linkedDefectId }, 201);
});

incidentRoutes.post('/incidents/:id/close', async (c) => {
  const user = requireCapability(c, 'incident.manage');
  const incident = await c.env.DB.prepare(`SELECT * FROM incidents WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!incident) return c.json({ error: { code: 'NOT_FOUND', message: 'Incident not found.' } }, 404);
  assertPropertyAccess(user, incident.property_id);
  await c.env.DB.prepare(`UPDATE incidents SET status = 'closed' WHERE id = ?`).bind(incident.id).run();
  await recordAudit(c.env.DB, {
    propertyId: incident.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'incident',
    entityId: incident.id,
    after: { status: 'closed' },
  });
  return c.json({ id: incident.id, status: 'closed' });
});

// --- By-law observations (Section 13.2) --------------------------------

incidentRoutes.get('/bylaw-observations', async (c) => {
  const user = requireCapability(c, 'bylaw.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM bylaw_observations WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

incidentRoutes.post('/bylaw-observations', async (c) => {
  const user = requireCapability(c, 'bylaw.create');
  const body = await c.req.json<{ propertyId?: string; unitId?: string; category: string; observation: string }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const id = newId('bylaw');
  await c.env.DB.prepare(
    `INSERT INTO bylaw_observations (id, property_id, unit_id, category, observation, observed_by_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, propertyId, body.unitId ?? null, body.category, body.observation, user.id)
    .run();

  await notifyRole(c.env.DB, {
    propertyId,
    role: 'strata_manager',
    title: `By-law observation recorded: ${body.category}`,
    linkedEntityType: 'bylaw_observation',
    linkedEntityId: id,
  });

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'bylaw_observation',
    entityId: id,
    after: body,
  });

  return c.json({ id, strataOutcome: 'pending' }, 201);
});

// Strata records governance decision — kept separate from the operational
// observation (Section 13.2 principle).
incidentRoutes.post('/bylaw-observations/:id/decide', async (c) => {
  const user = requireCapability(c, 'bylaw.decide');
  const body = await c.req.json<{
    outcome: 'information_only' | 'resident_contact' | 'formal_breach_action' | 'no_action' | 'monitor';
  }>();
  const observation = await c.env.DB.prepare(`SELECT * FROM bylaw_observations WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string }>();
  if (!observation) return c.json({ error: { code: 'NOT_FOUND', message: 'Observation not found.' } }, 404);
  assertPropertyAccess(user, observation.property_id);
  await c.env.DB.prepare(
    `UPDATE bylaw_observations SET strata_outcome = ?, strata_decided_by_user_id = ?, strata_decided_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.outcome, user.id, observation.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: observation.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'bylaw_observation',
    entityId: observation.id,
    after: { outcome: body.outcome },
  });

  return c.json({ id: observation.id, outcome: body.outcome });
});
