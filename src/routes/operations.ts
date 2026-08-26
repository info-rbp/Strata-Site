import { Hono } from 'hono';
import type { AppBindings, AppVariables, AuthUser } from '../middleware/auth';
import {
  requireAuth,
  requireCapability,
  assertPropertyAccess,
  HttpError,
} from '../middleware/auth';
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_STATUSES,
  FORM_SCHEMA_VERSION,
  INDUCTION_MODULES,
  OPERATIONAL_FORM_CONFIG,
  PRIORITIES,
  RESPONSIBLE_PARTIES,
  WASTE_ACTIVITIES,
  WASTE_EXCEPTION_CATEGORIES,
  WASTE_TYPES,
  isOptionValue,
} from '../domain/operationalForms';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { createTask } from '../lib/notify';
import {
  captureOperationalForm,
  findExistingCapturedEntity,
  listRecentFormSubmissions,
} from '../lib/formCapture';

export const operationsRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

function requiredText(value: unknown, field: string, minLength = 1, maxLength = 5000): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_INPUT', `${field} is required.`);
  }
  const text = value.trim();
  if (text.length < minLength) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be at least ${minLength} characters.`);
  }
  if (text.length > maxLength) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be no more than ${maxLength} characters.`);
  }
  return text;
}

function optionalText(value: unknown, maxLength = 5000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_INPUT', 'A text value was expected.');
  const text = value.trim();
  if (text.length > maxLength) throw new HttpError(400, 'INVALID_INPUT', `Text must be no more than ${maxLength} characters.`);
  return text || null;
}

function optionalInteger(value: unknown, field: string, min = 0, max = 100000): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function isoDateTime(value: unknown, field: string, fallback = new Date().toISOString()): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a valid date and time.`);
  }
  return new Date(value).toISOString();
}

function dateOnly(value: unknown, field: string, fallback?: string): string {
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  if (!text || !DATE_PATTERN.test(text.slice(0, 10))) {
    throw new HttpError(400, 'INVALID_INPUT', `${field} must use YYYY-MM-DD.`);
  }
  return text.slice(0, 10);
}

function resolvePropertyId(user: AuthUser, supplied?: string | null): string {
  const propertyId = user.propertyScope ?? supplied?.trim();
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  return propertyId;
}

function resolveClientSubmissionId(c: Parameters<typeof requireAuth>[0], supplied?: unknown): string | null {
  const fromBody = optionalText(supplied, 160);
  const fromHeader = optionalText(c.req.header('Idempotency-Key'), 160);
  return fromBody ?? fromHeader;
}

async function assertRelatedRecord(
  db: D1Database,
  table: 'locations' | 'buildings' | 'units',
  id: string | null,
  propertyId: string,
): Promise<void> {
  if (!id) return;
  const sql = {
    locations: `SELECT id FROM locations WHERE id = ? AND property_id = ?`,
    buildings: `SELECT id FROM buildings WHERE id = ? AND property_id = ?`,
    units: `SELECT id FROM units WHERE id = ? AND property_id = ?`,
  }[table];
  const row = await db.prepare(sql).bind(id, propertyId).first();
  if (!row) throw new HttpError(400, 'PROPERTY_RELATION_MISMATCH', `${table.slice(0, -1)} does not belong to this property.`);
}

// Lightweight health endpoint for Cloudflare deployment checks.
operationsRoutes.get('/health', async (c) => {
  await c.env.DB.prepare(`SELECT 1 as ok`).first();
  return c.json({
    status: 'ok',
    product: 'ProInspect Building Management',
    schemaVersion: FORM_SCHEMA_VERSION,
    checkedAt: new Date().toISOString(),
  });
});

// The same canonical option values are used by the browser forms, D1 records,
// Google Sheets outbox and future ProInspect interoperability exports.
operationsRoutes.get('/forms/config', (c) => {
  requireAuth(c);
  return c.json(OPERATIONAL_FORM_CONFIG);
});

operationsRoutes.get('/forms/options', async (c) => {
  const user = requireCapability(c, 'form.read');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const db = c.env.DB;
  const [property, buildings, locations, units, contractors, inspectionTemplates, keys] = await Promise.all([
    db.prepare(`SELECT id, name, address, timezone, strata_plan as strataPlan FROM properties WHERE id = ?`).bind(propertyId).first(),
    db.prepare(`SELECT id, name FROM buildings WHERE property_id = ? ORDER BY name`).bind(propertyId).all(),
    db.prepare(`SELECT id, building_id as buildingId, level_label as levelLabel, location_type as locationType, name FROM locations WHERE property_id = ? ORDER BY name`).bind(propertyId).all(),
    db.prepare(`SELECT id, building_id as buildingId, unit_number as unitNumber, level_label as levelLabel FROM units WHERE property_id = ? ORDER BY unit_number`).bind(propertyId).all(),
    db.prepare(`SELECT id, company_name as companyName, contact_name as contactName, contact_phone as contactPhone, trade_category as tradeCategory FROM contractors WHERE status = 'active' AND (properties_covered IS NULL OR properties_covered LIKE ?) ORDER BY company_name`).bind(`%${propertyId}%`).all(),
    db.prepare(`SELECT id, name, frequency FROM inspection_templates WHERE property_id = ? ORDER BY name`).bind(propertyId).all(),
    db.prepare(`SELECT id, description, custody_status as custodyStatus FROM keys_register WHERE property_id = ? ORDER BY description`).bind(propertyId).all(),
  ]);

  return c.json({
    property,
    buildings: buildings.results ?? [],
    locations: locations.results ?? [],
    units: units.results ?? [],
    contractors: contractors.results ?? [],
    inspectionTemplates: inspectionTemplates.results ?? [],
    keys: keys.results ?? [],
  });
});

// ---------------------------------------------------------------------------
// Daily Building Manager activity log
// ---------------------------------------------------------------------------

operationsRoutes.get('/activities', async (c) => {
  const user = requireCapability(c, 'activity.read');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const month = c.req.query('month');
  const category = c.req.query('category');
  const status = c.req.query('status');
  let sql = `SELECT a.*, l.name as locationName, u.unit_number as unitNumber,
                    ctr.company_name as contractorName
             FROM daily_activity_logs a
             LEFT JOIN locations l ON l.id = a.location_id
             LEFT JOIN units u ON u.id = a.unit_id
             LEFT JOIN contractors ctr ON ctr.id = a.contractor_id
             WHERE a.property_id = ?`;
  const binds: unknown[] = [propertyId];
  if (month) {
    if (!MONTH_PATTERN.test(month)) throw new HttpError(400, 'INVALID_MONTH', 'month must use YYYY-MM.');
    sql += ` AND a.activity_date LIKE ?`;
    binds.push(`${month}%`);
  }
  if (category) {
    sql += ` AND a.category = ?`;
    binds.push(category);
  }
  if (status) {
    sql += ` AND a.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY a.occurred_at DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

