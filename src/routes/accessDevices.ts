import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, notifyUser, createTask } from '../lib/notify';
import { captureOperationalForm, findExistingCapturedEntity } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  optionalWholeNumber,
  booleanValue,
  validDateOnly,
  validIsoDateTime,
  resolveIdempotencyKey,
} from '../lib/operationalInput';
import { canTransitionAccessDeviceRequest, type AccessDeviceRequestStatus } from '../domain/workflow';

export const accessDeviceRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

const REQUEST_TYPES = [
  'replacement_fob',
  'additional_fob',
  'remote',
  'swipe',
  'physical_key',
  'lost_stolen',
] as const;
const DEVICE_TYPES = ['fob', 'swipe', 'remote', 'key', 'other'] as const;

async function assertResidentUnitAccess(
  db: D1Database,
  user: { role: string; id: string; personId: string | null },
  unitId: string,
  propertyId: string,
) {
  const unit = await db.prepare(`SELECT id FROM units WHERE id = ? AND property_id = ?`)
    .bind(unitId, propertyId)
    .first();
  if (!unit) throw new HttpError(400, 'UNIT_NOT_FOUND', 'Unit does not belong to this property.');
  if (user.role === 'resident') {
    const occupancy = await db.prepare(
      `SELECT id FROM occupancies
       WHERE unit_id = ? AND is_current = 1 AND (user_id = ? OR person_id = ?)
       LIMIT 1`,
    )
      .bind(unitId, user.id, user.personId)
      .first();
    if (!occupancy) throw new HttpError(403, 'UNIT_ACCESS_DENIED', 'You may only request devices for your own current unit.');
  }
}

