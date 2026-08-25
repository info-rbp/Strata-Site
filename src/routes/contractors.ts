import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, requireAuth, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole } from '../lib/notify';
import { canSignOutAttendance } from '../domain/workflow';

export const contractorRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Contractor-portal convenience endpoint: resolves the logged-in contractor
// user to their contractor company record by matching contact_email. Phase 1
// keeps this matching lightweight rather than adding a formal contractor
// login/contractor_id column; Phase 2 can promote this to a real FK once
// contractor self-service accounts are formalised.
contractorRoutes.get('/my-contractor', async (c) => {
  const user = requireAuth(c);
  const row = await c.env.DB.prepare(`SELECT * FROM contractors WHERE contact_email = ?`)
    .bind(user.email)
    .first();
  return c.json(row ?? null);
});

contractorRoutes.get('/contractors', async (c) => {
  requireCapability(c, 'contractor.read');
  const trade = c.req.query('trade');
  let sql = `SELECT * FROM contractors WHERE 1=1`;
  const binds: unknown[] = [];
  if (trade) {
    sql += ` AND trade_category = ?`;
    binds.push(trade);
  }
  sql += ` ORDER BY company_name`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

contractorRoutes.post('/contractors', async (c) => {
  const user = requireCapability(c, 'contractor.manage');
  const body = await c.req.json<{
    companyName: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    tradeCategory: string;
    licenceDetails?: string;
    insuranceExpiry?: string;
    complianceExpiry?: string;
    emergencyContact?: string;
    propertiesCovered?: string[];
  }>();
  const id = newId('ctr');
  await c.env.DB.prepare(
    `INSERT INTO contractors
      (id, company_name, contact_name, contact_phone, contact_email, trade_category, licence_details, insurance_expiry, compliance_expiry, emergency_contact, properties_covered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.companyName,
      body.contactName ?? null,
      body.contactPhone ?? null,
      body.contactEmail ?? null,
      body.tradeCategory,
      body.licenceDetails ?? null,
      body.insuranceExpiry ?? null,
      body.complianceExpiry ?? null,
      body.emergencyContact ?? null,
      body.propertiesCovered ? JSON.stringify(body.propertiesCovered) : null,
    )
    .run();
  await recordAudit(c.env.DB, {
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'contractor',
    entityId: id,
    after: body,
  });
  return c.json({ id }, 201);
});

contractorRoutes.get('/contractors/:id', async (c) => {
  requireCapability(c, 'contractor.read');
  const row = await c.env.DB.prepare(`SELECT * FROM contractors WHERE id = ?`).bind(c.req.param('id')).first();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Contractor not found.' } }, 404);
  const { results: attendance } = await c.env.DB.prepare(
    `SELECT * FROM contractor_attendance WHERE contractor_id = ? ORDER BY sign_in_at DESC LIMIT 20`,
  )
    .bind(row.id)
    .all();
  return c.json({ contractor: row, attendance: attendance ?? [] });
});

// --- QR sign-in/out flow (Section 9.2 / acceptance test) ------------------

contractorRoutes.post('/attendance/sign-in', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const body = await c.req.json<{
    propertyId?: string;
    contractorId: string;
    workOrderId?: string;
    purpose?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);

  const id = newId('att');
  await c.env.DB.prepare(
    `INSERT INTO contractor_attendance (id, property_id, contractor_id, work_order_id, purpose, status)
     VALUES (?, ?, ?, ?, ?, 'on_site')`,
  )
    .bind(id, propertyId, body.contractorId, body.workOrderId ?? null, body.purpose ?? null)
    .run();

  if (body.workOrderId) {
    await c.env.DB.prepare(`UPDATE work_orders SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'`)
      .bind(body.workOrderId)
      .run();
  }

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'contractor_attendance',
    entityId: id,
    after: body,
  });

  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: 'Contractor arrived on site',
    linkedEntityType: 'contractor_attendance',
    linkedEntityId: id,
  });

  return c.json({ id, status: 'on_site' }, 201);
});

