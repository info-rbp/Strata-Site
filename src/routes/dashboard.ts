import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { recordAudit } from '../lib/audit';

export const dashboardRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Building Manager "Today" command centre (Section 6.1).
dashboardRoutes.get('/dashboard/bm-today', async (c) => {
  const user = requireCapability(c, 'dashboard.bm.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  assertPropertyAccess(user, propertyId);
  const db = c.env.DB;

  const [urgent, todaysContractors, residentActivity, scheduledTasks, outstanding, overdueTasks] = await Promise.all([
    db
      .prepare(
        `SELECT id, category, description, risk_level as riskLevel, status FROM defects
         WHERE property_id = ? AND risk_level IN ('high','immediate_danger') AND status != 'closed'
         ORDER BY created_at DESC LIMIT 10`,
      )
      .bind(propertyId)
      .all(),
    db
      .prepare(
        `SELECT a.id, a.sign_in_at as signInAt, a.status, ctr.company_name as contractorName
         FROM contractor_attendance a JOIN contractors ctr ON ctr.id = a.contractor_id
         WHERE a.property_id = ? AND date(a.sign_in_at) = date('now')
         ORDER BY a.sign_in_at DESC`,
      )
      .bind(propertyId)
      .all(),
    db
      .prepare(
        `SELECT id, move_type as moveType, requested_at as requestedAt, status FROM move_bookings
         WHERE property_id = ? AND date(requested_at) = date('now')
         ORDER BY requested_at`,
      )
      .bind(propertyId)
      .all(),
    db
      .prepare(
        `SELECT id, title, task_type as taskType, due_at as dueAt, priority, status FROM tasks
         WHERE property_id = ? AND status IN ('open','in_progress') AND (due_at IS NULL OR date(due_at) <= date('now'))
         ORDER BY priority DESC, due_at LIMIT 20`,
      )
      .bind(propertyId)
      .all(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM defects WHERE property_id = ? AND status NOT IN ('closed')) as openDefects,
           (SELECT COUNT(*) FROM quotes WHERE property_id = ? AND status = 'submitted') as quotesAwaitingApproval,
           (SELECT COUNT(*) FROM work_orders WHERE property_id = ? AND status = 'completed') as workOrdersAwaitingVerification`,
      )
      .bind(propertyId, propertyId, propertyId)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE property_id = ? AND status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < datetime('now')`,
      )
      .bind(propertyId)
      .first<{ count: number }>(),
  ]);

  return c.json({
    urgent: urgent.results ?? [],
    todaysContractors: todaysContractors.results ?? [],
    residentActivity: residentActivity.results ?? [],
    scheduledTasks: scheduledTasks.results ?? [],
    outstanding: outstanding ?? {},
    overdueTaskCount: overdueTasks?.count ?? 0,
  });
});

// Strata dashboard metrics (Section 17.2).
dashboardRoutes.get('/dashboard/strata', async (c) => {
  const user = requireCapability(c, 'dashboard.strata.read');
  const propertyId = c.req.query('propertyId'); // strata may omit -> all properties
  const db = c.env.DB;
  const propFilter = propertyId ? `AND property_id = ?` : '';
  const binds = propertyId ? [propertyId] : [];

  const [defects, approvals, contractorsStat, residents, security, waste, operations] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*) as open,
           SUM(CASE WHEN risk_level IN ('high','immediate_danger') THEN 1 ELSE 0 END) as highRisk,
           SUM(CASE WHEN due_date IS NOT NULL AND due_date < datetime('now') AND status != 'closed' THEN 1 ELSE 0 END) as overdue
         FROM defects WHERE status != 'closed' ${propFilter}`,
      )
      .bind(...binds)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) as awaitingDecision, COALESCE(SUM(amount),0) as totalValue FROM quotes WHERE status = 'submitted' ${propFilter}`,
      )
      .bind(...binds)
      .first(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM contractor_attendance WHERE status != 'closed' ${propFilter}) as openAttendance,
           (SELECT COUNT(*) FROM contractor_attendance WHERE service_report_r2_key IS NULL AND status = 'closed' ${propFilter}) as missingReports`,
      )
      .bind(...binds, ...binds)
      .first(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM move_bookings WHERE strftime('%Y-%m', requested_at) = strftime('%Y-%m', 'now') ${propFilter}) as movesThisMonth,
           (SELECT COUNT(*) FROM move_bookings WHERE status = 'pending_approval' ${propFilter}) as pendingApproval`,
      )
      .bind(...binds, ...binds)
      .first(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM incidents WHERE status != 'closed' ${propFilter}) as openIncidents,
           (SELECT COUNT(*) FROM access_devices WHERE status IN ('lost','stolen') ${propFilter}) as lostDevices`,
      )
      .bind(...binds, ...binds)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) as exceptions FROM waste_events WHERE event_type = 'exception' ${propFilter}`,
      )
      .bind(...binds)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) as overdueTasks FROM tasks WHERE status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < datetime('now') ${propFilter}`,
      )
      .bind(...binds)
      .first(),
  ]);

  return c.json({ defects, approvals, contractors: contractorsStat, residents, security, waste, operations });
});

// --- Tasks ---------------------------------------------------------------

dashboardRoutes.get('/tasks', async (c) => {
  const user = requireCapability(c, 'task.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const status = c.req.query('status');
  let sql = `SELECT * FROM tasks WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  if (status) {
    sql += ` AND status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END, due_at LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

dashboardRoutes.post('/tasks/:id/complete', async (c) => {
  const user = requireCapability(c, 'task.manage');
  const body = await c.req.json<{ completionEvidence?: Record<string, unknown> }>().catch(() => ({}));
  const task = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!task) return c.json({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404);
  assertPropertyAccess(user, task.property_id);
  await c.env.DB.prepare(
    `UPDATE tasks SET status = 'completed', completion_evidence = ?, completed_at = datetime('now') WHERE id = ?`,
  )
    .bind(body.completionEvidence ? JSON.stringify(body.completionEvidence) : null, task.id)
    .run();
  return c.json({ id: task.id, status: 'completed' });
});

// --- Calendar --------------------------------------------------------

dashboardRoutes.get('/calendar', async (c) => {
  const user = requireCapability(c, 'calendar.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM calendar_events WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY starts_at LIMIT 200`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

// --- Notices -----------------------------------------------------------

dashboardRoutes.get('/notices', async (c) => {
  const user = requireCapability(c, 'notice.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM notices WHERE published_at IS NOT NULL`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY published_at DESC LIMIT 50`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

dashboardRoutes.post('/notices', async (c) => {
  const user = requireCapability(c, 'notice.manage');
  const body = await c.req.json<{ propertyId?: string; title: string; body: string; audience?: string }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO notices (id, property_id, title, body, audience, published_by_user_id, published_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(id, propertyId, body.title, body.body, body.audience ?? 'all', user.id)
    .run();
  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'notice',
    entityId: id,
    after: body,
  });
  return c.json({ id }, 201);
});

// --- Audit log (Strata / admin) ----------------------------------------

dashboardRoutes.get('/audit', async (c) => {
  const user = requireCapability(c, 'audit.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const entityType = c.req.query('entityType');
  const entityId = c.req.query('entityId');
  let sql = `SELECT * FROM audit_events WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  if (entityType) {
    sql += ` AND entity_type = ?`;
    binds.push(entityType);
  }
  if (entityId) {
    sql += ` AND entity_id = ?`;
    binds.push(entityId);
  }
  sql += ` ORDER BY occurred_at DESC LIMIT 300`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});
