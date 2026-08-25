import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, HttpError } from '../middleware/auth';

export const reportRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Section 17.1: monthly Building Manager report generated from live
// operational data, no re-keying. Returns structured JSON — a docs/PDF
// export can be layered on later (Phase 2/3) without changing this endpoint.
reportRoutes.get('/reports/monthly', async (c) => {
  const user = requireCapability(c, 'report.generate');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7); // YYYY-MM
  const db = c.env.DB;
  const monthFilter = `strftime('%Y-%m', created_at) = ?`;

  const [defects, workOrders, contractors, moves, incidents, waste, bylaws, approvalsPending, upcomingWork] =
    await Promise.all([
      db
        .prepare(`SELECT category, status, risk_level as riskLevel, created_at as createdAt FROM defects WHERE property_id = ? AND ${monthFilter}`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT id, scope, status FROM work_orders WHERE property_id = ? AND strftime('%Y-%m', created_at) = ?`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(
          `SELECT a.id, ctr.company_name as contractorName, a.sign_in_at as signInAt, a.service_report_r2_key as hasReport
           FROM contractor_attendance a JOIN contractors ctr ON ctr.id = a.contractor_id
           WHERE a.property_id = ? AND strftime('%Y-%m', a.sign_in_at) = ?`,
        )
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT move_type as moveType, status FROM move_bookings WHERE property_id = ? AND strftime('%Y-%m', created_at) = ?`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT category, severity, status FROM incidents WHERE property_id = ? AND strftime('%Y-%m', created_at) = ?`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT exception_category as category, minutes_spent as minutesSpent FROM waste_events WHERE property_id = ? AND event_type = 'exception' AND strftime('%Y-%m', occurred_at) = ?`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT category, strata_outcome as outcome FROM bylaw_observations WHERE property_id = ? AND strftime('%Y-%m', created_at) = ?`)
        .bind(propertyId, month)
        .all(),
      db
        .prepare(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as totalValue FROM quotes WHERE property_id = ? AND status = 'submitted'`)
        .bind(propertyId)
        .first(),
      db
        .prepare(`SELECT title, due_at as dueAt FROM tasks WHERE property_id = ? AND status IN ('open','in_progress') AND due_at IS NOT NULL ORDER BY due_at LIMIT 10`)
        .bind(propertyId)
        .all(),
    ]);

  return c.json({
    propertyId,
    month,
    sections: {
      maintenanceDefects: defects.results ?? [],
      workOrders: workOrders.results ?? [],
      contractors: contractors.results ?? [],
      residentMovesInductions: moves.results ?? [],
      securityIncidents: incidents.results ?? [],
      waste: waste.results ?? [],
      bylawObservations: bylaws.results ?? [],
      approvalsAwaitingDecision: approvalsPending ?? {},
      upcomingWork: upcomingWork.results ?? [],
    },
    generatedAt: new Date().toISOString(),
    editableCommentary: '', // BM adds commentary before finalisation (Section 17.1)
  });
});
