import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { MOVE_ACKNOWLEDGEMENTS, MOVE_TYPES, isOptionValue } from '../domain/operationalForms';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { captureOperationalForm, findExistingCapturedEntity } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  optionalWholeNumber,
  booleanValue,
  validIsoDateTime,
  resolveIdempotencyKey,
} from '../lib/operationalInput';
import { canTransitionMove, canCloseMove, type MoveStatus } from '../domain/workflow';

export const moveRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

function perthDateParts(iso: string): { weekday: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { weekday: value('weekday'), time: `${value('hour')}:${value('minute')}` };
}

async function assertResidentUnitAccess(
  db: D1Database,
  user: { role: string; id: string; personId: string | null },
  unitId: string,
  propertyId: string,
) {
  const unit = await db.prepare(`SELECT id FROM units WHERE id = ? AND property_id = ?`)
    .bind(unitId, propertyId)
    .first();
  if (!unit) throw new HttpError(400, 'UNIT_NOT_FOUND', 'Unit does not belong to the selected property.');
  if (user.role === 'resident') {
    const occupancy = await db.prepare(
      `SELECT id, occupancy_role as occupancyRole
       FROM occupancies
       WHERE unit_id = ? AND is_current = 1 AND (user_id = ? OR person_id = ?)
       LIMIT 1`,
    )
      .bind(unitId, user.id, user.personId)
      .first();
    if (!occupancy) throw new HttpError(403, 'UNIT_ACCESS_DENIED', 'You may only book for your own current unit.');
  }
}

async function loadOperatingSettings(db: D1Database, propertyId: string) {
  return db.prepare(
    `SELECT move_notice_hours as moveNoticeHours,
            move_weekdays_only as moveWeekdaysOnly,
            move_start_time as moveStartTime,
            move_end_time as moveEndTime,
            maximum_vehicle_height_mm as maximumVehicleHeightMm,
            move_access_instructions as moveAccessInstructions
     FROM property_operating_settings WHERE property_id = ?`,
  )
    .bind(propertyId)
    .first<Record<string, unknown>>();
}

