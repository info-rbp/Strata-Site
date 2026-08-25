import { newId } from './ids';

export interface AuditParams {
  propertyId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: 'create' | 'update' | 'delete' | 'approve' | 'status_change' | 'issue' | 'verify' | 'login';
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

// Every create/update/delete/approval/status change on a critical record must
// produce an audit event (Build Guide §20). Call this from every mutating
// route handler — never skip it "to save time".
export async function recordAudit(db: D1Database, params: AuditParams): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_events
        (id, property_id, actor_user_id, actor_role, action, entity_type, entity_id, before_value, after_value, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('audit'),
      params.propertyId ?? null,
      params.actorUserId ?? null,
      params.actorRole ?? null,
      params.action,
      params.entityType,
      params.entityId,
      params.before !== undefined ? JSON.stringify(params.before) : null,
      params.after !== undefined ? JSON.stringify(params.after) : null,
      params.reason ?? null,
    )
    .run();
}
