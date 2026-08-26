import { Hono } from 'hono';
import type { AppBindings, AppVariables, AuthUser } from '../middleware/auth';
import { requireCapability, requireAuth, assertPropertyAccess, HttpError } from '../middleware/auth';
import { roleHasCapability } from '../domain/security';
import { ACCESS_ITEM_TYPES, isOptionValue } from '../domain/operationalForms';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole, createTask } from '../lib/notify';
import { captureOperationalForm, findExistingCapturedEntity } from '../lib/formCapture';
import {
  requiredString,
  optionalString,
  optionalWholeNumber,
  booleanValue,
  validDateOnly,
  resolveIdempotencyKey,
} from '../lib/operationalInput';
import { canSignOutAttendance } from '../domain/workflow';

export const contractorRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

async function contractorForUser(db: D1Database, user: AuthUser) {
  return db.prepare(`SELECT * FROM contractors WHERE lower(contact_email) = lower(?) AND status = 'active'`)
    .bind(user.email)
    .first<Record<string, unknown>>();
}

function contractorCoversProperty(contractor: Record<string, unknown>, propertyId: string): boolean {
  const raw = contractor.properties_covered;
  if (!raw) return true;
  try {
    const values = JSON.parse(String(raw));
    return Array.isArray(values) && values.includes(propertyId);
  } catch {
    return String(raw).includes(propertyId);
  }
}