moveRoutes.get('/moves', async (c) => {
  const user = requireCapability(c, 'move.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT m.*, u.unit_number as unitNumber
             FROM move_bookings m
             LEFT JOIN units u ON u.id = m.unit_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND m.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND m.requested_by_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY m.requested_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

moveRoutes.get('/moves/:id', async (c) => {
  const user = requireCapability(c, 'move.read');
  const move = await c.env.DB.prepare(
    `SELECT m.*, u.unit_number as unitNumber
     FROM move_bookings m LEFT JOIN units u ON u.id = m.unit_id WHERE m.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  assertPropertyAccess(user, String(move.property_id));
  if (user.role === 'resident' && move.requested_by_person_id !== user.personId) {
    throw new HttpError(403, 'FORBIDDEN', 'Not your booking.');
  }
  return c.json(move);
});

// Resident-facing move / large item booking.
moveRoutes.post('/moves', async (c) => {
  const user = requireCapability(c, 'move.create');
  const body = await c.req.json<{
    unitId: string;
    propertyId?: string;
    moveType: string;
    requestedAt: string;
    estimatedDurationMinutes?: number;
    applicantName?: string;
    applicantRole?: string;
    applicantPhone?: string;
    applicantEmail?: string;
    removalistName?: string;
    removalistContact?: string;
    vehicleType?: string;
    vehicleHeightMm?: number;
    vehicleDetails?: string;
    liftRequired?: boolean;
    liftProtectionRequired?: boolean;
    loadingAreaRequired?: boolean;
    liftKeyRequired?: boolean;
    acknowledgements?: string[];
    rulesAcknowledged?: boolean;
    specialRequirements?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, status: 'pending_approval', duplicate: true });

  if (!isOptionValue(MOVE_TYPES, body.moveType)) throw new HttpError(400, 'INVALID_MOVE_TYPE', 'Unknown move type.');
  const unitId = requiredString(body.unitId, 'unitId', 1, 120);
  await assertResidentUnitAccess(c.env.DB, user, unitId, propertyId);
  const requestedAt = validIsoDateTime(body.requestedAt, 'requestedAt');
  const settings = await loadOperatingSettings(c.env.DB, propertyId);
  const noticeHours = Number(settings?.moveNoticeHours ?? 0);
  if (noticeHours > 0 && new Date(requestedAt).getTime() - Date.now() < noticeHours * 60 * 60 * 1000) {
    throw new HttpError(409, 'INSUFFICIENT_MOVE_NOTICE', `This property requires at least ${noticeHours} hours notice.`);
  }
  const local = perthDateParts(requestedAt);
  if (Boolean(settings?.moveWeekdaysOnly) && ['Sat', 'Sun'].includes(local.weekday)) {
    throw new HttpError(409, 'MOVE_WEEKDAYS_ONLY', 'This property permits moves and bulky-item deliveries on weekdays only.');
  }
  const startTime = optionalString(settings?.moveStartTime, 5);
  const endTime = optionalString(settings?.moveEndTime, 5);
  if (startTime && local.time < startTime) throw new HttpError(409, 'MOVE_OUTSIDE_HOURS', `Bookings must start at or after ${startTime}.`);
  if (endTime && local.time > endTime) throw new HttpError(409, 'MOVE_OUTSIDE_HOURS', `Bookings must start at or before ${endTime}.`);
  const vehicleHeightMm = optionalWholeNumber(body.vehicleHeightMm, 'vehicleHeightMm', 0, 10000);
  const maximumVehicleHeightMm = Number(settings?.maximumVehicleHeightMm ?? 0);
  if (vehicleHeightMm && maximumVehicleHeightMm && vehicleHeightMm > maximumVehicleHeightMm) {
    throw new HttpError(409, 'VEHICLE_TOO_HIGH', `The basement clearance is ${maximumVehicleHeightMm} mm.`);
  }

  const acknowledgements = [...new Set(Array.isArray(body.acknowledgements) ? body.acknowledgements : [])];
  const requiredAcknowledgements = MOVE_ACKNOWLEDGEMENTS.map((item) => item.value);
  const allAcknowledged = requiredAcknowledgements.every((item) => acknowledgements.includes(item));
  if (!allAcknowledged || !booleanValue(body.rulesAcknowledged)) {
    throw new HttpError(400, 'RULES_NOT_ACKNOWLEDGED', 'All move and common-property conditions must be acknowledged.');
  }

  const id = newId('move');
  const normalized = {
    propertyId,
    unitId,
    moveType: body.moveType,
    requestedAt,
    estimatedDurationMinutes: optionalWholeNumber(body.estimatedDurationMinutes, 'estimatedDurationMinutes', 15, 1440),
    applicantName: optionalString(body.applicantName, 200) ?? user.fullName,
    applicantRole: optionalString(body.applicantRole, 80),
    applicantPhone: optionalString(body.applicantPhone, 80),
    applicantEmail: optionalString(body.applicantEmail, 240) ?? user.email,
    removalistName: optionalString(body.removalistName, 240),
    removalistContact: optionalString(body.removalistContact, 200),
    vehicleType: optionalString(body.vehicleType, 160),
    vehicleHeightMm,
    vehicleDetails: optionalString(body.vehicleDetails, 500),
    liftRequired: body.liftRequired === undefined ? true : booleanValue(body.liftRequired),
    liftProtectionRequired: body.liftProtectionRequired === undefined ? true : booleanValue(body.liftProtectionRequired),
    loadingAreaRequired: body.loadingAreaRequired === undefined ? true : booleanValue(body.loadingAreaRequired),
    liftKeyRequired: booleanValue(body.liftKeyRequired),
    acknowledgements,
    specialRequirements: optionalString(body.specialRequirements, 3000),
  };

  await c.env.DB.prepare(
    `INSERT INTO move_bookings
      (id, property_id, unit_id, requested_by_person_id, move_type, requested_at,
       removalist_name, vehicle_details, estimated_duration_minutes, rules_acknowledged,
       status, applicant_name, applicant_role, applicant_phone, applicant_email,
       removalist_contact, vehicle_type, vehicle_height_mm, lift_required,
       lift_protection_required, loading_area_required, lift_key_required,
       conditions_ack_json, special_requirements)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      unitId,
      user.personId,
      body.moveType,
      requestedAt,
      normalized.removalistName,
      normalized.vehicleDetails,
      normalized.estimatedDurationMinutes,
      normalized.applicantName,
      normalized.applicantRole,
      normalized.applicantPhone,
      normalized.applicantEmail,
      normalized.removalistContact,
      normalized.vehicleType,
      vehicleHeightMm,
      normalized.liftRequired ? 1 : 0,
      normalized.liftProtectionRequired ? 1 : 0,
      normalized.loadingAreaRequired ? 1 : 0,
      normalized.liftKeyRequired ? 1 : 0,
      JSON.stringify(acknowledgements),
      normalized.specialRequirements,
    )
    .run();

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'move_booking',
    entityType: 'move_booking',
    entityId: id,
    payload: { ...normalized, operatingRules: settings ?? null },
    submittedByUserId: user.id,
    clientSubmissionId,
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'move_booking',
    entityId: id,
    after: normalized,
  });
  await createTask(c.env.DB, {
    propertyId,
    title: `Review ${body.moveType.replace(/_/g, ' ')} booking`,
    taskType: 'move_setup',
    linkedEntityType: 'move_booking',
    linkedEntityId: id,
    dueAt: requestedAt,
    assigneeRole: 'building_manager',
  });
  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `Move booking submitted: ${body.moveType.replace(/_/g, ' ')}`,
    body: `${normalized.applicantName} - ${requestedAt}`,
    linkedEntityType: 'move_booking',
    linkedEntityId: id,
  });

  return c.json({ id, status: 'pending_approval', duplicate: false }, 201);
});

