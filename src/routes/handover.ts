import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const handoverRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Section 19.2: compile open items and create a time-limited relief BM
// handover with an orientation checklist.
handoverRoutes.post('/handovers', async (c) => {
  const user = requireCapability(c, 'handover.manage');
  const body = await c.req.json<{ propertyId?: string; incomingUserId: string; accessExpiresAt: string }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const db = c.env.DB;

  const [openDefects, overdueMaintenance, contractorBookings, quotesPending, upcomingMoves, openIncidents] =
    await Promise.all([
      db.prepare(`SELECT id, category, status FROM defects WHERE property_id = ? AND status != 'closed'`).bind(propertyId).all(),
      db
        .prepare(
          `SELECT mp.id, a.name as assetName FROM maintenance_plans mp JOIN assets a ON a.id = mp.asset_id
           WHERE mp.property_id = ? AND mp.next_due_at < datetime('now')`,
        )
        .bind(propertyId)
        .all(),
      db.prepare(`SELECT id, scope, status FROM work_orders WHERE property_id = ? AND status IN ('scheduled','in_progress')`).bind(propertyId).all(),
      db.prepare(`SELECT id, amount FROM quotes WHERE property_id = ? AND status = 'submitted'`).bind(propertyId).all(),
      db.prepare(`SELECT id, move_type as moveType, requested_at as requestedAt FROM move_bookings WHERE property_id = ? AND status IN ('approved','pre_move_setup')`).bind(propertyId).all(),
      db.prepare(`SELECT id, category FROM incidents WHERE property_id = ? AND status != 'closed'`).bind(propertyId).all(),
    ]);

  const snapshot = {
    openDefects: openDefects.results ?? [],
    overdueMaintenance: overdueMaintenance.results ?? [],
    contractorBookings: contractorBookings.results ?? [],
    quotesPending: quotesPending.results ?? [],
    upcomingMoves: upcomingMoves.results ?? [],
    openIncidents: openIncidents.results ?? [],
  };

  const id = newId('ho');
  await db
    .prepare(
      `INSERT INTO handovers (id, property_id, outgoing_user_id, incoming_user_id, access_expires_at, snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, propertyId, user.id, body.incomingUserId, body.accessExpiresAt, JSON.stringify(snapshot))
    .run();

  const defaultChecklist = [
    ['Plant room walkthrough', 'plant_room'],
    ['Roof access and drainage', 'roof'],
    ['Waste areas and bin store', 'waste_area'],
    ['Fire controls and panel location', 'fire_controls'],
    ['Garage and loading area', 'garage'],
  ] as const;
  for (const [label, category] of defaultChecklist) {
    await db
      .prepare(`INSERT INTO handover_checklist_items (id, handover_id, label, category) VALUES (?, ?, ?, ?)`)
      .bind(newId('hoci'), id, label, category)
      .run();
  }
  for (const item of snapshot.openDefects) {
    await db
      .prepare(`INSERT INTO handover_checklist_items (id, handover_id, label, category) VALUES (?, ?, ?, 'open_item')`)
      .bind(newId('hoci'), id, `Open defect: ${(item as { category: string }).category}`)
      .run();
  }

  await db.prepare(`UPDATE users SET access_expires_at = ? WHERE id = ?`).bind(body.accessExpiresAt, body.incomingUserId).run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'handover',
    entityId: id,
    after: { incomingUserId: body.incomingUserId, accessExpiresAt: body.accessExpiresAt },
  });

  return c.json({ id, snapshot }, 201);
});

handoverRoutes.get('/handovers/:id', async (c) => {
  requireCapability(c, 'handover.read');
  const handover = await c.env.DB.prepare(`SELECT * FROM handovers WHERE id = ?`).bind(c.req.param('id')).first();
  if (!handover) return c.json({ error: { code: 'NOT_FOUND', message: 'Handover not found.' } }, 404);
  const { results: checklist } = await c.env.DB.prepare(`SELECT * FROM handover_checklist_items WHERE handover_id = ?`)
    .bind(handover.id)
    .all();
  return c.json({ handover, checklist: checklist ?? [] });
});

handoverRoutes.post('/handovers/:id/checklist/:itemId/acknowledge', async (c) => {
  requireCapability(c, 'handover.manage');
  await c.env.DB.prepare(
    `UPDATE handover_checklist_items SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ? AND handover_id = ?`,
  )
    .bind(c.req.param('itemId'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

handoverRoutes.post('/handovers/:id/complete', async (c) => {
  const user = requireCapability(c, 'handover.manage');
  await c.env.DB.prepare(`UPDATE handovers SET status = 'completed', completed_at = datetime('now') WHERE id = ?`)
    .bind(c.req.param('id'))
    .run();
  await recordAudit(c.env.DB, {
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'handover',
    entityId: c.req.param('id'),
    after: { status: 'completed' },
  });
  return c.json({ ok: true });
});