accessDeviceRoutes.get('/access-device-requests', async (c) => {
  const user = requireCapability(c, 'accessdevice.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT r.*, u.unit_number as unitNumber
             FROM access_device_requests r
             LEFT JOIN units u ON u.id = r.unit_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND r.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND r.requested_by_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// Resident-facing security device / restricted key request.
accessDeviceRoutes.post('/access-device-requests', async (c) => {
  const user = requireCapability(c, 'accessdevice.request');
  const body = await c.req.json<{
    unitId: string;
    propertyId?: string;
    requestType: string;
    requesterRole?: 'owner' | 'tenant' | 'authorised_agent';
    applicantName?: string;
    managingAgentName?: string;
    contactPhone?: string;
    contactEmail?: string;
    deviceTypeRequested?: string;
    quantityRequested?: number;
    requestReason?: string;
    ownerAuthorisationR2Key?: string;
    requestedCollectionDate?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, duplicate: true });

  if (!REQUEST_TYPES.includes(body.requestType as (typeof REQUEST_TYPES)[number])) {
    throw new HttpError(400, 'INVALID_REQUEST_TYPE', 'Unknown access device request type.');
  }
  const unitId = requiredString(body.unitId, 'unitId', 1, 120);
  await assertResidentUnitAccess(c.env.DB, user, unitId, propertyId);
  const requesterRole = body.requesterRole ?? 'tenant';
  const ownerAuthorisationR2Key = optionalString(body.ownerAuthorisationR2Key, 500);
  if (ownerAuthorisationR2Key && !ownerAuthorisationR2Key.startsWith(`${propertyId}/`) && !ownerAuthorisationR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Owner authorisation document does not belong to this property.');
  }
  const needsOwnerAuth = requesterRole === 'tenant';
  const quantityRequested = optionalWholeNumber(body.quantityRequested, 'quantityRequested', 1, 10) ?? 1;
  const requestedCollectionDate = validDateOnly(body.requestedCollectionDate, 'requestedCollectionDate');
  const deviceTypeRequested = optionalString(body.deviceTypeRequested, 80)
    ?? (body.requestType === 'remote' ? 'remote'
      : body.requestType === 'swipe' ? 'swipe'
        : body.requestType === 'physical_key' ? 'key' : 'fob');
  if (!DEVICE_TYPES.includes(deviceTypeRequested as (typeof DEVICE_TYPES)[number])) {
    throw new HttpError(400, 'INVALID_DEVICE_TYPE', 'Unknown device type.');
  }

  const id = newId('adr');
  const normalized = {
    propertyId,
    unitId,
    requestType: body.requestType,
    requesterRole,
    applicantName: optionalString(body.applicantName, 200) ?? user.fullName,
    managingAgentName: optionalString(body.managingAgentName, 240),
    contactPhone: optionalString(body.contactPhone, 80),
    contactEmail: optionalString(body.contactEmail, 240) ?? user.email,
    deviceTypeRequested,
    quantityRequested,
    requestReason: optionalString(body.requestReason, 2000),
    ownerAuthorisationR2Key,
    requestedCollectionDate,
    ownerAuthorisationStatus: needsOwnerAuth ? 'pending' : 'not_required',
    status: needsOwnerAuth ? 'awaiting_authorisation' : 'submitted',
  };
  await c.env.DB.prepare(
    `INSERT INTO access_device_requests
      (id, property_id, unit_id, requested_by_person_id, request_type, requester_role,
       owner_authorisation_status, status, applicant_name, managing_agent_name,
       contact_phone, contact_email, device_type_requested, quantity_requested,
       request_reason, owner_authorisation_r2_key, requested_collection_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      unitId,
      user.personId,
      body.requestType,
      requesterRole,
      normalized.ownerAuthorisationStatus,
      normalized.status,
      normalized.applicantName,
      normalized.managingAgentName,
      normalized.contactPhone,
      normalized.contactEmail,
      deviceTypeRequested,
      quantityRequested,
      normalized.requestReason,
      ownerAuthorisationR2Key,
      requestedCollectionDate,
    )
    .run();

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'access_device_request',
    entityType: 'access_device_request',
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
    entityType: 'access_device_request',
    entityId: id,
    after: normalized,
  });
  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `Access device request: ${body.requestType.replace(/_/g, ' ')}`,
    body: `${normalized.applicantName} - quantity ${quantityRequested}`,
    linkedEntityType: 'access_device_request',
    linkedEntityId: id,
  });

  if (body.requestType === 'lost_stolen') {
    await createTask(c.env.DB, {
      propertyId,
      title: 'Deactivate lost or stolen access device',
      taskType: 'other',
      linkedEntityType: 'access_device_request',
      linkedEntityId: id,
      priority: 'urgent',
      assigneeRole: 'building_manager',
    });
  }
  return c.json({ id, status: normalized.status, duplicate: false }, 201);
});

accessDeviceRoutes.post('/access-device-requests/:id/transition', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{
    toStatus: AccessDeviceRequestStatus;
    paymentReference?: string;
    collectionAppointmentAt?: string;
    ownerAuthorisationStatus?: 'pending' | 'approved' | 'declined' | 'not_required';
    internalNotes?: string;
  }>();
  const request = await c.env.DB.prepare(`SELECT * FROM access_device_requests WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!request) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  const propertyId = String(request.property_id);
  assertPropertyAccess(user, propertyId);
  if (!canTransitionAccessDeviceRequest(request.status as AccessDeviceRequestStatus, body.toStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move request from '${String(request.status)}' to '${body.toStatus}'.`);
  }
  if (request.requester_role === 'tenant' && body.toStatus === 'approved' && body.ownerAuthorisationStatus !== 'approved') {
    throw new HttpError(409, 'OWNER_AUTH_REQUIRED', 'Tenant requests require approved written owner authority.');
  }
  const collectionAppointmentAt = body.collectionAppointmentAt
    ? validIsoDateTime(body.collectionAppointmentAt, 'collectionAppointmentAt')
    : null;
  await c.env.DB.prepare(
    `UPDATE access_device_requests
     SET status = ?, payment_reference = COALESCE(?, payment_reference),
         collection_appointment_at = COALESCE(?, collection_appointment_at),
         owner_authorisation_status = COALESCE(?, owner_authorisation_status),
         internal_notes = COALESCE(?, internal_notes), updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      body.toStatus,
      optionalString(body.paymentReference, 240),
      collectionAppointmentAt,
      optionalString(body.ownerAuthorisationStatus, 80),
      optionalString(body.internalNotes, 3000),
      request.id,
    )
    .run();

  const transition = {
    fromStatus: request.status,
    toStatus: body.toStatus,
    paymentReference: optionalString(body.paymentReference, 240),
    collectionAppointmentAt,
    ownerAuthorisationStatus: optionalString(body.ownerAuthorisationStatus, 80),
    internalNotes: optionalString(body.internalNotes, 3000),
  };
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'access_device_request',
    entityId: String(request.id),
    before: { status: request.status },
    after: transition,
  });
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'access_device_request',
    entityType: 'access_device_request',
    entityId: String(request.id),
    payload: transition,
    submittedByUserId: user.id,
    eventType: 'updated',
  });

  if (body.toStatus === 'ready_for_collection' && request.requested_by_person_id) {
    const residentUser = await c.env.DB.prepare(`SELECT id FROM users WHERE person_id = ? AND status = 'active'`)
      .bind(request.requested_by_person_id)
      .first<{ id: string }>();
    if (residentUser) {
      await notifyUser(c.env.DB, {
        userId: residentUser.id,
        propertyId,
        title: 'Your access device is ready for collection',
        body: collectionAppointmentAt ? `Collection appointment: ${collectionAppointmentAt}` : undefined,
        linkedEntityType: 'access_device_request',
        linkedEntityId: String(request.id),
      });
    }
  }
  return c.json({ id: request.id, status: body.toStatus });
});