// Contractor-portal convenience endpoint. The response includes safe property
// choices so the browser never asks a contractor to type an internal D1 ID.
contractorRoutes.get('/my-contractor', async (c) => {
  const user = requireAuth(c);
  const row = await contractorForUser(c.env.DB, user);
  if (!row) return c.json(null);
  let propertyIds: string[] = [];
  try {
    propertyIds = row.properties_covered ? JSON.parse(String(row.properties_covered)) : [];
  } catch {
    propertyIds = user.propertyScope ? [user.propertyScope] : [];
  }
  if (user.propertyScope) propertyIds = propertyIds.filter((id) => id === user.propertyScope);
  const { results: properties } = propertyIds.length
    ? await c.env.DB.prepare(
        `SELECT id, name, address FROM properties WHERE id IN (${propertyIds.map(() => '?').join(',')}) ORDER BY name`,
      ).bind(...propertyIds).all()
    : { results: [] as unknown[] };
  return c.json({ ...row, properties: properties ?? [] });
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
  const normalized = {
    companyName: requiredString(body.companyName, 'companyName', 2, 240),
    contactName: optionalString(body.contactName, 200),
    contactPhone: optionalString(body.contactPhone, 80),
    contactEmail: optionalString(body.contactEmail, 240)?.toLowerCase() ?? null,
    tradeCategory: requiredString(body.tradeCategory, 'tradeCategory', 2, 100),
    licenceDetails: optionalString(body.licenceDetails, 500),
    insuranceExpiry: validDateOnly(body.insuranceExpiry, 'insuranceExpiry'),
    complianceExpiry: validDateOnly(body.complianceExpiry, 'complianceExpiry'),
    emergencyContact: optionalString(body.emergencyContact, 200),
    propertiesCovered: Array.isArray(body.propertiesCovered) ? [...new Set(body.propertiesCovered)] : [],
  };
  await c.env.DB.prepare(
    `INSERT INTO contractors
      (id, company_name, contact_name, contact_phone, contact_email, trade_category,
       licence_details, insurance_expiry, compliance_expiry, emergency_contact, properties_covered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      normalized.companyName,
      normalized.contactName,
      normalized.contactPhone,
      normalized.contactEmail,
      normalized.tradeCategory,
      normalized.licenceDetails,
      normalized.insuranceExpiry,
      normalized.complianceExpiry,
      normalized.emergencyContact,
      normalized.propertiesCovered.length ? JSON.stringify(normalized.propertiesCovered) : null,
    )
    .run();
  await recordAudit(c.env.DB, {
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'contractor',
    entityId: id,
    after: normalized,
  });
  return c.json({ id }, 201);
});

contractorRoutes.get('/contractors/:id', async (c) => {
  requireCapability(c, 'contractor.read');
  const row = await c.env.DB.prepare(`SELECT * FROM contractors WHERE id = ?`).bind(c.req.param('id')).first();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Contractor not found.' } }, 404);
  const { results: attendance } = await c.env.DB.prepare(
    `SELECT * FROM contractor_attendance WHERE contractor_id = ? ORDER BY sign_in_at DESC LIMIT 50`,
  )
    .bind(row.id)
    .all();
  return c.json({ contractor: row, attendance: attendance ?? [] });
});

// --- QR / mobile sign-in and sign-out -------------------------------------

contractorRoutes.post('/attendance/sign-in', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const body = await c.req.json<{
    propertyId?: string;
    contractorId?: string;
    workOrderId?: string;
    purpose: string;
    visitorName?: string;
    visitorMobile?: string;
    visitorEmail?: string;
    areaAccessed?: string;
    residentUnitId?: string;
    expectedDurationMinutes?: number;
    accessItemType?: string;
    accessItemIdentifier?: string;
    vehicleRegistration?: string;
    parkingLocation?: string;
    siteRulesAcknowledged?: boolean;
    clientSubmissionId?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'Select a property.');
  assertPropertyAccess(user, propertyId);
  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, status: 'on_site', duplicate: true });

  let contractorId = optionalString(body.contractorId, 120);
  let contractor: Record<string, unknown> | null = null;
  if (user.role === 'contractor') {
    contractor = await contractorForUser(c.env.DB, user);
    if (!contractor) throw new HttpError(403, 'CONTRACTOR_NOT_LINKED', 'No active contractor record is linked to this login.');
    contractorId = String(contractor.id);
  } else if (contractorId) {
    contractor = await c.env.DB.prepare(`SELECT * FROM contractors WHERE id = ? AND status = 'active'`)
      .bind(contractorId)
      .first<Record<string, unknown>>();
  }
  if (!contractorId || !contractor) throw new HttpError(400, 'CONTRACTOR_REQUIRED', 'An active contractor is required.');
  if (!contractorCoversProperty(contractor, propertyId)) {
    throw new HttpError(403, 'CONTRACTOR_PROPERTY_NOT_APPROVED', 'This contractor is not approved for the selected property.');
  }
  if (!booleanValue(body.siteRulesAcknowledged)) {
    throw new HttpError(400, 'SITE_RULES_REQUIRED', 'Site access and sign-out requirements must be acknowledged.');
  }
  const accessItemType = body.accessItemType ?? 'none';
  if (!isOptionValue(ACCESS_ITEM_TYPES, accessItemType)) {
    throw new HttpError(400, 'INVALID_ACCESS_ITEM', 'Unknown access item type.');
  }

  const residentUnitId = optionalString(body.residentUnitId, 120);
  if (residentUnitId) {
    const unit = await c.env.DB.prepare(`SELECT id FROM units WHERE id = ? AND property_id = ?`)
      .bind(residentUnitId, propertyId)
      .first();
    if (!unit) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', 'Unit does not belong to this property.');
  }
  const workOrderId = optionalString(body.workOrderId, 120);
  if (workOrderId) {
    const workOrder = await c.env.DB.prepare(`SELECT id, contractor_id as contractorId FROM work_orders WHERE id = ? AND property_id = ?`)
      .bind(workOrderId, propertyId)
      .first<{ id: string; contractorId: string | null }>();
    if (!workOrder) throw new HttpError(400, 'WORK_ORDER_NOT_FOUND', 'Work order does not belong to this property.');
    if (workOrder.contractorId && workOrder.contractorId !== contractorId) {
      throw new HttpError(403, 'WORK_ORDER_CONTRACTOR_MISMATCH', 'Work order is assigned to a different contractor.');
    }
  }

  const id = newId('att');
  const normalized = {
    propertyId,
    contractorId,
    workOrderId,
    purpose: requiredString(body.purpose, 'purpose', 3, 1000),
    visitorName: optionalString(body.visitorName, 200) ?? optionalString(contractor.contact_name, 200) ?? user.fullName,
    visitorMobile: optionalString(body.visitorMobile, 80) ?? optionalString(contractor.contact_phone, 80),
    visitorEmail: optionalString(body.visitorEmail, 240) ?? optionalString(contractor.contact_email, 240) ?? user.email,
    areaAccessed: optionalString(body.areaAccessed, 300),
    residentUnitId,
    expectedDurationMinutes: optionalWholeNumber(body.expectedDurationMinutes, 'expectedDurationMinutes', 0, 1440),
    accessItemType,
    accessItemIdentifier: optionalString(body.accessItemIdentifier, 160),
    vehicleRegistration: optionalString(body.vehicleRegistration, 80),
    parkingLocation: optionalString(body.parkingLocation, 160),
    siteRulesAcknowledged: true,
  };

  await c.env.DB.prepare(
    `INSERT INTO contractor_attendance
      (id, property_id, contractor_id, work_order_id, purpose, status,
       visitor_name, visitor_mobile, visitor_email, area_accessed, resident_unit_id,
       expected_duration_minutes, access_item_type, access_item_identifier,
       vehicle_registration, parking_location, site_rules_acknowledged)
     VALUES (?, ?, ?, ?, ?, 'on_site', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      contractorId,
      workOrderId,
      normalized.purpose,
      normalized.visitorName,
      normalized.visitorMobile,
      normalized.visitorEmail,
      normalized.areaAccessed,
      residentUnitId,
      normalized.expectedDurationMinutes,
      accessItemType,
      normalized.accessItemIdentifier,
      normalized.vehicleRegistration,
      normalized.parkingLocation,
      1,
    )
    .run();

  if (workOrderId) {
    await c.env.DB.prepare(
      `UPDATE work_orders SET status = 'in_progress', updated_at = datetime('now')
       WHERE id = ? AND status = 'scheduled'`,
    )
      .bind(workOrderId)
      .run();
  }

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'contractor_sign_in',
    entityType: 'contractor_attendance',
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
    entityType: 'contractor_attendance',
    entityId: id,
    after: normalized,
  });
  await notifyRole(c.env.DB, {
    propertyId,
    role: 'building_manager',
    title: `${String(contractor.company_name)} arrived on site`,
    body: normalized.purpose,
    linkedEntityType: 'contractor_attendance',
    linkedEntityId: id,
  });

  return c.json({ id, status: 'on_site', duplicate: false }, 201);
});