// BM approves/declines. Approval creates the calendar entry, preparation
// tasks and a pending induction record for move-ins.
moveRoutes.post('/moves/:id/decide', async (c) => {
  const user = requireCapability(c, 'move.approve');
  const body = await c.req.json<{ decision: 'approved' | 'declined'; reason?: string }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  const propertyId = String(move.property_id);
  assertPropertyAccess(user, propertyId);
  if (!canTransitionMove(move.status as MoveStatus, body.decision)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot decide a move in status '${String(move.status)}'.`);
  }
  if (body.decision === 'declined' && !optionalString(body.reason, 2000)) {
    throw new HttpError(400, 'DECLINE_REASON_REQUIRED', 'A reason is required when declining a booking.');
  }

  await c.env.DB.prepare(
    `UPDATE move_bookings
     SET status = ?, decline_reason = ?, approved_by_user_id = ?, approved_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.decision,
      body.decision === 'declined' ? optionalString(body.reason, 2000) : null,
      body.decision === 'approved' ? user.id : null,
      body.decision === 'approved' ? new Date().toISOString() : null,
      move.id,
    )
    .run();

  const decisionPayload = { decision: body.decision, reason: optionalString(body.reason, 2000) };
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'move_booking',
    entityId: String(move.id),
    after: decisionPayload,
  });
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'move_booking',
    entityType: 'move_booking',
    entityId: String(move.id),
    payload: decisionPayload,
    submittedByUserId: user.id,
    eventType: 'updated',
  });

  if (body.decision === 'approved') {
    await c.env.DB.prepare(
      `INSERT INTO calendar_events
        (id, property_id, event_type, title, starts_at, linked_entity_type, linked_entity_id)
       VALUES (?, ?, 'move', ?, ?, 'move_booking', ?)`,
    )
      .bind(newId('cal'), propertyId, `${String(move.move_type).replace(/_/g, ' ')} - Unit booking`, move.requested_at, move.id)
      .run();

    for (const [title, type] of [
      ['Lift protection setup', 'move_setup'],
      ['Loading area preparation', 'move_setup'],
      ['Pre-move inspection', 'inspection'],
      ['Post-move inspection', 'inspection'],
    ] as const) {
      await createTask(c.env.DB, {
        propertyId,
        title,
        taskType: type,
        linkedEntityType: 'move_booking',
        linkedEntityId: String(move.id),
        dueAt: String(move.requested_at),
        assigneeRole: 'building_manager',
      });
    }

    if (move.move_type === 'move_in') {
      const existingOnboarding = await c.env.DB.prepare(`SELECT id FROM resident_onboarding WHERE move_booking_id = ?`)
        .bind(move.id)
        .first();
      if (!existingOnboarding) {
        await c.env.DB.prepare(
          `INSERT INTO resident_onboarding
            (id, move_booking_id, unit_id, modules_ack, rules_ack, status, property_id,
             resident_name, resident_role, move_in_date, updated_at)
           VALUES (?, ?, ?, '[]', 0, 'pending', ?, ?, ?, substr(?, 1, 10), datetime('now'))`,
        )
          .bind(
            newId('onboard'),
            move.id,
            move.unit_id,
            propertyId,
            move.applicant_name ?? null,
            move.applicant_role ?? null,
            move.requested_at,
          )
          .run();
      }
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
  await captureOperationalForm(c.env.DB, {
    propertyId: move.property_id,
    formType: 'move_booking',
    entityType: 'move_booking',
    entityId: move.id,
    payload: { fromStatus: move.status, toStatus: body.toStatus },
    submittedByUserId: user.id,
    eventType: 'updated',
  });
  return c.json({ id: move.id, status: body.toStatus });
});

