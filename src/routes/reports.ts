import { Hono } from 'hono';
import type { AppBindings, AppVariables, AuthUser } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { MONTHLY_REPORT_SECTIONS, type MonthlyReportSection } from '../domain/operationalForms';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

export const reportRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ReportItem {
  date: string | null;
  summary: string;
  actions: string | null;
  status: string | null;
  sourceType: string;
  sourceId: string;
  priority?: string | null;
  location?: string | null;
  unitNumber?: string | null;
}

interface MonthlySection {
  key: MonthlyReportSection;
  title: string;
  items: ReportItem[];
  count: number;
}

function validateMonth(value: string | undefined): string {
  const month = value ?? new Date().toISOString().slice(0, 7);
  if (!MONTH_PATTERN.test(month)) throw new HttpError(400, 'INVALID_MONTH', 'month must use YYYY-MM.');
  return month;
}

// Prima and Meridian are in Western Australia, which does not observe daylight
// saving. Explicit bounds prevent UTC near-midnight records from slipping into
// the wrong reporting month.
function perthMonthBounds(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const startUtc = Date.UTC(year, monthNumber - 1, 1) - 8 * 60 * 60 * 1000;
  const endUtc = Date.UTC(year, monthNumber, 1) - 8 * 60 * 60 * 1000;
  return { start: new Date(startUtc).toISOString(), end: new Date(endUtc).toISOString() };
}

function resolvePropertyId(user: AuthUser, supplied?: string | null): string {
  const propertyId = user.propertyScope ?? supplied?.trim();
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  return propertyId;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function titleCase(value: string | null | undefined): string {
  return (value ?? 'other')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function activityItem(row: Record<string, unknown>): ReportItem {
  return {
    date: dateLabel(row.occurredAt ?? row.activityDate),
    summary: String(row.summary ?? ''),
    actions: textOrNull(row.actionTaken) ?? textOrNull(row.additionalNotes),
    status: textOrNull(row.status),
    sourceType: 'daily_activity',
    sourceId: String(row.id),
    priority: textOrNull(row.priority),
    location: textOrNull(row.locationName) ?? textOrNull(row.specificLocation),
    unitNumber: textOrNull(row.unitNumber),
  };
}

function section(key: MonthlyReportSection, title: string, items: ReportItem[]): MonthlySection {
  return { key, title, items, count: items.length };
}

function parseCommentary(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => MONTHLY_REPORT_SECTIONS.includes(key as MonthlyReportSection) && typeof item === 'string')
        .map(([key, item]) => [key, (item as string).slice(0, 12000)]),
    );
  } catch {
    return {};
  }
}

