import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const inspectionRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

inspectionRoutes.get('/inspection-templates', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM inspection_templates WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

inspectionRoutes.get('/inspection-templates/:id/checkpoints', async (c) => {
  requireCapability(c, 'inspection.read');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM inspection_checkpoints WHERE template_id = ? ORDER BY sequence_no`,
  )
    .bind(c.req.param('id'))
    .all();
  return c.json(results ?? []);
});

// Start a mobile inspection route run (Section 7.1).
inspectionRoutes.post('/inspections', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const body = await c.req.json<{ templateId: string; propertyId?: string }>();
  const template = await c.env.DB.prepare(`SELECT * FROM inspection_templates WHERE id = ?`)
    .bind(body.templateId)
    .first<{ id: string; property_id: string }>();
  if (!template) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found.' } }, 404);
  assertPropertyAccess(user, template.property_id);

  const id = newId('insp');
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, property_id, template_id, inspector_user_id) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, template.property_id, template.id, user.id)
    .run();
  return c.json({ id, status: 'in_progress' }, 201);
});

inspectionRoutes.get('/inspections/:id', async (c) => {
  const user = requireCapability(c, 'inspection.read');
  const inspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`).bind(c.req.param('id')).first();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id as string);
  const { results } = await c.env.DB.prepare(
    `SELECT ir.*, cp.label as checkpointLabel FROM inspection_results ir
     JOIN inspection_checkpoints cp ON cp.id = ir.checkpoint_id
     WHERE ir.inspection_id = ? ORDER BY ir.created_at`,
  )
    .bind(inspection.id)
    .all();
  return c.json({ inspection, results: results ?? [] });
});

// Record a single checkpoint result. A "fail" auto-creates a defect with
// location/photo attached, without re-entry (Section 7.1 / acceptance test).
inspectionRoutes.post('/inspections/:id/results', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const body = await c.req.json<{
    checkpointId: string;
    result: 'pass' | 'fail' | 'not_applicable';
    observation?: string;
    photoR2Key?: string;
  }>();
  const inspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id);

  const checkpoint = await c.env.DB.prepare(`SELECT * FROM inspection_checkpoints WHERE id = ?`)
    .bind(body.checkpointId)
    .first<{ id: string; location_id: string | null; label: string }>();

  let defectId: string | null = null;
  if (body.result === 'fail') {
    defectId = newId('defect');
    await c.env.DB.prepare(
      `INSERT INTO defects (id, property_id, location_id, category, source, source_inspection_id, description, status)
       VALUES (?, ?, ?, 'other', 'inspection', ?, ?, 'bm_assessment')`,
    )
      .bind(
        defectId,
        inspection.property_id,
        checkpoint?.location_id ?? null,
        inspection.id,
        body.observation || `Inspection checkpoint failed: ${checkpoint?.label ?? body.checkpointId}`,
      )
      .run();
    if (body.photoR2Key) {
      await c.env.DB.prepare(
        `INSERT INTO defect_evidence (id, defect_id, r2_key, uploaded_by_user_id) VALUES (?, ?, ?, ?)`,
      )
        .bind(newId('evid'), defectId, body.photoR2Key, user.id)
        .run();
    }
  }

  const id = newId('ires');
  await c.env.DB.prepare(
    `INSERT INTO inspection_results (id, inspection_id, checkpoint_id, result, observation, photo_r2_key, defect_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, inspection.id, body.checkpointId, body.result, body.observation ?? null, body.photoR2Key ?? null, defectId)
    .run();

  if (body.result === 'fail') {
    await c.env.DB.prepare(`UPDATE inspections SET exceptions_count = exceptions_count + 1 WHERE id = ?`)
      .bind(inspection.id)
      .run();
  }

  return c.json({ id, defectId }, 201);
});

inspectionRoutes.post('/inspections/:id/finish', async (c) => {
  const user = requireCapability(c, 'inspection.run');
  const inspection = await c.env.DB.prepare(`SELECT * FROM inspections WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!inspection) return c.json({ error: { code: 'NOT_FOUND', message: 'Inspection not found.' } }, 404);
  assertPropertyAccess(user, inspection.property_id);
  await c.env.DB.prepare(`UPDATE inspections SET status = 'completed', finished_at = datetime('now') WHERE id = ?`)
    .bind(inspection.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: inspection.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'inspection',
    entityId: inspection.id,
    after: { status: 'completed' },
  });

  return c.json({ id: inspection.id, status: 'completed' });
});