// BM records programming, serial/key identifiers, identity check and issue.
accessDeviceRoutes.post('/access-device-requests/:id/issue', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{
    serialNumber: string;
    deviceType: 'fob' | 'swipe' | 'remote' | 'key' | 'other';
    systemId?: string;
    keyId?: string;
    programmedAt?: string;
    collectedBy: string;
    idCheckNotes?: string;
    oldDeviceDeactivated?: boolean;
    replacementDeviceId?: string;
    accessProfile?: string;
  }>();
  const request = await c.env.DB.prepare(`SELECT * FROM access_device_requests WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!request) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  const propertyId = String(request.property_id);
  assertPropertyAccess(user, propertyId);
  if (!canTransitionAccessDeviceRequest(request.status as AccessDeviceRequestStatus, 'issued')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Request must be ready_for_collection before issuing (currently '${String(request.status)}').`);
  }
  if (!DEVICE_TYPES.includes(body.deviceType)) throw new HttpError(400, 'INVALID_DEVICE_TYPE', 'Unknown device type.');
  const serialNumber = requiredString(body.serialNumber, 'serialNumber', 1, 240);
  const collectedBy = requiredString(body.collectedBy, 'collectedBy', 2, 240);
  const programmedAt = body.programmedAt
    ? validIsoDateTime(body.programmedAt, 'programmedAt')
    : new Date().toISOString();
  const deviceId = newId('dev');
  const normalized = {
    serialNumber,
    deviceType: body.deviceType,
    systemId: optionalString(body.systemId, 160),
    keyId: optionalString(body.keyId, 160),
    programmedAt,
    collectedBy,
    idCheckNotes: optionalString(body.idCheckNotes, 2000),
    oldDeviceDeactivated: booleanValue(body.oldDeviceDeactivated),
    replacementDeviceId: optionalString(body.replacementDeviceId, 120),
    accessProfile: optionalString(body.accessProfile, 300),
  };

  await c.env.DB.prepare(
    `INSERT INTO access_devices
      (id, property_id, request_id, serial_number, device_type, unit_id,
       assigned_person_id, status, access_profile, id_check_notes, collected_by,
       issue_date, system_id, key_id, programmed_at, programmed_by_user_id,
       activated_at, old_device_deactivated, replacement_device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'), ?, ?)`,
  )
    .bind(
      deviceId,
      propertyId,
      request.id,
      serialNumber,
      body.deviceType,
      request.unit_id,
      request.requested_by_person_id,
      normalized.accessProfile,
      normalized.idCheckNotes,
      collectedBy,
      normalized.systemId,
      normalized.keyId,
      programmedAt,
      user.id,
      normalized.oldDeviceDeactivated ? 1 : 0,
      normalized.replacementDeviceId,
    )
    .run();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO access_device_history
        (id, access_device_id, event_type, notes, actor_user_id)
       VALUES (?, ?, 'issued', ?, ?)`,
    ).bind(newId('devh'), deviceId, `Collected by ${collectedBy}`, user.id),
    c.env.DB.prepare(
      `UPDATE access_device_requests SET status = 'issued', updated_at = datetime('now') WHERE id = ?`,
    ).bind(request.id),
  ]);

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'access_device_issue',
    entityType: 'access_device',
    entityId: deviceId,
    payload: { requestId: request.id, unitId: request.unit_id, ...normalized },
    submittedByUserId: user.id,
    eventType: 'completed',
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'issue',
    entityType: 'access_device',
    entityId: deviceId,
    after: normalized,
  });
  return c.json({ deviceId, status: 'active' }, 201);
});

accessDeviceRoutes.get('/access-devices', async (c) => {
  const user = requireCapability(c, 'accessdevice.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT d.*, u.unit_number as unitNumber, p.full_name as assignedName
             FROM access_devices d
             LEFT JOIN units u ON u.id = d.unit_id
             LEFT JOIN people p ON p.id = d.assigned_person_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND d.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND d.assigned_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY d.created_at DESC LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

accessDeviceRoutes.post('/access-devices/:id/report-lost', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{ status: 'lost' | 'stolen' }>();
  if (!['lost', 'stolen'].includes(body.status)) throw new HttpError(400, 'INVALID_STATUS', 'Status must be lost or stolen.');
  const device = await c.env.DB.prepare(`SELECT * FROM access_devices WHERE id = ?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!device) return c.json({ error: { code: 'NOT_FOUND', message: 'Device not found.' } }, 404);
  const propertyId = String(device.property_id);
  assertPropertyAccess(user, propertyId);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE access_devices SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(body.status, device.id),
    c.env.DB.prepare(
      `INSERT INTO access_device_history
        (id, access_device_id, event_type, notes, actor_user_id)
       VALUES (?, ?, 'deactivated', ?, ?)`,
    ).bind(newId('devh'), device.id, `Reported ${body.status}`, user.id),
  ]);
  await createTask(c.env.DB, {
    propertyId,
    title: `Deactivate ${body.status} access device`,
    taskType: 'other',
    linkedEntityType: 'access_device',
    linkedEntityId: String(device.id),
    priority: 'urgent',
    assigneeRole: 'building_manager',
  });
  await notifyRole(c.env.DB, {
    propertyId,
    role: 'strata_manager',
    title: `Access device reported ${body.status}`,
    linkedEntityType: 'access_device',
    linkedEntityId: String(device.id),
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'access_device',
    entityId: String(device.id),
    after: { status: body.status },
  });
  return c.json({ id: device.id, status: body.status });
});
