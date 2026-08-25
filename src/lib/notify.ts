import { newId } from './ids';

export async function notifyUser(
  db: D1Database,
  params: {
    userId: string;
    propertyId?: string | null;
    title: string;
    body?: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, property_id, title, body, linked_entity_type, linked_entity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('notif'),
      params.userId,
      params.propertyId ?? null,
      params.title,
      params.body ?? null,
      params.linkedEntityType ?? null,
      params.linkedEntityId ?? null,
    )
    .run();
}

// Notify every user holding a given role at a property (e.g. all Building
// Managers). Used for role-based alerts like "high-risk defect reported".
export async function notifyRole(
  db: D1Database,
  params: {
    propertyId: string;
    role: string;
    title: string;
    body?: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
  },
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id FROM users
       WHERE role = ? AND status = 'active' AND (property_scope IS NULL OR property_scope = ?)`,
    )
    .bind(params.role, params.propertyId)
    .all<{ id: string }>();
  for (const row of results ?? []) {
    await notifyUser(db, {
      userId: row.id,
      propertyId: params.propertyId,
      title: params.title,
      body: params.body,
      linkedEntityType: params.linkedEntityType,
      linkedEntityId: params.linkedEntityId,
    });
  }
}

export async function createTask(
  db: D1Database,
  params: {
    propertyId: string;
    title: string;
    taskType: string;
    linkedEntityType?: string;
    linkedEntityId?: string;
    dueAt?: string | null;
    priority?: 'normal' | 'urgent';
    assigneeUserId?: string | null;
    assigneeRole?: string | null;
  },
): Promise<string> {
  const id = newId('task');
  await db
    .prepare(
      `INSERT INTO tasks
        (id, property_id, title, task_type, linked_entity_type, linked_entity_id, due_at, priority, assignee_user_id, assignee_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      params.propertyId,
      params.title,
      params.taskType,
      params.linkedEntityType ?? null,
      params.linkedEntityId ?? null,
      params.dueAt ?? null,
      params.priority ?? 'normal',
      params.assigneeUserId ?? null,
      params.assigneeRole ?? null,
    )
    .run();
  return id;
}