// BM issues a key to the attending contractor.
contractorRoutes.post('/attendance/:id/issue-key', async (c) => {
  const user = requireCapability(c, 'key.manage');
  const body = await c.req.json<{ keyId: string }>();
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; contractor_id: string }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);

  await c.env.DB.prepare(`UPDATE contractor_attendance SET key_issued = 1, key_id = ?, bm_arrival_ack_by_user_id = ? WHERE id = ?`)
    .bind(body.keyId, user.id, attendance.id)
    .run();
  await c.env.DB.prepare(`UPDATE keys_register SET custody_status = 'issued', currently_held_by = ? WHERE id = ?`)
    .bind(attendance.contractor_id, body.keyId)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO key_transactions (id, key_id, contractor_attendance_id, issued_to, transaction_type, issued_by_user_id)
     VALUES (?, ?, ?, ?, 'issue', ?)`,
  )
    .bind(newId('ktx'), body.keyId, attendance.id, attendance.contractor_id, user.id)
    .run();

  await recordAudit(c.env.DB, {
    propertyId: attendance.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'key',
    entityId: body.keyId,
    after: { issuedTo: attendance.contractor_id, attendanceId: attendance.id },
  });

  return c.json({ ok: true });
});

// Contractor uploads report and attempts sign-out. Blocked if a key is
// outstanding, unless a BM override with reason is supplied (Section 9.2).
contractorRoutes.post('/attendance/:id/sign-out', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const body = await c.req.json<{ serviceReportR2Key?: string; overrideReason?: string }>().catch(() => ({}));
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{
      id: string;
      property_id: string;
      key_issued: number;
      key_id: string | null;
      status: string;
    }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);

  let keyReturned = false;
  if (attendance.key_issued && attendance.key_id) {
    const key = await c.env.DB.prepare(`SELECT custody_status FROM keys_register WHERE id = ?`)
      .bind(attendance.key_id)
      .first<{ custody_status: string }>();
    keyReturned = key?.custody_status === 'in_register';
  }

  const gate = canSignOutAttendance({
    keyIssued: Boolean(attendance.key_issued),
    keyReturned,
    overrideReason: body.overrideReason,
  });

  if (!gate.allowed) {
    throw new HttpError(409, 'KEY_OUTSTANDING', gate.reason ?? 'Key outstanding.');
  }

  const requiresOverride = gate.requiresOverride && body.overrideReason;
  await c.env.DB.prepare(
    `UPDATE contractor_attendance
     SET sign_out_at = datetime('now'), status = ?, service_report_r2_key = ?, override_reason = ?
     WHERE id = ?`,
  )
    .bind(
      requiresOverride ? 'pending_key_return' : 'closed',
      body.serviceReportR2Key ?? null,
      requiresOverride ? body.overrideReason : null,
      attendance.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId: attendance.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'contractor_attendance',
    entityId: attendance.id,
    after: { signedOut: true, override: requiresOverride ? body.overrideReason : undefined },
  });

  if (requiresOverride) {
    await notifyRole(c.env.DB, {
      propertyId: attendance.property_id,
      role: 'building_manager',
      title: 'Contractor signed out with key outstanding (override used)',
      body: body.overrideReason,
      linkedEntityType: 'contractor_attendance',
      linkedEntityId: attendance.id,
    });
  }

  return c.json({ id: attendance.id, status: requiresOverride ? 'pending_key_return' : 'closed' });
});

// BM verifies completed attendance/work.
contractorRoutes.post('/attendance/:id/verify', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);
  await c.env.DB.prepare(`UPDATE contractor_attendance SET verified_by_user_id = ?, status = 'closed' WHERE id = ?`)
    .bind(user.id, attendance.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: attendance.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'verify',
    entityType: 'contractor_attendance',
    entityId: attendance.id,
  });
  return c.json({ id: attendance.id, status: 'closed' });
});

contractorRoutes.get('/attendance', async (c) => {
  const user = requireCapability(c, 'attendance.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT a.*, ctr.company_name as contractorName FROM contractor_attendance a
             LEFT JOIN contractors ctr ON ctr.id = a.contractor_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND a.property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY a.sign_in_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// --- Key register -----------------------------------------------------

contractorRoutes.get('/keys', async (c) => {
  const user = requireCapability(c, 'key.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM keys_register WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY description`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

contractorRoutes.post('/keys', async (c) => {
  const user = requireCapability(c, 'key.manage');
  const body = await c.req.json<{ propertyId?: string; description: string; locationId?: string }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const id = newId('key');
  await c.env.DB.prepare(`INSERT INTO keys_register (id, property_id, description, location_id) VALUES (?, ?, ?, ?)`)
    .bind(id, propertyId, body.description, body.locationId ?? null)
    .run();
  return c.json({ id }, 201);
});

contractorRoutes.post('/keys/:id/return', async (c) => {
  const user = requireCapability(c, 'key.manage');
  const key = await c.env.DB.prepare(`SELECT * FROM keys_register WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    currently_held_by: string | null;
  }>();
  if (!key) return c.json({ error: { code: 'NOT_FOUND', message: 'Key not found.' } }, 404);
  assertPropertyAccess(user, key.property_id);
  await c.env.DB.prepare(`UPDATE keys_register SET custody_status = 'in_register', currently_held_by = NULL WHERE id = ?`)
    .bind(key.id)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO key_transactions (id, key_id, issued_to, transaction_type, issued_by_user_id) VALUES (?, ?, ?, 'return', ?)`,
  )
    .bind(newId('ktx'), key.id, key.currently_held_by ?? 'unknown', user.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId: key.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'key',
    entityId: key.id,
    after: { returned: true },
  });
  return c.json({ id: key.id, status: 'returned' });
});
