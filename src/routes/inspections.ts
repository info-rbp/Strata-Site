import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { createTask, notifyRole } from '../lib/notify';
import { captureOperationalForm } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  booleanValue,
  validDateOnly,
  resolveIdempotencyKey,
} from '../lib/operationalInput';
import { INSPECTION_TYPES, RISK_LEVELS, isOptionValue } from '../domain/operationalForms';

export const inspectionRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

inspectionRoutes.get('/inspection-templates', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT t.*, COUNT(cp.id) as checkpointCount
             FROM inspection_templates t
             LEFT JOIN inspection_checkpoints cp ON cp.template_id = t.id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND t.property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` GROUP BY t.id ORDER BY t.name`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

inspectionRoutes.get('/inspection-templates/:id/checkpoints', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const template = await c.env.DB.prepare(`SELECT property_id as propertyId FROM inspection_templates WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ propertyId: string }>();
  if (!template) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found.' } }, 404);
  assertPropertyAccess(user, template.propertyId);
  const { results } = await c.env.DB.prepare(
    `SELECT cp.*, l.name as locationName, l.level_label as levelLabel
     FROM inspection_checkpoints cp
     LEFT JOIN locations l ON l.id = cp.location_id
     WHERE cp.template_id = ? ORDER BY cp.sequence_no`,
  )
    .bind(c.req.param('id'))
    .all();
  return c.json(results ?? []);
});

inspectionRoutes.get('/inspections', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  const month = c.req.query('month');
  let sql = `SELECT i.*, t.name as templateName, l.name as locationName
             FROM inspections i
             JOIN inspection_templates t ON t.id = i.template_id
             LEFT JOIN locations l ON l.id = i.location_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND i.property_id = ?`;
    binds.push(propertyId);
  }
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'INVALID_MONTH', 'month must use YYYY-MM.');
    sql += ` AND substr(COALESCE(i.finished_at, i.started_at), 1, 7) = ?`;
    binds.push(month);
  }
  sql += ` ORDER BY i.started_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// Start a mobile inspection route run.
inspectionRoutes.post('/inspections', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const body = await c.req.json<{
    templateId: string;
    propertyId?: string;
    inspectionType?: string;
    locationId?: string;
    buildingId?: string;
    levelLabel?: string;
    specificLocation?: string;
    notes?: string;
  }>();
  const templateId = requiredString(body.templateId, 'templateId', 1, 120);
  const template = await c.env.DB.prepare(`SELECT * FROM inspection_templates WHERE id = ?`)
    .bind(templateId)
    .first<{ id: string; property_id: string }>();
  if (!template) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found.' } }, 404);
  assertPropertyAccess(user, template.property_id);
  if (body.propertyId && body.propertyId !== template.property_id) {
    throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', 'Template does not belong to the selected property.');
  }
  const inspectionType = body.inspectionType ?? 'common_area';
  if (!isOptionValue(INSPECTION_TYPES, inspectionType)) {
    throw new HttpError(400, 'INVALID_INSPECTION_TYPE', 'Unknown inspection type.');
  }
  const locationId = optionalString(body.locationId, 120);
  const buildingId = optionalString(body.buildingId, 120);
  if (locationId) {
    const location = await c.env.DB.prepare(`SELECT id FROM locations WHERE id = ? AND property_id = ?`)
      .bind(locationId, template.property_id)
      .first();
    if (!location) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', 'Location does not belong to this property.');
  }
  if (buildingId) {
    const building = await c.env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND property_id = ?`)
      .bind(buildingId, template.property_id)
      .first();
    if (!building) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', 'Building does not belong to this property.');
  }

  const id = newId('insp');
  await c.env.DB.prepare(
    `INSERT INTO inspections
      (id, property_id, template_id, inspector_user_id, inspection_type,
       location_id, building_id, level_label, specific_location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      template.property_id,
      template.id,
      user.id,
      inspectionType,
      locationId,
      buildingId,
      optionalString(body.levelLabel, 80),
      optionalString(body.specificLocation, 240),
      optionalString(body.notes, 2000),
    )
    .run();
  return c.json({ id, status: 'in_progress', inspectionType }, 201);
});

inspectionRoutes.get('/inspections/:id', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const inspection = await c.env.DB.prepare(
    `SELECT i.*, t.name as templateName, l.name as locationName
     FROM inspections i
     JOIN inspection_templates t ON t.id = i.template_id
     LEFT JOIN locations l ON l.id = i.location_id
     WHERE i.id = ?`,
  )
    .bind(c.req.param('id'))
    .first();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id as string);
  const { results } = await c.env.DB.prepare(
    `SELECT ir.*, cp.label as checkpointLabel, cp.sequence_no as sequenceNo
     FROM inspection_results ir
     JOIN inspection_checkpoints cp ON cp.id = ir.checkpoint_id
     WHERE ir.inspection_id = ? ORDER BY cp.sequence_no`,
  )
    .bind(inspection.id)
    .all();
  const { results: checkpoints } = await c.env.DB.prepare(
    `SELECT cp.*, l.name as locationName
     FROM inspection_checkpoints cp
     LEFT JOIN locations l ON l.id = cp.location_id
     WHERE cp.template_id = ? ORDER BY cp.sequence_no`,
  )
    .bind(inspection.template_id)
    .all();
  return c.json({ inspection, checkpoints: checkpoints ?? [], results: results ?? [] });
});

// Record or replace a single checkpoint result. A failure auto-creates a
// linked defect with the risk, location, immediate action and photo attached.
inspectionRoutes.post('/inspections/:id/results', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const body = await c.req.json<{
    checkpointId: string;
    result: 'pass' | 'fail' | 'not_applicable';
    observation?: string;
    riskLevel?: 'normal' | 'high' | 'immediate_danger';
    immediateAction?: string;
    maintenanceRequired?: boolean;
    followUpDate?: string;
    photoR2Key?: string;
    photoContentType?: string;
  }>();
  const inspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{
      id: string;
      property_id: string;
      template_id: string;
      status: string;
      specific_location: string | null;
    }>();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id);
  if (inspection.status !== 'in_progress') throw new HttpError(409, 'INSPECTION_CLOSED', 'Completed inspections cannot be changed.');
  if (!['pass', 'fail', 'not_applicable'].includes(body.result)) {
    throw new HttpError(400, 'INVALID_RESULT', 'Result must be pass, fail or not_applicable.');
  }

  const checkpoint = await c.env.DB.prepare(
    `SELECT cp.* FROM inspection_checkpoints cp
     WHERE cp.id = ? AND cp.template_id = ?`,
  )
    .bind(body.checkpointId, inspection.template_id)
    .first<{ id: string; location_id: string | null; label: string }>();
  if (!checkpoint) throw new HttpError(400, 'INVALID_CHECKPOINT', 'Checkpoint is not part of this inspection template.');

  const riskLevel = body.riskLevel ?? 'normal';
  if (!isOptionValue(RISK_LEVELS, riskLevel)) throw new HttpError(400, 'INVALID_RISK', 'Unknown risk level.');
  const observation = optionalString(body.observation, 3000);
  if (body.result === 'fail' && !observation) {
    throw new HttpError(400, 'OBSERVATION_REQUIRED', 'Describe the failed checkpoint.');
  }
  const maintenanceRequired = body.result === 'fail' && body.maintenanceRequired !== false;
  const immediateAction = optionalString(body.immediateAction, 2000);
  const followUpDate = validDateOnly(body.followUpDate, 'followUpDate');
  const photoR2Key = optionalString(body.photoR2Key, 500);
  if (photoR2Key && !photoR2Key.startsWith(`${inspection.property_id}/`) && !photoR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Evidence object does not belong to this property.');
  }

  const existingResult = await c.env.DB.prepare(
    `SELECT id, result, defect_id as defectId FROM inspection_results WHERE inspection_id = ? AND checkpoint_id = ?`,
  )
    .bind(inspection.id, checkpoint.id)
    .first<{ id: string; result: string; defectId: string | null }>();

  let defectId: string | null = existingResult?.defectId ?? null;
  if (body.result === 'fail' && !defectId) {
    defectId = newId('defect');
    await c.env.DB.prepare(
      `INSERT INTO defects
        (id, property_id, location_id, category, source, source_inspection_id,
         description, risk_level, priority, immediate_response, status,
         next_follow_up_date, specific_location)
       VALUES (?, ?, ?, 'other', 'inspection', ?, ?, ?, ?, ?, 'bm_assessment', ?, ?)`,
    )
      .bind(
        defectId,
        inspection.property_id,
        checkpoint.location_id,
        inspection.id,
        observation ?? `Inspection checkpoint failed: ${checkpoint.label}`,
        riskLevel,
        riskLevel === 'immediate_danger' ? 'urgent' : riskLevel === 'high' ? 'high' : 'routine',
        immediateAction,
        followUpDate,
        inspection.specific_location,
      )
      .run();
    if (photoR2Key) {
      await c.env.DB.prepare(
        `INSERT INTO defect_evidence (id, defect_id, r2_key, content_type, caption, uploaded_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          newId('evid'),
          defectId,
          photoR2Key,
          optionalString(body.photoContentType, 160),
          `Inspection failure: ${checkpoint.label}`,
          user.id,
        )
        .run();
    }
    if (followUpDate || maintenanceRequired) {
      await createTask(c.env.DB, {
        propertyId: inspection.property_id,
        title: `Inspection exception: ${checkpoint.label}`,
        taskType: 'triage',
        linkedEntityType: 'defect',
        linkedEntityId: defectId,
        dueAt: followUpDate,
        priority: riskLevel === 'normal' ? 'normal' : 'urgent',
        assigneeRole: 'building_manager',
      });
    }
    if (riskLevel === 'high' || riskLevel === 'immediate_danger') {
      await notifyRole(c.env.DB, {
        propertyId: inspection.property_id,
        role: 'strata_manager',
        title: `High-risk inspection exception: ${checkpoint.label}`,
        body: observation ?? undefined,
        linkedEntityType: 'defect',
        linkedEntityId: defectId,
      });
    }
  }

  const resultId = existingResult?.id ?? newId('ires');
  if (existingResult) {
    await c.env.DB.prepare(
      `UPDATE inspection_results
       SET result = ?, observation = ?, photo_r2_key = ?, defect_id = ?,
           risk_level = ?, immediate_action = ?, maintenance_required = ?,
           follow_up_date = ?
       WHERE id = ?`,
    )
      .bind(
        body.result,
        observation,
        photoR2Key,
        body.result === 'fail' ? defectId : null,
        riskLevel,
        immediateAction,
        maintenanceRequired ? 1 : 0,
        followUpDate,
        resultId,
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO inspection_results
        (id, inspection_id, checkpoint_id, result, observation, photo_r2_key,
         defect_id, risk_level, immediate_action, maintenance_required, follow_up_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        resultId,
        inspection.id,
        checkpoint.id,
        body.result,
        observation,
        photoR2Key,
        defectId,
        riskLevel,
        immediateAction,
        maintenanceRequired ? 1 : 0,
        followUpDate,
      )
      .run();
  }

  await c.env.DB.prepare(
    `UPDATE inspections
     SET exceptions_count = (
       SELECT COUNT(*) FROM inspection_results WHERE inspection_id = ? AND result = 'fail'
     ) WHERE id = ?`,
  )
    .bind(inspection.id, inspection.id)
    .run();

  return c.json({ id: resultId, defectId, replaced: Boolean(existingResult) }, existingResult ? 200 : 201);
});

inspectionRoutes.post('/inspections/:id/finish', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const body = await c.req.json<{ notes?: string; clientSubmissionId?: string }>().catch(() => ({}));
  const inspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{
      id: string;
      property_id: string;
      template_id: string;
      status: string;
      inspection_type: string | null;
      location_id: string | null;
      building_id: string | null;
      level_label: string | null;
      specific_location: string | null;
      notes: string | null;
      started_at: string;
    }>();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id);
  if (inspection.status === 'completed') return c.json({ id: inspection.id, status: 'completed', duplicate: true });

  const [checkpointCount, resultCount] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM inspection_checkpoints WHERE template_id = ?`)
      .bind(inspection.template_id)
      .first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM inspection_results WHERE inspection_id = ?`)
      .bind(inspection.id)
      .first<{ count: number }>(),
  ]);
  if (Number(resultCount?.count ?? 0) < Number(checkpointCount?.count ?? 0)) {
    throw new HttpError(
      409,
      'INSPECTION_INCOMPLETE',
      `${Number(checkpointCount?.count ?? 0) - Number(resultCount?.count ?? 0)} checkpoint(s) still require a result.`,
    );
  }

  const finishNotes = optionalString(body.notes, 3000) ?? inspection.notes;
  await c.env.DB.prepare(
    `UPDATE inspections SET status = 'completed', finished_at = datetime('now'), notes = ? WHERE id = ?`,
  )
    .bind(finishNotes, inspection.id)
    .run();

  const completedInspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`)
    .bind(inspection.id)
    .first<Record<string, unknown>>();
  const { results } = await c.env.DB.prepare(
    `SELECT ir.*, cp.label as checkpointLabel, cp.sequence_no as sequenceNo
     FROM inspection_results ir
     JOIN inspection_checkpoints cp ON cp.id = ir.checkpoint_id
     WHERE ir.inspection_id = ? ORDER BY cp.sequence_no`,
  )
    .bind(inspection.id)
    .all<Record<string, unknown>>();
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  await captureOperationalForm(c.env.DB, {
    propertyId: inspection.property_id,
    formType: 'building_inspection',
    entityType: 'inspection',
    entityId: inspection.id,
    payload: {
      inspection: completedInspection ?? inspection,
      results: results ?? [],
    },
    submittedByUserId: user.id,
    clientSubmissionId,
    eventType: 'completed',
  });
  await recordAudit(c.env.DB, {
    propertyId: inspection.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'inspection',
    entityId: inspection.id,
    after: { status: 'completed', resultCount: results?.length ?? 0 },
  });

  return c.json({ id: inspection.id, status: 'completed', exceptionsCount: completedInspection?.exceptions_count ?? 0 });
});