// Record pre/post common-property findings; damage creates a linked defect.
moveRoutes.post('/moves/:id/inspection', async (c) => {
  const user = requireCapability(c, 'move.manage');
  const body = await c.req.json<{
    stage: 'pre_move' | 'post_move';
    notes: string;
    damageFound?: boolean;
    damageDescription?: string;
    evidenceR2Key?: string;
  }>();
  const move = await c.env.DB.prepare(`SELECT * FROM move_bookings WHERE id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!move) return c.json({ error: { code: 'NOT_FOUND', message: 'Move not found.' } }, 404);
  const propertyId = String(move.property_id);
  assertPropertyAccess(user, propertyId);
  if (!['pre_move', 'post_move'].includes(body.stage)) throw new HttpError(400, 'INVALID_STAGE', 'Unknown inspection stage.');

  const notes = requiredString(body.notes, 'notes', 3, 4000);
  const evidenceR2Key = optionalString(body.evidenceR2Key, 500);
  if (evidenceR2Key && !evidenceR2Key.startsWith(`${propertyId}/`) && !evidenceR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Evidence object does not belong to this property.');
  }
  const column = body.stage === 'pre_move' ? 'pre_move_inspection_notes' : 'post_move_inspection_notes';
  let damageDefectId: string | null = null;
  if (booleanValue(body.damageFound)) {
    damageDefectId = newId('defect');
    const description = optionalString(body.damageDescription, 3000) ?? 'Damage identified during move inspection.';
    await c.env.DB.prepare(
      `INSERT INTO defects
        (id, property_id, unit_id, category, source, description, risk_level,
         priority, status, source_inspection_id)
       VALUES (?, ?, ?, 'damage', 'building_manager', ?, 'normal', 'routine', 'bm_assessment', ?)`,
    )
      .bind(damageDefectId, propertyId, move.unit_id, description, move.id)
      .run();
    if (evidenceR2Key) {
      await c.env.DB.prepare(
        `INSERT INTO defect_evidence (id, defect_id, r2_key, caption, uploaded_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(newId('evid'), damageDefectId, evidenceR2Key, `${body.stage} move inspection`, user.id)
        .run();
    }
  }

  await c.env.DB.prepare(
    `UPDATE move_bookings
     SET ${column} = ?, damage_defect_id = COALESCE(?, damage_defect_id), updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(notes, damageDefectId, move.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'move_booking',
    entityId: String(move.id),
    after: { stage: body.stage, damageFound: booleanValue(body.damageFound), damageDefectId },
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

  if (booleanValue(body.keysReturned)) {
    await c.env.DB.prepare(`UPDATE move_bookings SET keys_returned = 1 WHERE id = ?`).bind(move.id).run();
  }
  const gate = canCloseMove({
    status: move.status,
    keysReturned: booleanValue(body.keysReturned),
    hasPostMoveInspection: Boolean(move.post_move_inspection_notes),
  });
  if (!gate.allowed) throw new HttpError(409, 'CLOSE_BLOCKED', gate.reason ?? 'Move cannot be closed yet.');

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
  await captureOperationalForm(c.env.DB, {
    propertyId: move.property_id,
    formType: 'move_booking',
    entityType: 'move_booking',
    entityId: move.id,
    payload: { status: 'closed', keysReturned: booleanValue(body.keysReturned) },
    submittedByUserId: user.id,
    eventType: 'completed',
  });
  return c.json({ id: move.id, status: 'closed' });
});
