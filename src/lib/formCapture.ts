import { FORM_SCHEMA_VERSION, type OperationalFormType } from '../domain/operationalForms';
import { newId } from './ids';

export interface CaptureOperationalFormParams {
  propertyId: string;
  formType: OperationalFormType;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  submittedByUserId?: string | null;
  clientSubmissionId?: string | null;
  schemaVersion?: string;
  eventType?: 'created' | 'updated' | 'completed';
}

export interface CaptureOperationalFormResult {
  submissionId: string;
  outboxId: string;
  dedupeKey: string;
  duplicate: boolean;
}

export interface ExistingCapturedEntity {
  submissionId: string;
  entityType: string;
  entityId: string;
  formType: OperationalFormType;
  submittedAt: string;
}

/**
 * Used before creating a business record. Mobile browsers may replay queued
 * submissions after a weak connection; a stable clientSubmissionId makes that
 * replay safe instead of producing duplicate defects, incidents or diary rows.
 */
export async function findExistingCapturedEntity(
  db: D1Database,
  propertyId: string,
  clientSubmissionId?: string | null,
): Promise<ExistingCapturedEntity | null> {
  const clientId = clientSubmissionId?.trim();
  if (!clientId) return null;
  return db
    .prepare(
      `SELECT id as submissionId, entity_type as entityType, entity_id as entityId,
              form_type as formType, submitted_at as submittedAt
       FROM form_submissions
       WHERE property_id = ? AND client_submission_id = ?
       LIMIT 1`,
    )
    .bind(propertyId, clientId)
    .first<ExistingCapturedEntity>();
}

/**
 * Archives the exact submitted payload and adds a provider-neutral integration
 * event in one D1 batch. The Google Sheets connector can later consume the
 * outbox without changing operational route contracts or scraping tables.
 */
export async function captureOperationalForm(
  db: D1Database,
  params: CaptureOperationalFormParams,
): Promise<CaptureOperationalFormResult> {
  const schemaVersion = params.schemaVersion ?? FORM_SCHEMA_VERSION;
  const clientSubmissionId = params.clientSubmissionId?.trim() || null;

  if (clientSubmissionId) {
    const existing = await db
      .prepare(
        `SELECT fs.id as submissionId, io.id as outboxId, io.dedupe_key as dedupeKey
         FROM form_submissions fs
         LEFT JOIN integration_outbox io ON io.form_submission_id = fs.id
         WHERE fs.property_id = ? AND fs.client_submission_id = ?
         LIMIT 1`,
      )
      .bind(params.propertyId, clientSubmissionId)
      .first<{ submissionId: string; outboxId: string | null; dedupeKey: string | null }>();

    if (existing) {
      return {
        submissionId: existing.submissionId,
        outboxId: existing.outboxId ?? '',
        dedupeKey: existing.dedupeKey ?? `${params.propertyId}:${params.formType}:${clientSubmissionId}`,
        duplicate: true,
      };
    }
  }

  const submissionId = newId('form');
  const outboxId = newId('outbox');
  const submittedAt = new Date().toISOString();
  const eventType = params.eventType ?? 'created';
  const dedupeKey = clientSubmissionId
    ? `${params.propertyId}:${params.formType}:${clientSubmissionId}`
    : `${params.entityType}:${params.entityId}:${eventType}:${submissionId}`;
  const payloadJson = JSON.stringify({
    schemaVersion,
    formType: params.formType,
    propertyId: params.propertyId,
    entityType: params.entityType,
    entityId: params.entityId,
    submittedAt,
    data: params.payload,
  });

  await db.batch([
    db
      .prepare(
        `INSERT INTO form_submissions
          (id, property_id, form_type, schema_version, entity_type, entity_id,
           client_submission_id, payload_json, submitted_by_user_id, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        submissionId,
        params.propertyId,
        params.formType,
        schemaVersion,
        params.entityType,
        params.entityId,
        clientSubmissionId,
        payloadJson,
        params.submittedByUserId ?? null,
        submittedAt,
      ),
    db
      .prepare(
        `INSERT INTO integration_outbox
          (id, property_id, provider, event_type, entity_type, entity_id,
           form_submission_id, schema_version, dedupe_key, payload_json)
         VALUES (?, ?, 'google_sheets', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        outboxId,
        params.propertyId,
        `${params.formType}.${eventType}`,
        params.entityType,
        params.entityId,
        submissionId,
        schemaVersion,
        dedupeKey,
        payloadJson,
      ),
  ]);

  return { submissionId, outboxId, dedupeKey, duplicate: false };
}

export interface FormSubmissionSummary {
  id: string;
  form_type: string;
  schema_version: string;
  entity_type: string;
  entity_id: string;
  client_submission_id: string | null;
  submitted_at: string;
}

export async function listRecentFormSubmissions(
  db: D1Database,
  propertyId: string,
  limit = 100,
): Promise<FormSubmissionSummary[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const { results } = await db
    .prepare(
      `SELECT id, form_type, schema_version, entity_type, entity_id,
              client_submission_id, submitted_at
       FROM form_submissions
       WHERE property_id = ?
       ORDER BY submitted_at DESC
       LIMIT ?`,
    )
    .bind(propertyId, safeLimit)
    .all<FormSubmissionSummary>();
  return results ?? [];
}