operationsRoutes.post('/activities', async (c) => {
  const user = requireCapability(c, 'activity.create');
  const body = await c.req.json<{
    propertyId?: string;
    activityDate?: string;
    occurredAt?: string;
    category: string;
    summary: string;
    actionTaken?: string;
    locationId?: string;
    buildingId?: string;
    levelLabel?: string;
    specificLocation?: string;
    unitId?: string;
    contractorId?: string;
    followUpRequired?: boolean;
    followUpDate?: string;
    responsibleParty?: string;
    priority?: string;
    status?: string;
    minutesSpent?: number;
    evidenceR2Key?: string;
    additionalNotes?: string;
    sourceEntityType?: string;
    sourceEntityId?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = resolvePropertyId(user, body.propertyId);
  const clientSubmissionId = resolveClientSubmissionId(c, body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, duplicate: true });

  if (!isOptionValue(ACTIVITY_CATEGORIES, body.category)) {
    throw new HttpError(400, 'INVALID_CATEGORY', 'Unknown activity category.');
  }
  const priority = body.priority ?? 'routine';
  const status = body.status ?? 'completed';
  if (!isOptionValue(PRIORITIES, priority)) throw new HttpError(400, 'INVALID_PRIORITY', 'Unknown priority.');
  if (!isOptionValue(ACTIVITY_STATUSES, status)) throw new HttpError(400, 'INVALID_STATUS', 'Unknown activity status.');
  if (body.responsibleParty && !isOptionValue(RESPONSIBLE_PARTIES, body.responsibleParty)) {
    throw new HttpError(400, 'INVALID_RESPONSIBLE_PARTY', 'Unknown responsible party.');
  }

  const occurredAt = isoDateTime(body.occurredAt, 'occurredAt');
  const activityDate = dateOnly(body.activityDate, 'activityDate', occurredAt.slice(0, 10));
  const summary = requiredText(body.summary, 'summary', 3, 600);
  const actionTaken = optionalText(body.actionTaken, 2000);
  const locationId = optionalText(body.locationId, 120);
  const buildingId = optionalText(body.buildingId, 120);
  const unitId = optionalText(body.unitId, 120);
  await Promise.all([
    assertRelatedRecord(c.env.DB, 'locations', locationId, propertyId),
    assertRelatedRecord(c.env.DB, 'buildings', buildingId, propertyId),
    assertRelatedRecord(c.env.DB, 'units', unitId, propertyId),
  ]);

  const followUpRequired = bool(body.followUpRequired);
  const followUpDate = followUpRequired && body.followUpDate
    ? dateOnly(body.followUpDate, 'followUpDate')
    : null;
  const id = newId('activity');
  const normalized = {
    propertyId,
    activityDate,
    occurredAt,
    category: body.category,
    summary,
    actionTaken,
    locationId,
    buildingId,
    levelLabel: optionalText(body.levelLabel, 80),
    specificLocation: optionalText(body.specificLocation, 240),
    unitId,
    contractorId: optionalText(body.contractorId, 120),
    followUpRequired,
    followUpDate,
    responsibleParty: optionalText(body.responsibleParty, 80),
    priority,
    status,
    minutesSpent: optionalInteger(body.minutesSpent, 'minutesSpent', 0, 1440),
    evidenceR2Key: optionalText(body.evidenceR2Key, 500),
    additionalNotes: optionalText(body.additionalNotes, 3000),
    sourceEntityType: optionalText(body.sourceEntityType, 100),
    sourceEntityId: optionalText(body.sourceEntityId, 160),
  };

  await c.env.DB.prepare(
    `INSERT INTO daily_activity_logs
      (id, property_id, activity_date, occurred_at, category, summary, action_taken,
       location_id, building_id, level_label, specific_location, unit_id, contractor_id,
       follow_up_required, follow_up_date, responsible_party, priority, status,
       minutes_spent, evidence_r2_key, additional_notes, source_entity_type,
       source_entity_id, recorded_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      activityDate,
      occurredAt,
      body.category,
      summary,
      actionTaken,
      locationId,
      buildingId,
      normalized.levelLabel,
      normalized.specificLocation,
      unitId,
      normalized.contractorId,
      followUpRequired ? 1 : 0,
      followUpDate,
      normalized.responsibleParty,
      priority,
      status,
      normalized.minutesSpent,
      normalized.evidenceR2Key,
      normalized.additionalNotes,
      normalized.sourceEntityType,
      normalized.sourceEntityId,
      user.id,
    )
    .run();

  if (followUpRequired) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Follow up: ${summary.slice(0, 100)}`,
      taskType: 'approval_followup',
      linkedEntityType: 'daily_activity',
      linkedEntityId: id,
      dueAt: followUpDate,
      priority: priority === 'urgent' || priority === 'high' ? 'urgent' : 'normal',
      assigneeRole: normalized.responsibleParty === 'strata_manager' ? 'strata_manager' : 'building_manager',
    });
  }

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'daily_activity',
    entityType: 'daily_activity',
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
    entityType: 'daily_activity',
    entityId: id,
    after: normalized,
  });

  return c.json({ id, status, duplicate: false }, 201);
});