// Building Manager records a physical key issue. Generic fobs/remotes can be
// noted at sign-in, but a controlled key must exist in the key register.
contractorRoutes.post('/attendance/:id/issue-key', async (c) => {
  const user = requireCapability(c, 'key.manage');
  const body = await c.req.json<{ keyId: string }>();
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; contractor_id: string }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);
  const key = await c.env.DB.prepare(`SELECT id, custody_status as custodyStatus FROM keys_register WHERE id = ? AND property_id = ?`)
    .bind(body.keyId, attendance.property_id)
    .first<{ id: string; custodyStatus: string }>();
  if (!key) throw new HttpError(400, 'KEY_NOT_FOUND', 'Key does not belong to this property.');
  if (key.custodyStatus !== 'in_register') throw new HttpError(409, 'KEY_UNAVAILABLE', 'Key is not currently in the register.');

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE contractor_attendance
       SET key_issued = 1, key_id = ?, bm_arrival_ack_by_user_id = ?,
           access_item_type = 'key', access_item_identifier = ?
       WHERE id = ?`,
    ).bind(body.keyId, user.id, body.keyId, attendance.id),
    c.env.DB.prepare(
      `UPDATE keys_register SET custody_status = 'issued', currently_held_by = ? WHERE id = ?`,
    ).bind(attendance.contractor_id, body.keyId),
    c.env.DB.prepare(
      `INSERT INTO key_transactions
        (id, key_id, contractor_attendance_id, issued_to, transaction_type, issued_by_user_id)
       VALUES (?, ?, ?, ?, 'issue', ?)`,
    ).bind(newId('ktx'), body.keyId, attendance.id, attendance.contractor_id, user.id),
  ]);

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

// Contractor submits the completed visit record. If a controlled key has not
// been returned, the work details are retained and the attendance remains in
// pending_key_return rather than making the contractor type everything again.
contractorRoutes.post('/attendance/:id/sign-out', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const body = await c.req.json<{
    workCompleted?: boolean;
    workDescription?: string;
    additionalDefects?: string;
    furtherAttendanceRequired?: boolean;
    quoteOrReportToFollow?: boolean;
    keysReturned?: boolean;
    areaLeftClean?: boolean;
    bmInspected?: boolean;
    signoutNotes?: string;
    serviceReportR2Key?: string;
    overrideReason?: string;
    clientSubmissionId?: string;
  }>().catch(() => ({}));
  const attendance = await c.env.DB.prepare(
    `SELECT a.*, ctr.company_name as contractorName
     FROM contractor_attendance a JOIN contractors ctr ON ctr.id = a.contractor_id
     WHERE a.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  const propertyId = String(attendance.property_id);
  assertPropertyAccess(user, propertyId);
  if (user.role === 'contractor') {
    const mine = await contractorForUser(c.env.DB, user);
    if (!mine || String(mine.id) !== String(attendance.contractor_id)) {
      throw new HttpError(403, 'ATTENDANCE_NOT_OWNED', 'This attendance record belongs to another contractor.');
    }
  }
  if (attendance.status === 'closed') return c.json({ id: attendance.id, status: 'closed', duplicate: true });
  if (body.overrideReason && !roleHasCapability(user.role, 'attendance.override')) {
    throw new HttpError(403, 'OVERRIDE_NOT_ALLOWED', 'Only Building Management may override an outstanding key.');
  }

  const serviceReportR2Key = optionalString(body.serviceReportR2Key, 500);
  if (serviceReportR2Key && !serviceReportR2Key.startsWith(`${propertyId}/`) && !serviceReportR2Key.startsWith('shared/')) {
    throw new HttpError(400, 'INVALID_EVIDENCE_SCOPE', 'Service report does not belong to this property.');
  }
  const workDescription = optionalString(body.workDescription, 5000);
  if (booleanValue(body.workCompleted) && !workDescription) {
    throw new HttpError(400, 'WORK_DESCRIPTION_REQUIRED', 'Describe the work completed.');
  }

  let keyReturned = !booleanValue(attendance.key_issued);
  if (booleanValue(attendance.key_issued) && attendance.key_id) {
    const key = await c.env.DB.prepare(`SELECT custody_status as custodyStatus FROM keys_register WHERE id = ?`)
      .bind(attendance.key_id)
      .first<{ custodyStatus: string }>();
    keyReturned = key?.custodyStatus === 'in_register';
  }
  const gate = canSignOutAttendance({
    keyIssued: booleanValue(attendance.key_issued),
    keyReturned,
    overrideReason: optionalString(body.overrideReason, 1000),
  });
  const pendingKeyReturn = !gate.allowed;
  const overrideUsed = gate.allowed && gate.requiresOverride;
  const normalized = {
    workCompleted: booleanValue(body.workCompleted),
    workDescription,
    additionalDefects: optionalString(body.additionalDefects, 3000),
    furtherAttendanceRequired: booleanValue(body.furtherAttendanceRequired),
    quoteOrReportToFollow: booleanValue(body.quoteOrReportToFollow),
    keysReturned: keyReturned,
    areaLeftClean: body.areaLeftClean === undefined ? null : booleanValue(body.areaLeftClean),
    bmInspected: body.bmInspected === undefined ? null : booleanValue(body.bmInspected),
    signoutNotes: optionalString(body.signoutNotes, 3000),
    serviceReportR2Key,
    overrideReason: overrideUsed ? optionalString(body.overrideReason, 1000) : null,
  };

  await c.env.DB.prepare(
    `UPDATE contractor_attendance
     SET sign_out_at = CASE WHEN ? = 1 THEN NULL ELSE datetime('now') END,
         status = ?, service_report_r2_key = ?, override_reason = ?,
         work_completed = ?, work_description = ?, additional_defects = ?,
         further_attendance_required = ?, quote_or_report_to_follow = ?,
         keys_returned = ?, area_left_clean = ?, bm_inspected = ?, signout_notes = ?
     WHERE id = ?`,
  )
    .bind(
      pendingKeyReturn ? 1 : 0,
      pendingKeyReturn ? 'pending_key_return' : 'closed',
      serviceReportR2Key,
      normalized.overrideReason,
      normalized.workCompleted ? 1 : 0,
      normalized.workDescription,
      normalized.additionalDefects,
      normalized.furtherAttendanceRequired ? 1 : 0,
      normalized.quoteOrReportToFollow ? 1 : 0,
      keyReturned ? 1 : 0,
      normalized.areaLeftClean === null ? null : normalized.areaLeftClean ? 1 : 0,
      normalized.bmInspected === null ? null : normalized.bmInspected ? 1 : 0,
      normalized.signoutNotes,
      attendance.id,
    )
    .run();

  if (normalized.additionalDefects) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Review contractor finding: ${normalized.additionalDefects.slice(0, 100)}`,
      taskType: 'triage',
      linkedEntityType: 'contractor_attendance',
      linkedEntityId: String(attendance.id),
      priority: 'normal',
      assigneeRole: 'building_manager',
    });
  }
  if (normalized.furtherAttendanceRequired || normalized.quoteOrReportToFollow) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Contractor follow-up: ${String(attendance.contractorName)}`,
      taskType: 'contractor_followup',
      linkedEntityType: 'contractor_attendance',
      linkedEntityId: String(attendance.id),
      assigneeRole: 'building_manager',
    });
  }

  const clientSubmissionId = resolveIdempotencyKey(c.req.header('Idempotency-Key'), body.clientSubmissionId);
  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'contractor_sign_out',
    entityType: 'contractor_attendance',
    entityId: String(attendance.id),
    payload: normalized,
    submittedByUserId: user.id,
    clientSubmissionId,
    eventType: pendingKeyReturn ? 'updated' : 'completed',
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'status_change',
    entityType: 'contractor_attendance',
    entityId: String(attendance.id),
    after: { status: pendingKeyReturn ? 'pending_key_return' : 'closed', ...normalized },
  });

  if (pendingKeyReturn || overrideUsed) {
    await notifyRole(c.env.DB, {
      propertyId,
      role: 'building_manager',
      title: pendingKeyReturn
        ? 'Contractor sign-out waiting for key return'
        : 'Contractor signed out using a key override',
      body: normalized.overrideReason ?? `${String(attendance.contractorName)} has submitted the visit record.`,
      linkedEntityType: 'contractor_attendance',
      linkedEntityId: String(attendance.id),
    });
  }

  return c.json(
    {
      id: attendance.id,
      status: pendingKeyReturn ? 'pending_key_return' : 'closed',
      keyReturnRequired: pendingKeyReturn,
    },
    pendingKeyReturn ? 202 : 200,
  );
});

