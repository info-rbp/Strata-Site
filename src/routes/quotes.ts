import { Hono } from 'hono';
import type { AppBindings, AppVariables } from '../middleware/auth';
import { requireCapability, assertPropertyAccess, HttpError } from '../middleware/auth';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { notifyRole } from '../lib/notify';

export const quoteRoutes = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Section 16: Defect/planned work -> Quote required -> Quotes uploaded ->
// BM recommendation -> Approval queue -> Approved/Declined/More info ->
// Contractor scheduled.

quoteRoutes.get('/quotes', async (c) => {
  const user = requireCapability(c, 'quote.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  const status = c.req.query('status');
  let sql = `SELECT q.*, ctr.company_name as contractorName FROM quotes q
             LEFT JOIN contractors ctr ON ctr.id = q.contractor_id WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND q.property_id = ?`;
    binds.push(propertyId);
  }
  if (status) {
    sql += ` AND q.status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY q.created_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});

quoteRoutes.post('/quotes', async (c) => {
  const user = requireCapability(c, 'quote.manage');
  const body = await c.req.json<{
    propertyId?: string;
    defectId?: string;
    contractorId?: string;
    amount: number;
    documentR2Key?: string;
  }>();
  const propertyId = user.propertyScope ?? body.propertyId;
  if (!propertyId) throw new HttpError(400, 'PROPERTY_REQUIRED', 'propertyId is required.');
  const id = newId('quote');
  await c.env.DB.prepare(
    `INSERT INTO quotes (id, property_id, defect_id, contractor_id, amount, document_r2_key) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, propertyId, body.defectId ?? null, body.contractorId ?? null, body.amount, body.documentR2Key ?? null)
    .run();

  await recordAudit(c.env.DB, {
    propertyId,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'create',
    entityType: 'quote',
    entityId: id,
    after: body,
  });

  return c.json({ id, status: 'submitted' }, 201);
});

// BM adds a recommendation and routes to Strata approval queue.
quoteRoutes.post('/quotes/:id/recommend', async (c) => {
  const user = requireCapability(c, 'quote.manage');
  const body = await c.req.json<{ recommendation: string }>();
  const quote = await c.env.DB.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
  }>();
  if (!quote) return c.json({ error: { code: 'NOT_FOUND', message: 'Quote not found.' } }, 404);
  assertPropertyAccess(user, quote.property_id);
  await c.env.DB.prepare(`UPDATE quotes SET status = 'recommended', bm_recommendation = ? WHERE id = ?`)
    .bind(body.recommendation, quote.id)
    .run();

  await notifyRole(c.env.DB, {
    propertyId: quote.property_id,
    role: 'strata_manager',
    title: 'Quote awaiting approval decision',
    linkedEntityType: 'quote',
    linkedEntityId: quote.id,
  });

  return c.json({ id: quote.id, status: 'recommended' });
});

// Strata decision (Section 16 / capability approval.decide).
quoteRoutes.post('/quotes/:id/decide', async (c) => {
  const user = requireCapability(c, 'approval.decide');
  const body = await c.req.json<{
    decision: 'approved' | 'declined' | 'more_information';
    comments?: string;
    conditions?: string;
  }>();
  const quote = await c.env.DB.prepare(`SELECT * FROM quotes WHERE id = ?`).bind(c.req.param('id')).first<{
    id: string;
    property_id: string;
    defect_id: string | null;
    amount: number;
  }>();
  if (!quote) return c.json({ error: { code: 'NOT_FOUND', message: 'Quote not found.' } }, 404);
  assertPropertyAccess(user, quote.property_id);

  const statusMap = { approved: 'approved', declined: 'declined', more_information: 'more_info_requested' } as const;
  await c.env.DB.prepare(`UPDATE quotes SET status = ? WHERE id = ?`).bind(statusMap[body.decision], quote.id).run();

  const approvalId = newId('appr');
  await c.env.DB.prepare(
    `INSERT INTO approvals (id, property_id, quote_id, defect_id, decision, decision_maker_user_id, amount, comments, conditions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      approvalId,
      quote.property_id,
      quote.id,
      quote.defect_id,
      body.decision,
      user.id,
      quote.amount,
      body.comments ?? null,
      body.conditions ?? null,
    )
    .run();

  if (body.decision === 'approved' && quote.defect_id) {
    await c.env.DB.prepare(`UPDATE defects SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_approval'`)
      .bind(quote.defect_id)
      .run();
  }

  await recordAudit(c.env.DB, {
    propertyId: quote.property_id,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'approve',
    entityType: 'quote',
    entityId: quote.id,
    after: { decision: body.decision, amount: quote.amount },
  });

  return c.json({ approvalId, quoteStatus: statusMap[body.decision] });
});

quoteRoutes.get('/approvals', async (c) => {
  const user = requireCapability(c, 'quote.read');
  const propertyId = user.propertyScope ?? c.req.query('propertyId');
  let sql = `SELECT * FROM approvals WHERE 1=1`;
  const binds: unknown[] = [];
  if (propertyId) {
    sql += ` AND property_id = ?`;
    binds.push(propertyId);
  }
  sql += ` ORDER BY decided_at DESC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json(results ?? []);
});