// ---------------------------------------------------------------------------
// Waste management log
// ---------------------------------------------------------------------------

operationsRoutes.get('/waste-events', async (c) => {
  const user = requireCapability(c, 'waste.read');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const month = c.req.query('month');
  let sql = `SELECT w.*, l.name as locationName, u.unit_number as responsibleUnitNumber
             FROM waste_events w
             LEFT JOIN locations l ON l.id = w.location_id
             LEFT JOIN units u ON u.id = w.responsible_unit_id
             WHERE w.property_id = ?`;
  const binds: unknown[] = [propertyId];
  if (month) {
    if (!MONTH_PATTERN.test(month)) throw new HttpError(400, 'INVALID_MONTH', 'month must use YYYY-MM.');
    sql += ` AND substr(w.occurred_at, 1, 7) = ?`;
    binds.push(month);
  }
  sql += ` ORDER BY w.occurred_at DESC LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

operationsRoutes.post('/waste-events', async (c) => {
  const user = requireCapability(c, 'waste.manage');
  const body = await c.req.json<{
    propertyId?: string;
    occurredAt?: string;
    locationId?: string;
    wasteType: string;
    activity: string;
    quantity?: number;
    conditionStatus?: string;
    issueIdentified?: boolean;
    exceptionCategory?: string;
    responsibleUnitId?: string;
    notes?: string;
    actionTaken?: string;
    minutesSpent?: number;
    collectionRequired?: boolean;
    collectionArrangedDate?: string;
    evidenceR2Key?: string;
    clientSubmissionId?: string;
  }>();
  const propertyId = resolvePropertyId(user, body.propertyId);
  const clientSubmissionId = resolveClientSubmissionId(c, body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, duplicate: true });

  if (!isOptionValue(WASTE_TYPES, body.wasteType)) throw new HttpError(400, 'INVALID_WASTE_TYPE', 'Unknown waste type.');
  if (!isOptionValue(WASTE_ACTIVITIES, body.activity)) throw new HttpError(400, 'INVALID_WASTE_ACTIVITY', 'Unknown waste activity.');
  const issueIdentified = bool(body.issueIdentified);
  if (body.exceptionCategory && !isOptionValue(WASTE_EXCEPTION_CATEGORIES, body.exceptionCategory)) {
    throw new HttpError(400, 'INVALID_WASTE_EXCEPTION', 'Unknown waste exception category.');
  }
  const occurredAt = isoDateTime(body.occurredAt, 'occurredAt');
  const locationId = optionalText(body.locationId, 120);
  const responsibleUnitId = optionalText(body.responsibleUnitId, 120);
  await Promise.all([
    assertRelatedRecord(c.env.DB, 'locations', locationId, propertyId),
    assertRelatedRecord(c.env.DB, 'units', responsibleUnitId, propertyId),
  ]);
  const collectionRequired = bool(body.collectionRequired);
  const id = newId('waste');
  const normalized = {
    propertyId,
    occurredAt,
    locationId,
    wasteType: body.wasteType,
    activity: body.activity,
    quantity: optionalInteger(body.quantity, 'quantity', 0, 1000),
    conditionStatus: optionalText(body.conditionStatus, 120),
    issueIdentified,
    exceptionCategory: issueIdentified ? optionalText(body.exceptionCategory, 120) : null,
    responsibleUnitId,
    notes: optionalText(body.notes, 2000),
    actionTaken: optionalText(body.actionTaken, 2000),
    minutesSpent: optionalInteger(body.minutesSpent, 'minutesSpent', 0, 1440),
    collectionRequired,
    collectionArrangedDate: collectionRequired && body.collectionArrangedDate
      ? dateOnly(body.collectionArrangedDate, 'collectionArrangedDate')
      : null,
    evidenceR2Key: optionalText(body.evidenceR2Key, 500),
  };

  await c.env.DB.prepare(
    `INSERT INTO waste_events
      (id, property_id, event_type, exception_category, recorded_by_user_id,
       minutes_spent, notes, occurred_at, location_id, waste_type, activity,
       quantity, condition_status, issue_identified, responsible_unit_id,
       action_taken, collection_required, collection_arranged_date, evidence_r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      propertyId,
      issueIdentified ? 'exception' : 'routine_activity',
      normalized.exceptionCategory,
      user.id,
      normalized.minutesSpent,
      normalized.notes,
      occurredAt,
      locationId,
      body.wasteType,
      body.activity,
      normalized.quantity,
      normalized.conditionStatus,
      issueIdentified ? 1 : 0,
      responsibleUnitId,
      normalized.actionTaken,
      collectionRequired ? 1 : 0,
      normalized.collectionArrangedDate,
      normalized.evidenceR2Key,
    )
    .run();

  if (issueIdentified || collectionRequired) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Waste follow-up: ${body.activity.replace(/_/g, ' ')}`,
      taskType: 'other',
      linkedEntityType: 'waste_event',
      linkedEntityId: id,
      dueAt: normalized.collectionArrangedDate,
      priority: body.activity === 'chute_blockage_cleared' || body.activity === 'collection_missed' ? 'urgent' : 'normal',
      assigneeRole: 'building_manager',
    });
  }

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'waste_activity',
    entityType: 'waste_event',
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
    entityType: 'waste_event',
    entityId: id,
    after: normalized,
  });

  return c.json({ id, issueIdentified, duplicate: false }, 201);
});

// ---------------------------------------------------------------------------
// New resident induction / orientation
// ---------------------------------------------------------------------------

operationsRoutes.get('/resident-onboarding', async (c) => {
  const user = requireCapability(c, 'move.read');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const { results } = await c.env.DB.prepare(
    `SELECT o.*, u.unit_number as unitNumber, m.move_type as moveType
     FROM resident_onboarding o
     JOIN units u ON u.id = o.unit_id
     LEFT JOIN move_bookings m ON m.id = o.move_booking_id
     WHERE o.property_id = ?
     ORDER BY COALESCE(o.orientation_completed_at, o.created_at) DESC
     LIMIT 300`,
  )
    .bind(propertyId)
    .all();
  return c.json(results ?? []);
});

operationsRoutes.post('/resident-onboarding', async (c) => {
  const user = requireCapability(c, 'move.manage');
  const body = await c.req.json<{
    propertyId?: string;
    unitId: string;
    moveBookingId?: string;
    residentName: string;
    residentRole?: string;
    moveInDate?: string;
    modulesAcknowledged?: string[];
    rulesAcknowledged?: boolean;
    questionsRaised?: string;
    outstandingMatters?: string;
    acknowledgementName?: string;
    bmNotes?: string;
    completed?: boolean;
    clientSubmissionId?: string;
  }>();
  const propertyId = resolvePropertyId(user, body.propertyId);
  const clientSubmissionId = resolveClientSubmissionId(c, body.clientSubmissionId);
  const duplicate = await findExistingCapturedEntity(c.env.DB, propertyId, clientSubmissionId);
  if (duplicate) return c.json({ id: duplicate.entityId, duplicate: true });

  const unitId = requiredText(body.unitId, 'unitId', 1, 120);
  await assertRelatedRecord(c.env.DB, 'units', unitId, propertyId);
  const allowedModules = new Set(INDUCTION_MODULES.map((module) => module.value));
  const modules = [...new Set(Array.isArray(body.modulesAcknowledged) ? body.modulesAcknowledged : [])];
  if (modules.some((module) => !allowedModules.has(module))) {
    throw new HttpError(400, 'INVALID_INDUCTION_MODULE', 'An unknown induction module was supplied.');
  }
  const completed = bool(body.completed);
  const rulesAcknowledged = bool(body.rulesAcknowledged);
  if (completed && (!rulesAcknowledged || modules.length !== INDUCTION_MODULES.length)) {
    throw new HttpError(
      400,
      'INDUCTION_INCOMPLETE',
      'All induction modules and the resident rules acknowledgement are required before completion.',
    );
  }

  const id = newId('onboard');
  const now = new Date().toISOString();
  const normalized = {
    propertyId,
    unitId,
    moveBookingId: optionalText(body.moveBookingId, 120),
    residentName: requiredText(body.residentName, 'residentName', 2, 200),
    residentRole: optionalText(body.residentRole, 80),
    moveInDate: body.moveInDate ? dateOnly(body.moveInDate, 'moveInDate') : null,
    modulesAcknowledged: modules,
    rulesAcknowledged,
    questionsRaised: optionalText(body.questionsRaised, 2000),
    outstandingMatters: optionalText(body.outstandingMatters, 2000),
    acknowledgementName: optionalText(body.acknowledgementName, 200),
    bmNotes: optionalText(body.bmNotes, 2000),
    completed,
  };

  await c.env.DB.prepare(
    `INSERT INTO resident_onboarding
      (id, move_booking_id, unit_id, modules_ack, rules_ack,
       orientation_completed_by_user_id, orientation_completed_at, status,
       property_id, resident_name, resident_role, move_in_date, questions_raised,
       outstanding_matters, acknowledgement_name, bm_notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      normalized.moveBookingId,
      unitId,
      JSON.stringify(modules),
      rulesAcknowledged ? 1 : 0,
      completed ? user.id : null,
      completed ? now : null,
      completed ? 'complete' : 'in_progress',
      propertyId,
      normalized.residentName,
      normalized.residentRole,
      normalized.moveInDate,
      normalized.questionsRaised,
      normalized.outstandingMatters,
      normalized.acknowledgementName,
      normalized.bmNotes,
      now,
    )
    .run();

  if (normalized.outstandingMatters) {
    await createTask(c.env.DB, {
      propertyId,
      title: `Resident induction follow-up: ${normalized.residentName}`,
      taskType: 'other',
      linkedEntityType: 'resident_onboarding',
      linkedEntityId: id,
      assigneeRole: 'building_manager',
    });
  }

  await captureOperationalForm(c.env.DB, {
    propertyId,
    formType: 'resident_induction',
    entityType: 'resident_onboarding',
    entityId: id,
    payload: normalized,
    submittedByUserId: user.id,
    clientSubmissionId,
    eventType: completed ? 'completed' : 'created',
  });
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'resident_onboarding',
    entityId: id,
    after: normalized,
  });

  return c.json({ id, status: completed ? 'complete' : 'in_progress', duplicate: false }, 201);
});