async function buildMonthlyReport(db: D1Database, propertyId: string, month: string) {
  const { start, end } = perthMonthBounds(month);
  const [
    property,
    activities,
    defects,
    workOrders,
    contractors,
    moves,
    onboarding,
    incidents,
    waste,
    bylaws,
    accessRequests,
    inspections,
    outstandingTasks,
    outstandingDefects,
    approvalsPending,
  ] = await Promise.all([
    db
      .prepare(`SELECT id, name, address, timezone, strata_plan as strataPlan FROM properties WHERE id = ?`)
      .bind(propertyId)
      .first(),
    db
      .prepare(
        `SELECT a.id, a.activity_date as activityDate, a.occurred_at as occurredAt,
                a.category, a.summary, a.action_taken as actionTaken,
                a.additional_notes as additionalNotes, a.status, a.priority,
                a.specific_location as specificLocation, l.name as locationName,
                u.unit_number as unitNumber, a.minutes_spent as minutesSpent,
                a.follow_up_required as followUpRequired, a.follow_up_date as followUpDate,
                a.source_entity_type as sourceEntityType, a.source_entity_id as sourceEntityId
         FROM daily_activity_logs a
         LEFT JOIN locations l ON l.id = a.location_id
         LEFT JOIN units u ON u.id = a.unit_id
         WHERE a.property_id = ? AND substr(a.activity_date, 1, 7) = ?
         ORDER BY a.occurred_at`,
      )
      .bind(propertyId, month)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT d.id, d.category, d.description, d.risk_level as riskLevel,
                d.priority, d.status, d.immediate_response as immediateResponse,
                d.work_completed_notes as workCompletedNotes,
                d.specific_location as specificLocation, d.created_at as createdAt,
                d.updated_at as updatedAt, d.next_follow_up_date as nextFollowUpDate,
                l.name as locationName, u.unit_number as unitNumber,
                ctr.company_name as contractorName
         FROM defects d
         LEFT JOIN locations l ON l.id = d.location_id
         LEFT JOIN units u ON u.id = d.unit_id
         LEFT JOIN contractors ctr ON ctr.id = d.assigned_contractor_id
         WHERE d.property_id = ?
           AND datetime(d.created_at) >= datetime(?) AND datetime(d.created_at) < datetime(?)
         ORDER BY d.created_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT w.id, w.scope, w.status, w.findings, w.work_performed as workPerformed,
                w.recommendations, w.scheduled_at as scheduledAt, w.created_at as createdAt,
                l.name as locationName, ctr.company_name as contractorName
         FROM work_orders w
         LEFT JOIN locations l ON l.id = w.location_id
         LEFT JOIN contractors ctr ON ctr.id = w.contractor_id
         WHERE w.property_id = ?
           AND datetime(w.created_at) >= datetime(?) AND datetime(w.created_at) < datetime(?)
         ORDER BY w.created_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT a.id, a.sign_in_at as signInAt, a.sign_out_at as signOutAt,
                a.purpose, a.area_accessed as areaAccessed, a.work_completed as workCompleted,
                a.work_description as workDescription, a.additional_defects as additionalDefects,
                a.further_attendance_required as furtherAttendanceRequired,
                a.quote_or_report_to_follow as quoteOrReportToFollow, a.status,
                ctr.company_name as contractorName, u.unit_number as unitNumber
         FROM contractor_attendance a
         JOIN contractors ctr ON ctr.id = a.contractor_id
         LEFT JOIN units u ON u.id = a.resident_unit_id
         WHERE a.property_id = ?
           AND datetime(a.sign_in_at) >= datetime(?) AND datetime(a.sign_in_at) < datetime(?)
         ORDER BY a.sign_in_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT m.id, m.move_type as moveType, m.requested_at as requestedAt,
                m.status, m.applicant_name as applicantName, m.removalist_name as removalistName,
                m.special_requirements as specialRequirements, m.post_move_inspection_notes as postMoveNotes,
                u.unit_number as unitNumber
         FROM move_bookings m
         JOIN units u ON u.id = m.unit_id
         WHERE m.property_id = ?
           AND datetime(m.requested_at) >= datetime(?) AND datetime(m.requested_at) < datetime(?)
         ORDER BY m.requested_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT o.id, o.resident_name as residentName, o.resident_role as residentRole,
                o.move_in_date as moveInDate, o.status, o.orientation_completed_at as completedAt,
                o.questions_raised as questionsRaised, o.outstanding_matters as outstandingMatters,
                u.unit_number as unitNumber
         FROM resident_onboarding o
         JOIN units u ON u.id = o.unit_id
         WHERE o.property_id = ?
           AND datetime(COALESCE(o.orientation_completed_at, o.created_at)) >= datetime(?)
           AND datetime(COALESCE(o.orientation_completed_at, o.created_at)) < datetime(?)
         ORDER BY COALESCE(o.orientation_completed_at, o.created_at)`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT i.id, i.category, i.description, i.severity, i.status,
                COALESCE(i.incident_at, i.created_at) as incidentAt,
                i.actions_taken as actionsTaken, i.resolution,
                i.external_reference as externalReference,
                i.cctv_reviewed as cctvReviewed, i.follow_up_required as followUpRequired,
                i.follow_up_date as followUpDate, l.name as locationName,
                u.unit_number as unitNumber
         FROM incidents i
         LEFT JOIN locations l ON l.id = i.location_id
         LEFT JOIN units u ON u.id = i.unit_id
         WHERE i.property_id = ?
           AND datetime(COALESCE(i.incident_at, i.created_at)) >= datetime(?)
           AND datetime(COALESCE(i.incident_at, i.created_at)) < datetime(?)
         ORDER BY COALESCE(i.incident_at, i.created_at)`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT w.id, w.event_type as eventType, w.waste_type as wasteType,
                w.activity, w.exception_category as exceptionCategory,
                w.quantity, w.condition_status as conditionStatus,
                w.issue_identified as issueIdentified, w.notes,
                w.action_taken as actionTaken, w.minutes_spent as minutesSpent,
                w.collection_required as collectionRequired,
                w.collection_arranged_date as collectionArrangedDate,
                w.occurred_at as occurredAt, l.name as locationName,
                u.unit_number as responsibleUnitNumber
         FROM waste_events w
         LEFT JOIN locations l ON l.id = w.location_id
         LEFT JOIN units u ON u.id = w.responsible_unit_id
         WHERE w.property_id = ?
           AND datetime(w.occurred_at) >= datetime(?) AND datetime(w.occurred_at) < datetime(?)
         ORDER BY w.occurred_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT b.id, b.category, b.observation, b.action_taken as actionTaken,
                b.strata_outcome as outcome, COALESCE(b.occurred_at, b.created_at) as occurredAt,
                b.follow_up_date as followUpDate, l.name as locationName,
                u.unit_number as unitNumber
         FROM bylaw_observations b
         LEFT JOIN locations l ON l.id = b.location_id
         LEFT JOIN units u ON u.id = b.unit_id
         WHERE b.property_id = ?
           AND datetime(COALESCE(b.occurred_at, b.created_at)) >= datetime(?)
           AND datetime(COALESCE(b.occurred_at, b.created_at)) < datetime(?)
         ORDER BY COALESCE(b.occurred_at, b.created_at)`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT r.id, r.request_type as requestType, r.device_type_requested as deviceTypeRequested,
                r.quantity_requested as quantityRequested, r.request_reason as requestReason,
                r.status, r.created_at as createdAt, r.requested_collection_date as requestedCollectionDate,
                u.unit_number as unitNumber
         FROM access_device_requests r
         LEFT JOIN units u ON u.id = r.unit_id
         WHERE r.property_id = ?
           AND datetime(r.created_at) >= datetime(?) AND datetime(r.created_at) < datetime(?)
         ORDER BY r.created_at`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT i.id, i.inspection_type as inspectionType, i.status,
                i.exceptions_count as exceptionsCount, i.started_at as startedAt,
                i.finished_at as finishedAt, i.specific_location as specificLocation,
                l.name as locationName, t.name as templateName
         FROM inspections i
         JOIN inspection_templates t ON t.id = i.template_id
         LEFT JOIN locations l ON l.id = i.location_id
         WHERE i.property_id = ?
           AND datetime(COALESCE(i.finished_at, i.started_at)) >= datetime(?)
           AND datetime(COALESCE(i.finished_at, i.started_at)) < datetime(?)
         ORDER BY COALESCE(i.finished_at, i.started_at)`,
      )
      .bind(propertyId, start, end)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, title, task_type as taskType, due_at as dueAt, priority, status,
                linked_entity_type as linkedEntityType, linked_entity_id as linkedEntityId
         FROM tasks
         WHERE property_id = ? AND status IN ('open','in_progress')
         ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END, due_at
         LIMIT 100`,
      )
      .bind(propertyId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT d.id, d.category, d.description, d.status, d.risk_level as riskLevel,
                d.next_follow_up_date as nextFollowUpDate, l.name as locationName,
                u.unit_number as unitNumber
         FROM defects d
         LEFT JOIN locations l ON l.id = d.location_id
         LEFT JOIN units u ON u.id = d.unit_id
         WHERE d.property_id = ? AND d.status != 'closed'
         ORDER BY CASE d.risk_level WHEN 'immediate_danger' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                  d.next_follow_up_date, d.created_at
         LIMIT 200`,
      )
      .bind(propertyId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as totalValue
         FROM quotes WHERE property_id = ? AND status = 'submitted'`,
      )
      .bind(propertyId)
      .first<Record<string, unknown>>(),
  ]);

  if (!property) throw new HttpError(404, 'PROPERTY_NOT_FOUND', 'Property not found.');

  const activityRows = activities.results ?? [];
  const activityByCategory = (category: string) => activityRows.filter((row) => row.category === category).map(activityItem);

  const maintenanceItems: ReportItem[] = [
    ...activityByCategory('maintenance_repairs'),
    ...(defects.results ?? []).map((row) => ({
      date: dateLabel(row.createdAt),
      summary: `${titleCase(String(row.category))}: ${String(row.description ?? '')}`,
      actions: textOrNull(row.workCompletedNotes) ?? textOrNull(row.immediateResponse),
      status: textOrNull(row.status),
      sourceType: 'defect',
      sourceId: String(row.id),
      priority: textOrNull(row.riskLevel) ?? textOrNull(row.priority),
      location: textOrNull(row.locationName) ?? textOrNull(row.specificLocation),
      unitNumber: textOrNull(row.unitNumber),
    })),
    ...(workOrders.results ?? []).map((row) => ({
      date: dateLabel(row.scheduledAt ?? row.createdAt),
      summary: `Work order: ${String(row.scope ?? '')}${row.contractorName ? ` (${String(row.contractorName)})` : ''}`,
      actions: textOrNull(row.workPerformed) ?? textOrNull(row.findings) ?? textOrNull(row.recommendations),
      status: textOrNull(row.status),
      sourceType: 'work_order',
      sourceId: String(row.id),
      location: textOrNull(row.locationName),
    })),
    ...(inspections.results ?? [])
      .filter((row) => Number(row.exceptionsCount ?? 0) > 0)
      .map((row) => ({
        date: dateLabel(row.finishedAt ?? row.startedAt),
        summary: `${String(row.templateName ?? 'Inspection')} identified ${Number(row.exceptionsCount ?? 0)} exception(s).`,
        actions: 'Exceptions were recorded through the inspection and defect workflow.',
        status: textOrNull(row.status),
        sourceType: 'inspection',
        sourceId: String(row.id),
        location: textOrNull(row.locationName) ?? textOrNull(row.specificLocation),
      })),
  ];

  const securityItems: ReportItem[] = [
    ...activityByCategory('building_security'),
    ...(incidents.results ?? []).map((row) => ({
      date: dateLabel(row.incidentAt),
      summary: `${titleCase(String(row.category))}: ${String(row.description ?? '')}`,
      actions: textOrNull(row.resolution) ?? textOrNull(row.actionsTaken),
      status: textOrNull(row.status),
      sourceType: 'incident',
      sourceId: String(row.id),
      priority: textOrNull(row.severity),
      location: textOrNull(row.locationName),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const moveItems: ReportItem[] = [
    ...activityByCategory('resident_movement'),
    ...(moves.results ?? []).map((row) => ({
      date: dateLabel(row.requestedAt),
      summary: `${titleCase(String(row.moveType))}${row.unitNumber ? ` - Unit ${String(row.unitNumber)}` : ''}${row.applicantName ? ` - ${String(row.applicantName)}` : ''}`,
      actions: textOrNull(row.postMoveNotes) ?? textOrNull(row.specialRequirements),
      status: textOrNull(row.status),
      sourceType: 'move_booking',
      sourceId: String(row.id),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const inductionItems: ReportItem[] = [
    ...activityByCategory('resident_induction'),
    ...(onboarding.results ?? []).map((row) => ({
      date: dateLabel(row.completedAt ?? row.moveInDate),
      summary: `Resident induction${row.unitNumber ? ` - Unit ${String(row.unitNumber)}` : ''}${row.residentName ? ` - ${String(row.residentName)}` : ''}`,
      actions: textOrNull(row.outstandingMatters) ?? textOrNull(row.questionsRaised) ?? 'Induction modules and building rules recorded.',
      status: textOrNull(row.status),
      sourceType: 'resident_onboarding',
      sourceId: String(row.id),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const wasteItems: ReportItem[] = [
    ...activityByCategory('waste_management'),
    ...(waste.results ?? []).map((row) => ({
      date: dateLabel(row.occurredAt),
      summary: `${titleCase(String(row.activity ?? row.eventType))} - ${titleCase(String(row.wasteType ?? 'waste'))}${row.quantity !== null && row.quantity !== undefined ? ` (${String(row.quantity)})` : ''}`,
      actions: textOrNull(row.actionTaken) ?? textOrNull(row.notes),
      status: Number(row.issueIdentified ?? 0) ? 'exception' : 'completed',
      sourceType: 'waste_event',
      sourceId: String(row.id),
      location: textOrNull(row.locationName),
      unitNumber: textOrNull(row.responsibleUnitNumber),
    })),
  ];

  const contractorItems: ReportItem[] = [
    ...activityByCategory('contractor_management'),
    ...(contractors.results ?? []).map((row) => ({
      date: dateLabel(row.signInAt),
      summary: `${String(row.contractorName ?? 'Contractor')}: ${String(row.purpose ?? 'Site attendance')}`,
      actions: textOrNull(row.workDescription) ?? textOrNull(row.additionalDefects),
      status: textOrNull(row.status),
      sourceType: 'contractor_attendance',
      sourceId: String(row.id),
      location: textOrNull(row.areaAccessed),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const accessItems: ReportItem[] = [
    ...activityByCategory('access_control'),
    ...(accessRequests.results ?? []).map((row) => ({
      date: dateLabel(row.createdAt),
      summary: `${titleCase(String(row.deviceTypeRequested ?? row.requestType))} request${row.unitNumber ? ` - Unit ${String(row.unitNumber)}` : ''}${row.quantityRequested ? ` - Qty ${String(row.quantityRequested)}` : ''}`,
      actions: textOrNull(row.requestReason),
      status: textOrNull(row.status),
      sourceType: 'access_device_request',
      sourceId: String(row.id),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const bylawItems: ReportItem[] = (bylaws.results ?? []).map((row) => ({
    date: dateLabel(row.occurredAt),
    summary: `${titleCase(String(row.category))}: ${String(row.observation ?? '')}`,
    actions: textOrNull(row.actionTaken),
    status: textOrNull(row.outcome),
    sourceType: 'bylaw_observation',
    sourceId: String(row.id),
    location: textOrNull(row.locationName),
    unitNumber: textOrNull(row.unitNumber),
  }));

  const outstandingItems: ReportItem[] = [
    ...(outstandingTasks.results ?? []).map((row) => ({
      date: dateLabel(row.dueAt),
      summary: String(row.title ?? 'Outstanding task'),
      actions: null,
      status: textOrNull(row.status),
      sourceType: 'task',
      sourceId: String(row.id),
      priority: textOrNull(row.priority),
    })),
    ...(outstandingDefects.results ?? []).map((row) => ({
      date: dateLabel(row.nextFollowUpDate),
      summary: `${titleCase(String(row.category))}: ${String(row.description ?? '')}`,
      actions: null,
      status: textOrNull(row.status),
      sourceType: 'defect',
      sourceId: String(row.id),
      priority: textOrNull(row.riskLevel),
      location: textOrNull(row.locationName),
      unitNumber: textOrNull(row.unitNumber),
    })),
  ];

  const sections: Record<MonthlyReportSection, MonthlySection> = {
    executive_summary: section('executive_summary', 'Executive Summary', []),
    building_maintenance_repairs: section('building_maintenance_repairs', 'Building Maintenance & Repairs', maintenanceItems),
    building_security: section('building_security', 'Building Security', securityItems),
    cleaning: section('cleaning', 'Cleaning', activityByCategory('cleaning')),
    gardening_grounds: section('gardening_grounds', 'Gardening & Grounds Maintenance', activityByCategory('gardening_grounds')),
    resident_movements: section('resident_movements', 'Movements of Residents', moveItems),
    resident_inductions: section('resident_inductions', 'Inductions - New Residents', inductionItems),
    waste_management: section('waste_management', 'Waste Management', wasteItems),
    contractor_activity: section('contractor_activity', 'Contractor Activity', contractorItems),
    access_devices_keys: section('access_devices_keys', 'Access Devices & Keys', accessItems),
    bylaw_issues: section('bylaw_issues', 'By-law Issues', bylawItems),
    leave_plans: section('leave_plans', 'Leave Plans', activityByCategory('leave_plan')),
    other: section(
      'other',
      'Other',
      activityRows
        .filter((row) => ['common_property', 'administration', 'other'].includes(String(row.category)))
        .map(activityItem),
    ),
    outstanding_actions: section('outstanding_actions', 'Outstanding Actions', outstandingItems),
  };

  const wasteMinutes = (waste.results ?? []).reduce((total, row) => total + Number(row.minutesSpent ?? 0), 0);
  const activityMinutes = activityRows.reduce((total, row) => total + Number(row.minutesSpent ?? 0), 0);
  const highRiskDefects = (defects.results ?? []).filter((row) => ['high', 'immediate_danger'].includes(String(row.riskLevel))).length;
  const openDefects = (outstandingDefects.results ?? []).length;

  return {
    contract: 'proinspect-building-management.monthly-report',
    contractVersion: '1.0.0',
    property,
    propertyId,
    month,
    period: { start, end, timezone: 'Australia/Perth' },
    title: `${String(property.name)} Building Management Report - ${month}`,
    metrics: {
      activitiesRecorded: activityRows.length,
      activityMinutes,
      defectsRaised: defects.results?.length ?? 0,
      highRiskDefects,
      openDefects,
      workOrdersCreated: workOrders.results?.length ?? 0,
      contractorVisits: contractors.results?.length ?? 0,
      movesAndDeliveries: moves.results?.length ?? 0,
      residentInductions: onboarding.results?.length ?? 0,
      incidents: incidents.results?.length ?? 0,
      wasteActivities: waste.results?.length ?? 0,
      wasteMinutes,
      bylawObservations: bylaws.results?.length ?? 0,
      accessDeviceRequests: accessRequests.results?.length ?? 0,
      inspectionsCompleted: inspections.results?.length ?? 0,
      inspectionExceptions: (inspections.results ?? []).reduce((total, row) => total + Number(row.exceptionsCount ?? 0), 0),
      approvalsAwaitingDecision: Number(approvalsPending?.count ?? 0),
      approvalValueAwaitingDecision: Number(approvalsPending?.totalValue ?? 0),
      outstandingTasks: outstandingTasks.results?.length ?? 0,
    },
    sections,
    generatedAt: new Date().toISOString(),
  };
}

async function loadDraft(db: D1Database, propertyId: string, month: string) {
  const row = await db
    .prepare(`SELECT * FROM monthly_report_drafts WHERE property_id = ? AND report_month = ?`)
    .bind(propertyId, month)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: row.id,
    propertyId: row.property_id,
    month: row.report_month,
    status: row.status,
    title: row.title,
    commentary: parseCommentary(row.section_commentary_json),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    finalisedAt: row.finalised_at,
  };
}

// Live report payload, generated from the operational records without re-keying.
reportRoutes.get('/reports/monthly', async (c) => {
  const user = requireCapability(c, 'report.generate');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const month = validateMonth(c.req.query('month'));
  const [report, draft] = await Promise.all([
    buildMonthlyReport(c.env.DB, propertyId, month),
    loadDraft(c.env.DB, propertyId, month),
  ]);
  return c.json({ ...report, draft, commentary: draft?.commentary ?? {} });
});

reportRoutes.get('/reports/monthly/draft', async (c) => {
  const user = requireCapability(c, 'report.generate');
  const propertyId = resolvePropertyId(user, c.req.query('propertyId'));
  const month = validateMonth(c.req.query('month'));
  return c.json(await loadDraft(c.env.DB, propertyId, month));
});

reportRoutes.post('/reports/monthly/draft/generate', async (c) => {
  const user = requireCapability(c, 'report.edit');
  const body = await c.req.json<{ propertyId?: string; month?: string }>().catch(() => ({}));
  const propertyId = resolvePropertyId(user, body.propertyId);
  const month = validateMonth(body.month);
  const report = await buildMonthlyReport(c.env.DB, propertyId, month);
  const existing = await c.env.DB
    .prepare(`SELECT id, section_commentary_json as commentary FROM monthly_report_drafts WHERE property_id = ? AND report_month = ?`)
    .bind(propertyId, month)
    .first<{ id: string; commentary: string }>();
  const id = existing?.id ?? newId('report');

  await c.env.DB.prepare(
    `INSERT INTO monthly_report_drafts
      (id, property_id, report_month, status, title, section_commentary_json,
       report_snapshot_json, generated_by_user_id, generated_at, updated_by_user_id, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
     ON CONFLICT(property_id, report_month) DO UPDATE SET
       status = CASE WHEN monthly_report_drafts.status = 'finalised' THEN monthly_report_drafts.status ELSE 'draft' END,
       title = excluded.title,
       report_snapshot_json = excluded.report_snapshot_json,
       generated_by_user_id = excluded.generated_by_user_id,
       generated_at = datetime('now'),
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = datetime('now')`,
  )
    .bind(
      id,
      propertyId,
      month,
      report.title,
      existing?.commentary ?? '{}',
      JSON.stringify(report),
      user.id,
      user.id,
    )
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: existing ? 'update' : 'create',
    entityType: 'monthly_report_draft',
    entityId: id,
    after: { month, generatedAt: report.generatedAt },
  });
  return c.json({ id, report, draft: await loadDraft(c.env.DB, propertyId, month) }, existing ? 200 : 201);
});

reportRoutes.put('/reports/monthly/draft', async (c) => {
  const user = requireCapability(c, 'report.edit');
  const body = await c.req.json<{
    propertyId?: string;
    month?: string;
    title?: string;
    commentary?: Record<string, string>;
  }>();
  const propertyId = resolvePropertyId(user, body.propertyId);
  const month = validateMonth(body.month);
  const commentary = body.commentary ?? {};
  for (const [key, value] of Object.entries(commentary)) {
    if (!MONTHLY_REPORT_SECTIONS.includes(key as MonthlyReportSection)) {
      throw new HttpError(400, 'INVALID_REPORT_SECTION', `Unknown report section '${key}'.`);
    }
    if (typeof value !== 'string' || value.length > 12000) {
      throw new HttpError(400, 'INVALID_COMMENTARY', `Commentary for '${key}' must be text under 12,000 characters.`);
    }
  }
  const existing = await c.env.DB
    .prepare(`SELECT id, status FROM monthly_report_drafts WHERE property_id = ? AND report_month = ?`)
    .bind(propertyId, month)
    .first<{ id: string; status: string }>();
  if (!existing) {
    throw new HttpError(409, 'DRAFT_NOT_GENERATED', 'Generate the monthly report draft before editing commentary.');
  }
  if (existing.status === 'finalised') {
    throw new HttpError(409, 'REPORT_FINALISED', 'A finalised report cannot be edited.');
  }
  await c.env.DB.prepare(
    `UPDATE monthly_report_drafts
     SET title = COALESCE(?, title), section_commentary_json = ?,
         updated_by_user_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(body.title?.trim() || null, JSON.stringify(commentary), user.id, existing.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'update',
    entityType: 'monthly_report_draft',
    entityId: existing.id,
    after: { month, title: body.title, commentarySections: Object.keys(commentary) },
  });
  return c.json(await loadDraft(c.env.DB, propertyId, month));
});

reportRoutes.post('/reports/monthly/draft/finalise', async (c) => {
  const user = requireCapability(c, 'report.finalise');
  const body = await c.req.json<{ propertyId?: string; month?: string }>();
  const propertyId = resolvePropertyId(user, body.propertyId);
  const month = validateMonth(body.month);
  const existing = await c.env.DB
    .prepare(`SELECT id, status FROM monthly_report_drafts WHERE property_id = ? AND report_month = ?`)
    .bind(propertyId, month)
    .first<{ id: string; status: string }>();
  if (!existing) throw new HttpError(409, 'DRAFT_NOT_GENERATED', 'Generate the monthly report draft before finalising.');
  if (existing.status === 'finalised') return c.json(await loadDraft(c.env.DB, propertyId, month));

  const report = await buildMonthlyReport(c.env.DB, propertyId, month);
  await c.env.DB.prepare(
    `UPDATE monthly_report_drafts
     SET status = 'finalised', report_snapshot_json = ?, generated_at = datetime('now'),
         generated_by_user_id = ?, updated_by_user_id = ?, updated_at = datetime('now'),
         finalised_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(JSON.stringify(report), user.id, user.id, existing.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'monthly_report_draft',
    entityId: existing.id,
    after: { month, status: 'finalised' },
  });
  return c.json({ draft: await loadDraft(c.env.DB, propertyId, month), report });
});
