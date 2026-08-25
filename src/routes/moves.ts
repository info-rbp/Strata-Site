import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { canTransitionMove, canCloseMove, type MoveStatus } from '../domain/workflow';

export const moveRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

moveRoutes.get('/moves', async (c) => {
  const user = requireCapability(c, 'move.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT m.*, u.unit_number as unitNumber FROM move_bookings m LEFT JOIN units u ON u.id = m.unit_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND m.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND m.requested_by_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY m.requested_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

moveRoutes.get('/moves/:id', async (c) => {
  const user = requireCapability(c, 'move.read');
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, move.property_id as string);
  if (user.role === 'resident' && move.requested_by_person_id !== user.personId) {
    throw new HttpError(403, 'FORBIDDEN', 'Not your booking.');
  }
  return c.json(move);
});

// Resident submits move/delivery booking (Section 5.3).
moveRoutes.post('/moves', async (c) => {
  const user = requireCapability(c, 'move.create');
  const body = await c.req.json<{
    unitId: string;
    propertyId?: string;
    moveType: 'move_in' | 'move_out' | 'furniture_delivery' | 'furniture_removal' | 'bulky_item';
    requestedAt: string;
    removalistName?: string;
    vehicleDetails?: string;
    estimatedDurationMinutes?: number;
    rulesAcknowledged: boolean;
  }>();
  if (!body.rulesAcknowledged) {
    throw new HttpError(400, 'RULES_NOT_ACKNOWLEDGED', 'Resident must acknowledge building rules before booking.');
  }
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  const id = newId('move');
  await c.env.DB.prepare(
    `INSERT INTO move_bookings
      (id, property_id, unit_id, requested_by_person_id, move_type, requested_at, removalist_name, vehicle_details, estimated_duration_minutes, rules_acknowledged, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_approval')`,
  )
    .bind(
      id,
      propertyId,
      body.unitId,
      user.personId,
      body.moveType,
      body.requestedAt,
      body.removalistName ?? null,
      body.vehicleDetails ?? null,
      body.estimatedDurationMinutes ?? null,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'move_booking',
    entityId: id,
    after: body,
  });

  await createTask(c.env.DB, {
    propertyId,
    title: `Review move booking: ${body.moveType}`,
    taskType: 'move_setup',
    linkedEntityType: 'move_booking',
    linkedEntityId: id,
    assigneeRole: 'building_manager',
  });

  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `Move booking submitted: ${body.moveType}`,
    linkedEntityType: 'move_booking',
    linkedEntityId: id,
  });

  return c.json({ id, status: 'pending_approval' }, 201);
});

// BM approves/declines. On approval, generate calendar/tasks (Section 5.3).
moveRoutes.post('/moves/:id/decide', async (c) => {
  const user = requireCapability(c, 'move.approve');
  const body = await c.req.json<{ decision: 'approved' | 'declined'; reason?: string }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    unit_id: string;
    move_type: string;
    requested_at: string;
    status: MoveStatus;
  }>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, move.property_id);
  if (!canTransitionMove(move.status, body.decision)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot decide a move in status '${move.status}'.`);
  }

  await c.env.DB.prepare(
    `UPDATE move_bookings SET status = ?, decline_reason = ?, approved_by_user_id = ?, approved_at = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(
      body.decision,
      body.decision === 'declined' ? body.reason ?? null : null,
      body.decision === 'approved' ? user.id : null,
      body.decision === 'approved' ? new Date().toISOString() : null,
      move.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId: move.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'move_booking',
    entityId: move.id,
    after: body,
  });

  if (body.decision === 'approved') {
    await c.env.DB.prepare(
      `INSERT INTO calendar_events (id, property_id, event_type, title, starts_at, linked_entity_type, linked_entity_id)
       VALUES (?, ?, 'move', ?, ?, 'move_booking', ?)`,
    )
      .bind(newId('cal'), move.property_id, `${move.move_type} - unit booking`, move.requested_at, move.id)
      .run();

    for (const [title, type] of [
      ['Lift protection setup', 'move_setup'],
      ['Loading area preparation', 'move_setup'],
      ['Pre-move inspection', 'inspection'],
      ['Post-move inspection', 'inspection'],
    ] as const) {
      await createTask(c.env.DB, {
        propertyId: move.property_id,
        title,
        taskType: type,
        linkedEntityType: 'move_booking',
        linkedEntityId: move.id,
        assigneeRole: 'building_manager',
      });
    }
  }

  return c.json({ id: move.id, status: body.decision });
});

moveRoutes.post('/moves/:id/transition', async (c) => {
  const user = requireCapability(c, 'move.manage');
  const body = await c.req.json<{ toStatus: MoveStatus }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: MoveStatus;
  }>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, move.property_id);
  if (!canTransitionMove(move.status, body.toStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move booking from '${move.status}' to '${body.toStatus}'.`);
  }
  await c.env.DB.prepare(`UPDATE move_bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.toStatus, move.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: move.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'move_booking',
    entityId: move.id,
    before: { status: move.status },
    after: { status: body.toStatus },
  });
  return c.json({ id: move.id, status: body.toStatus });
});

// Record inspection findings; if damage found, auto-create linked defect.
moveRoutes.post('/moves/:id/inspection', async (c) => {
  const user = requireCapability(c, 'move.manage');
  const body = await c.req.json<{ stage: 'pre_move' | 'post_move'; notes: string; damageFound?: boolean; damageDescription?: string }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    unit_id: string;
  }>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, move.property_id);

  const column = body.stage === 'pre_move' ? 'pre_move_inspection_notes' : 'post_move_inspection_notes';
  let damageDefectId: string | null = null;
  if (body.damageFound) {
    damageDefectId = newId('defect');
    await c.env.DB.prepare(
      `INSERT INTO defects (id, property_id, unit_id, category, source, description, risk_level, status)
       VALUES (?, ?, ?, 'damage', 'incident', ?, 'normal', 'bm_assessment')`,
    )
      .bind(damageDefectId, move.property_id, move.unit_id, body.damageDescription ?? 'Damage identified during move inspection.')
      .run();
  }

  await c.env.DB.prepare(
    `UPDATE move_bookings SET ${column} = ?, damage_defect_id = COALESCE(?, damage_defect_id), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.notes, damageDefectId, move.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: move.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'move_booking',
    entityId: move.id,
    after: { stage: body.stage, damageFound: body.damageFound },
  });

  return c.json({ id: move.id, damageDefectId });
});

moveRoutes.post('/moves/:id/close', async (c) => {
  const user = requireCapability(c, 'move.manage');
  const body = await c.req.json<{ keysReturned: boolean }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    status: MoveStatus;
    post_move_inspection_notes: string | null;
  }>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, move.property_id);

  if (body.keysReturned) {
    await c.env.DB.prepare(`UPDATE move_bookings SET keys_returned = 1 WHERE id = ?`).bind(move.id).run();
  }

  const gate = canCloseMove({
    status: move.status,
    keysReturned: body.keysReturned,
    hasPostMoveInspection: Boolean(move.post_move_inspection_notes),
  });
  if (!gate.allowed) {
    throw new HttpError(409, 'CLOSE_BLOCKED', gate.reason ?? 'Move cannot be closed yet.');
  }

  await c.env.DB.prepare(`UPDATE move_bookings SET status = 'closed', closed_at = datetime('now') WHERE id = ?`)
    .bind(move.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: move.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'move_booking',
    entityId: move.id,
    after: { status: 'closed' },
  });

  return c.json({ id: move.id, status: 'closed' });
});