// ---------------------------------------------------------------------------
// Form archive and Google Sheets integration outbox
// ---------------------------------------------------------------------------

operationsRoutes.get('/form-submissions', async (c) => {
  const user = requireCapability(c, 'form.read');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const limit = optionalInteger(c.req.query('limit'), 'limit', 1, 500) ?? 100;
  return c.json(await listRecentFormSubmissions(c.env.DB, propertyId, limit));
});

operationsRoutes.get('/integration/export-contract', (c) => {
  requireCapability(c, 'integration.read');
  return c.json({
    contract: 'proinspect-building-management.operational-forms',
    schemaVersion: FORM_SCHEMA_VERSION,
    provider: 'google_sheets',
    envelopeColumns: [
      'schemaVersion',
      'formType',
      'propertyId',
      'entityType',
      'entityId',
      'submittedAt',
      'data',
    ],
    formDefinitions: OPERATIONAL_FORM_CONFIG.definitions,
    note: 'Each outbox payload is immutable JSON. The future connector may flatten data into one worksheet per formType without changing this contract.',
  });
});

operationsRoutes.get('/integration/outbox', async (c) => {
  const user = requireCapability(c, 'integration.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (propertyId) assertPropertyAccess(user, propertyId);
  const status = c.req.query('status') ?? 'pending';
  const limit = optionalInteger(c.req.query('limit'), 'limit', 1, 500) ?? 100;
  let sql = `SELECT id, property_id as propertyId, provider, event_type as eventType,
                    entity_type as entityType, entity_id as entityId,
                    form_submission_id as formSubmissionId, schema_version as schemaVersion,
                    dedupe_key as dedupeKey, payload_json as payloadJson,
                    sync_status as syncStatus, attempt_count as attemptCount,
                    last_attempt_at as lastAttemptAt, last_error as lastError,
                    external_reference as externalReference, created_at as createdAt,
                    synced_at as syncedAt
             FROM integration_outbox WHERE sync_status = ?`;
  const binds: unknown[] = [status];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY created_at LIMIT ?`;
  binds.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return c.json((results ?? []).map((row) => {
    const { payloadJson, ...rest } = row;
    return { ...rest, payload: typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson };
  }));
});

operationsRoutes.post('/integration/outbox/:id/mark-synced', async (c) => {
  const user = requireCapability(c, 'integration.manage');
  const body = await c.req.json<{ externalReference?: string }>().catch(() => ({}));
  const row = await c.env.DB.prepare(`SELECT id, property_id as propertyId FROM integration_outbox WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; propertyId: string }>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Outbox event not found.' } }, 404);
  assertPropertyAccess(user, row.propertyId);
  await c.env.DB.prepare(
    `UPDATE integration_outbox
     SET sync_status = 'synced', synced_at = datetime('now'), last_attempt_at = datetime('now'),
         attempt_count = attempt_count + 1, last_error = NULL, external_reference = ?
     WHERE id = ?`,
  )
    .bind(optionalText(body.externalReference, 500), row.id)
    .run();
  return c.json({ id: row.id, syncStatus: 'synced' });
});

operationsRoutes.post('/integration/outbox/:id/requeue', async (c) => {
  const user = requireCapability(c, 'integration.manage');
  const row = await c.env.DB.prepare(`SELECT id, property_id as propertyId FROM integration_outbox WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; propertyId: string }>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: 'Outbox event not found.' } }, 404);
  assertPropertyAccess(user, row.propertyId);
  await c.env.DB.prepare(
    `UPDATE integration_outbox
     SET sync_status = 'pending', synced_at = NULL, last_error = NULL
     WHERE id = ?`,
  )
    .bind(row.id)
    .run();
  return c.json({ id: row.id, syncStatus: 'pending' });
});