// Building Manager accepts the returned key and closes a pending sign-out.
contractorRoutes.post('/attendance/:id/return-key', async (c) => {
  const user = requireCapability(c, 'key.manage');
  const body = await c.req.json<{ notes?: string }>().catch(() => ({}));
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; contractor_id: string; key_id: string | null; status: string }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);
  if (!attendance.key_id) throw new HttpError(409, 'NO_KEY_ISSUED', 'No controlled key is linked to this attendance.');

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE keys_register SET custody_status = 'in_register', currently_held_by = NULL WHERE id = ?`,
    ).bind(attendance.key_id),
    c.env.DB.prepare(
      `INSERT INTO key_transactions
        (id, key_id, contractor_attendance_id, issued_to, transaction_type, issued_by_user_id, notes)
       VALUES (?, ?, ?, ?, 'return', ?, ?)`,
    ).bind(newId('ktx'), attendance.key_id, attendance.id, attendance.contractor_id, user.id, optionalString(body.notes, 1000)),
    c.env.DB.prepare(
      `UPDATE contractor_attendance
       SET keys_returned = 1, status = CASE WHEN status = 'pending_key_return' THEN 'closed' ELSE status END,
           sign_out_at = CASE WHEN status = 'pending_key_return' THEN datetime('now') ELSE sign_out_at END
       WHERE id = ?`,
    ).bind(attendance.id),
  ]);

  await recordAudit(c.env.DB, {
    propertyId: attendance.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'key',
    entityId: attendance.key_id,
    after: { returned: true, attendanceId: attendance.id },
  });
  return c.json({ id: attendance.id, status: attendance.status === 'pending_key_return' ? 'closed' : attendance.status });
});

// BM verifies the work area and visit record.
contractorRoutes.post('/attendance/:id/verify', async (c) => {
  const user = requireCapability(c, 'attendance.manage');
  const body = await c.req.json<{ areaLeftClean?: boolean; bmInspected?: boolean; notes?: string }>().catch(() => ({}));
  const attendance = await c.env.DB.prepare(`SELECT * FROM contractor_attendance WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; property_id: string; status: string }>();
  if (!attendance) return c.json({ error: { code: 'NOT_FOUND', message: 'Attendance record not found.' } }, 404);
  assertPropertyAccess(user, attendance.property_id);
  if (attendance.status === 'pending_key_return') {
    throw new HttpError(409, 'KEY_OUTSTANDING', 'Return the controlled key before verifying the attendance.');
  }
  await c.env.DB.prepare(
    `UPDATE contractor_attendance
     SET verified_by_user_id = ?, status = 'closed', bm_inspected = 1,
         area_left_clean = COALESCE(?, area_left_clean),
         signout_notes = COALESCE(?, signout_notes)
     WHERE id = ?`,
  )
    .bind(
      user.id,
      body.areaLeftClean === undefined ? null : booleanValue(body.areaLeftClean) ? 1 : 0,
      optionalString(body.notes, 2000),
      attendance.id,
    )
    .run();
  await recordAudit(c.env.DB, {
    propertyId: attendance.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'verify',
    entityType: 'contractor_attendance',
    entityId: attendance.id,
  });
  return c.json({ id: attendance.id, status: 'closed', verified: true });
});

