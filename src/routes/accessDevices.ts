import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { canTransitionAccessDeviceRequest, type AccessDeviceRequestStatus } from '../domain/workflow';

export const accessDeviceRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

accessDeviceRoutes.get('/access-device-requests', async (c) => {
  const user = requireCapability(c, 'accessdevice.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT r.*, u.unit_number as unitNumber FROM access_device_requests r LEFT JOIN units u ON u.id = r.unit_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND r.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'resident') {
    sql += ` AND r.requested_by_person_id = ?`;
    binds.push(user.personId);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// Resident requests replacement/additional fob (Section 5.5).
accessDeviceRoutes.post('/access-device-requests', async (c) => {
  const user = requireCapability(c, 'accessdevice.request');
  const body = await c.req.json<{
    unitId: string;
    propertyId?: string;
    requestType: 'replacement_fob' | 'additional_fob' | 'remote' | 'swipe' | 'physical_key' | 'lost_stolen';
    requesterRole?: 'owner' | 'tenant' | 'authorised_agent';
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  // Tenant requests trigger an owner-authorisation workflow.
  const needsOwnerAuth = body.requesterRole === 'tenant';
  const id = newId('adr');
  await c.env.DB.prepare(
    `INSERT INTO access_device_requests
      (id, property_id, unit_id, requested_by_person_id, request_type, requester_role, owner_authorisation_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      body.unitId,
      user.personId,
      body.requestType,
      body.requesterRole ?? null,
      needsOwnerAuth ? 'pending' : 'not_required',
      needsOwnerAuth ? 'awaiting_authorisation' : 'submitted',
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'access_device_request',
    entityId: id,
    after: body,
  });

  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `Access device request: ${body.requestType}`,
    linkedEntityType: 'access_device_request',
    linkedEntityId: id,
  });

  if (body.requestType === 'lost_stolen') {
    await createTask(c.env.DB, {
      propertyId,
      title: 'Deactivate lost/stolen access device',
      taskType: 'other',
      linkedEntityType: 'access_device_request',
      linkedEntityId: id,
      priority: 'urgent',
      assigneeRole: 'building_manager',
    });
  }

  return c.json({ id, status: needsOwnerAuth ? 'awaiting_authorisation' : 'submitted' }, 201);
});

accessDeviceRoutes.post('/access-device-requests/:id/transition', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{ toStatus: AccessDeviceRequestStatus; paymentReference?: string; collectionAppointmentAt?: string }>();
  const req = await c.env.DB.prepare(`SELECT * FROM access_device_requests WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; status: AccessDeviceRequestStatus }>();
  if (!req) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  assertPropertyAccess(user, req.property_id);
  if (!canTransitionAccessDeviceRequest(req.status, body.toStatus)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move request from '${req.status}' to '${body.toStatus}'.`);
  }
  await c.env.DB.prepare(
    `UPDATE access_device_requests SET status = ?, payment_reference = COALESCE(?, payment_reference),
       collection_appointment_at = COALESCE(?, collection_appointment_at), updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.toStatus, body.paymentReference ?? null, body.collectionAppointmentAt ?? null, req.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: req.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'access_device_request',
    entityId: req.id,
    before: { status: req.status },
    after: { status: body.toStatus },
  });

  if (body.toStatus === 'ready_for_collection') {
    // notify the requesting resident directly
    const reqRow = await c.env.DB.prepare(`SELECT requested_by_person_id FROM access_device_requests WHERE id = ?`)
      .bind(req.id)
      .first<{ requested_by_person_id: string }>();
    if (reqRow) {
      const residentUser = await c.env.DB.prepare(`SELECT id FROM users WHERE person_id = ?`)
        .bind(reqRow.requested_by_person_id)
        .first<{ id: string }>();
      if (residentUser) {
        await notifyRole(c.env.DB, {
          propertyId: req.property_id,
          role: 'resident',
          title: 'Your access device is ready for collection',
          linkedEntityType: 'access_device_request',
          linkedEntityId: req.id,
        });
      }
    }
  }

  return c.json({ id: req.id, status: body.toStatus });
});

// At collection, BM records ID check, collector, serial and issue date —
// this creates/updates the Access Device Register entry (Section 5.5, 10).
accessDeviceRoutes.post('/access-device-requests/:id/issue', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{
    serialNumber: string;
    deviceType: 'fob' | 'swipe' | 'remote' | 'key' | 'other';
    collectedBy: string;
    idCheckNotes?: string;
  }>();
  const req = await c.env.DB.prepare(`SELECT * FROM access_device_requests WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; unit_id: string; requested_by_person_id: string; status: AccessDeviceRequestStatus }>();
  if (!req) return c.json({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, 404);
  assertPropertyAccess(user, req.property_id);
  if (!canTransitionAccessDeviceRequest(req.status, 'issued')) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Request must be ready_for_collection before issuing (currently '${req.status}').`);
  }

  const deviceId = newId('dev');
  await c.env.DB.prepare(
    `INSERT INTO access_devices
      (id, property_id, request_id, serial_number, device_type, unit_id, assigned_person_id, status, id_check_notes, collected_by, issue_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))`,
  )
    .bind(deviceId, req.property_id, req.id, body.serialNumber, body.deviceType, req.unit_id, req.requested_by_person_id, body.idCheckNotes ?? null, body.collectedBy)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO access_device_history (id, access_device_id, event_type, notes, actor_user_id) VALUES (?, ?, 'issued', ?, ?)`,
  )
    .bind(newId('devh'), deviceId, `Collected by ${body.collectedBy}`, user.id)
    .run();

  await c.env.DB.prepare(`UPDATE access_device_requests SET status = 'issued', updated_at = datetime('now') WHERE id = ?`)
    .bind(req.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: req.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'issue',
    entityType: 'access_device',
    entityId: deviceId,
    after: body,
  });

  return c.json({ deviceId, status: 'active' }, 201);
});

accessDeviceRoutes.get('/access-devices', async (c) => {
  const user = requireCapability(c, 'accessdevice.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
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
  sql += ` ORDER BY d.created_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

accessDeviceRoutes.post('/access-devices/:id/report-lost', async (c) => {
  const user = requireCapability(c, 'accessdevice.manage');
  const body = await c.req.json<{ status: 'lost' | 'stolen' }>();
  const device = await c.env.DB.prepare(`SELECT * FROM access_devices WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!device) return c.json({ error: { code: 'NOT_FOUND', message: 'Device not found.' } }, 404);
  assertPropertyAccess(user, device.property_id);
  await c.env.DB.prepare(`UPDATE access_devices SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(body.status, device.id)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO access_device_history (id, access_device_id, event_type, notes, actor_user_id) VALUES (?, ?, 'deactivated', ?, ?)`,
  )
    .bind(newId('devh'), device.id, `Reported ${body.status}`, user.id)
    .run();

  await createTask(c.env.DB, {
    propertyId: device.property_id,
    title: `Deactivate ${body.status} access device`,
    taskType: 'other',
    linkedEntityType: 'access_device',
    linkedEntityId: device.id,
    priority: 'urgent',
    assigneeRole: 'building_manager',
  });

  await notifyRole(c.env.DB, {
    propertyId: device.property_id,
    role: 'strata_manager',
    title: `Access device reported ${body.status}`,
    linkedEntityType: 'access_device',
    linkedEntityId: device.id,
  });

  await recordAudit(c.env.DB, {
    propertyId: device.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'access_device',
    entityId: device.id,
    after: { status: body.status },
  });

  return c.json({ id: device.id, status: body.status });
});