contractorRoutes.get('/attendance', async (c) => {
  const user = requireCapability(c, 'attendance.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  let sql = `SELECT a.*, ctr.company_name as contractorName, u.unit_number as unitNumber
             FROM contractor_attendance a
             LEFT JOIN contractors ctr ON ctr.id = a.contractor_id
             LEFT JOIN units u ON u.id = a.resident_unit_id
             WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND a.property_id = ?`;
    binds.push(propertyId);
  }
  if (user.role === 'contractor') {
    const mine = await contractorForUser(c.env.DB, user);
    if (!mine) return c.json([]);
    sql += ` AND a.contractor_id = ?`;
    binds.push(mine.id);
  }
  sql += ` ORDER BY a.sign_in_at DESC LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// --- Key register ---------------------------------------------------------

contractorRoutes.get('/keys', async (c) => {
  const user = requireCapability(c, 'key.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
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
  assertPropertyAccess(user, propertyId);
  const locationId = optionalString(body.locationId, 120);
  if (locationId) {
    const location = await c.env.DB.prepare(`SELECT id FROM locations WHERE id = ? AND property_id = ?`)
      .bind(locationId, propertyId)
      .first();
    if (!location) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', 'Location does not belong to this property.');
  }
  const id = newId('key');
  await c.env.DB.prepare(`INSERT INTO keys_register (id, property_id, description, location_id) VALUES (?, ?, ?, ?)`)
    .bind(id, propertyId, requiredString(body.description, 'description', 2, 300), locationId)
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
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE keys_register SET custody_status = 'in_register', currently_held_by = NULL WHERE id = ?`)
      .bind(key.id),
    c.env.DB.prepare(
      `INSERT INTO key_transactions (id, key_id, issued_to, transaction_type, issued_by_user_id)
       VALUES (?, ?, ?, 'return', ?)`,
    ).bind(newId('ktx'), key.id, key.currently_held_by ?? 'unknown', user.id),
  ]);
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
