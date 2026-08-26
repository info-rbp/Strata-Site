-- ProInspect Building Management - operational forms and reporting foundation
--
-- This migration deliberately keeps the existing Cloudflare D1 database and
-- table names stable. It adds a normalized operational capture layer, a raw
-- form archive, and a durable integration outbox for the later Google Sheets
-- connection.

-- =========================================================================
-- 1. Correct property identity and add strata-plan metadata
-- =========================================================================

ALTER TABLE properties ADD COLUMN strata_plan TEXT;

UPDATE properties
SET name = 'Prima Apartments',
    address = '29 Leighton Beach Boulevard, North Fremantle WA 6159',
    timezone = 'Australia/Perth',
    strata_plan = '69777',
    updated_at = datetime('now')
WHERE id = 'prop_prima';

UPDATE properties
SET name = 'Meridian Apartments',
    address = '15-17 Freeman Loop, North Fremantle WA 6159',
    timezone = 'Australia/Perth',
    strata_plan = '69776',
    updated_at = datetime('now')
WHERE id = 'prop_meridian';

UPDATE buildings SET name = 'Prima Apartments' WHERE id = 'bldg_prima_a';
UPDATE buildings SET name = 'Meridian Apartments' WHERE id = 'bldg_meridian_a';

-- =========================================================================
-- 2. Daily Building Manager activity diary
-- =========================================================================

CREATE TABLE IF NOT EXISTS daily_activity_logs (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  activity_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_taken TEXT,
  location_id TEXT REFERENCES locations(id),
  building_id TEXT REFERENCES buildings(id),
  level_label TEXT,
  specific_location TEXT,
  unit_id TEXT REFERENCES units(id),
  contractor_id TEXT REFERENCES contractors(id),
  follow_up_required INTEGER NOT NULL DEFAULT 0,
  follow_up_date TEXT,
  responsible_party TEXT,
  priority TEXT NOT NULL DEFAULT 'routine',
  status TEXT NOT NULL DEFAULT 'completed',
  minutes_spent INTEGER,
  evidence_r2_key TEXT,
  additional_notes TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  recorded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_property_date
  ON daily_activity_logs(property_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_daily_activity_category
  ON daily_activity_logs(property_id, category, activity_date);
CREATE INDEX IF NOT EXISTS idx_daily_activity_followup
  ON daily_activity_logs(property_id, follow_up_required, follow_up_date);

-- =========================================================================
-- 3. Immutable raw form archive and future Google Sheets outbox
-- =========================================================================

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  form_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  client_submission_id TEXT,
  payload_json TEXT NOT NULL,
  submitted_by_user_id TEXT REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submission_client_dedupe
  ON form_submissions(property_id, client_submission_id)
  WHERE client_submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submission_month
  ON form_submissions(property_id, form_type, submitted_at);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  provider TEXT NOT NULL DEFAULT 'google_sheets',
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  form_submission_id TEXT REFERENCES form_submissions(id),
  schema_version TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_pending
  ON integration_outbox(provider, sync_status, created_at);
CREATE INDEX IF NOT EXISTS idx_integration_outbox_property
  ON integration_outbox(property_id, created_at);

-- =========================================================================
-- 4. Monthly report drafts and editable commentary
-- =========================================================================

CREATE TABLE IF NOT EXISTS monthly_report_drafts (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  report_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  section_commentary_json TEXT NOT NULL DEFAULT '{}',
  report_snapshot_json TEXT,
  generated_by_user_id TEXT REFERENCES users(id),
  generated_at TEXT,
  updated_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalised_at TEXT,
  UNIQUE(property_id, report_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_report_drafts
  ON monthly_report_drafts(property_id, report_month);

-- =========================================================================
-- 5. Extend existing operational records with form fields
-- =========================================================================

ALTER TABLE inspections ADD COLUMN inspection_type TEXT;
ALTER TABLE inspections ADD COLUMN location_id TEXT REFERENCES locations(id);
ALTER TABLE inspections ADD COLUMN building_id TEXT REFERENCES buildings(id);
ALTER TABLE inspections ADD COLUMN level_label TEXT;
ALTER TABLE inspections ADD COLUMN specific_location TEXT;
ALTER TABLE inspections ADD COLUMN notes TEXT;

ALTER TABLE inspection_results ADD COLUMN risk_level TEXT;
ALTER TABLE inspection_results ADD COLUMN immediate_action TEXT;
ALTER TABLE inspection_results ADD COLUMN maintenance_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inspection_results ADD COLUMN follow_up_date TEXT;

ALTER TABLE defects ADD COLUMN specific_location TEXT;
ALTER TABLE defects ADD COLUMN responsibility TEXT;
ALTER TABLE defects ADD COLUMN strata_approval_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE defects ADD COLUMN next_follow_up_date TEXT;

ALTER TABLE contractor_attendance ADD COLUMN visitor_name TEXT;
ALTER TABLE contractor_attendance ADD COLUMN visitor_mobile TEXT;
ALTER TABLE contractor_attendance ADD COLUMN visitor_email TEXT;
ALTER TABLE contractor_attendance ADD COLUMN area_accessed TEXT;
ALTER TABLE contractor_attendance ADD COLUMN resident_unit_id TEXT REFERENCES units(id);
ALTER TABLE contractor_attendance ADD COLUMN expected_duration_minutes INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN access_item_type TEXT;
ALTER TABLE contractor_attendance ADD COLUMN access_item_identifier TEXT;
ALTER TABLE contractor_attendance ADD COLUMN vehicle_registration TEXT;
ALTER TABLE contractor_attendance ADD COLUMN parking_location TEXT;
ALTER TABLE contractor_attendance ADD COLUMN site_rules_acknowledged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contractor_attendance ADD COLUMN work_completed INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN work_description TEXT;
ALTER TABLE contractor_attendance ADD COLUMN additional_defects TEXT;
ALTER TABLE contractor_attendance ADD COLUMN further_attendance_required INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN quote_or_report_to_follow INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN keys_returned INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN area_left_clean INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN bm_inspected INTEGER;
ALTER TABLE contractor_attendance ADD COLUMN signout_notes TEXT;

ALTER TABLE move_bookings ADD COLUMN applicant_name TEXT;
ALTER TABLE move_bookings ADD COLUMN applicant_role TEXT;
ALTER TABLE move_bookings ADD COLUMN applicant_phone TEXT;
ALTER TABLE move_bookings ADD COLUMN applicant_email TEXT;
ALTER TABLE move_bookings ADD COLUMN removalist_contact TEXT;
ALTER TABLE move_bookings ADD COLUMN vehicle_type TEXT;
ALTER TABLE move_bookings ADD COLUMN vehicle_height_mm INTEGER;
ALTER TABLE move_bookings ADD COLUMN lift_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE move_bookings ADD COLUMN lift_protection_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE move_bookings ADD COLUMN loading_area_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE move_bookings ADD COLUMN lift_key_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE move_bookings ADD COLUMN conditions_ack_json TEXT;
ALTER TABLE move_bookings ADD COLUMN special_requirements TEXT;

ALTER TABLE resident_onboarding ADD COLUMN property_id TEXT REFERENCES properties(id);
ALTER TABLE resident_onboarding ADD COLUMN resident_name TEXT;
ALTER TABLE resident_onboarding ADD COLUMN resident_role TEXT;
ALTER TABLE resident_onboarding ADD COLUMN move_in_date TEXT;
ALTER TABLE resident_onboarding ADD COLUMN questions_raised TEXT;
ALTER TABLE resident_onboarding ADD COLUMN outstanding_matters TEXT;
ALTER TABLE resident_onboarding ADD COLUMN acknowledgement_name TEXT;
ALTER TABLE resident_onboarding ADD COLUMN bm_notes TEXT;
ALTER TABLE resident_onboarding ADD COLUMN updated_at TEXT;

ALTER TABLE access_device_requests ADD COLUMN applicant_name TEXT;
ALTER TABLE access_device_requests ADD COLUMN managing_agent_name TEXT;
ALTER TABLE access_device_requests ADD COLUMN contact_phone TEXT;
ALTER TABLE access_device_requests ADD COLUMN contact_email TEXT;
ALTER TABLE access_device_requests ADD COLUMN device_type_requested TEXT;
ALTER TABLE access_device_requests ADD COLUMN quantity_requested INTEGER NOT NULL DEFAULT 1;
ALTER TABLE access_device_requests ADD COLUMN request_reason TEXT;
ALTER TABLE access_device_requests ADD COLUMN owner_authorisation_r2_key TEXT;
ALTER TABLE access_device_requests ADD COLUMN requested_collection_date TEXT;
ALTER TABLE access_device_requests ADD COLUMN internal_notes TEXT;

ALTER TABLE access_devices ADD COLUMN system_id TEXT;
ALTER TABLE access_devices ADD COLUMN key_id TEXT;
ALTER TABLE access_devices ADD COLUMN programmed_at TEXT;
ALTER TABLE access_devices ADD COLUMN programmed_by_user_id TEXT REFERENCES users(id);
ALTER TABLE access_devices ADD COLUMN activated_at TEXT;
ALTER TABLE access_devices ADD COLUMN old_device_deactivated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE access_devices ADD COLUMN replacement_device_id TEXT REFERENCES access_devices(id);

ALTER TABLE waste_events ADD COLUMN location_id TEXT REFERENCES locations(id);
ALTER TABLE waste_events ADD COLUMN waste_type TEXT;
ALTER TABLE waste_events ADD COLUMN activity TEXT;
ALTER TABLE waste_events ADD COLUMN quantity INTEGER;
ALTER TABLE waste_events ADD COLUMN condition_status TEXT;
ALTER TABLE waste_events ADD COLUMN issue_identified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waste_events ADD COLUMN responsible_unit_id TEXT REFERENCES units(id);
ALTER TABLE waste_events ADD COLUMN action_taken TEXT;
ALTER TABLE waste_events ADD COLUMN collection_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waste_events ADD COLUMN collection_arranged_date TEXT;
ALTER TABLE waste_events ADD COLUMN evidence_r2_key TEXT;

ALTER TABLE incidents ADD COLUMN incident_at TEXT;
ALTER TABLE incidents ADD COLUMN unit_id TEXT REFERENCES units(id);
ALTER TABLE incidents ADD COLUMN person_involved TEXT;
ALTER TABLE incidents ADD COLUMN witnesses TEXT;
ALTER TABLE incidents ADD COLUMN cctv_available INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN cctv_reviewed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN cctv_timestamp TEXT;
ALTER TABLE incidents ADD COLUMN police_or_security_contacted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN external_reference TEXT;
ALTER TABLE incidents ADD COLUMN strata_notified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN strata_notified_at TEXT;
ALTER TABLE incidents ADD COLUMN follow_up_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE incidents ADD COLUMN follow_up_date TEXT;
ALTER TABLE incidents ADD COLUMN resolution TEXT;
ALTER TABLE incidents ADD COLUMN evidence_r2_key TEXT;

ALTER TABLE bylaw_observations ADD COLUMN location_id TEXT REFERENCES locations(id);
ALTER TABLE bylaw_observations ADD COLUMN occurred_at TEXT;
ALTER TABLE bylaw_observations ADD COLUMN action_taken TEXT;
ALTER TABLE bylaw_observations ADD COLUMN evidence_r2_key TEXT;
ALTER TABLE bylaw_observations ADD COLUMN follow_up_date TEXT;

CREATE INDEX IF NOT EXISTS idx_incidents_followup
  ON incidents(property_id, follow_up_required, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_waste_events_month
  ON waste_events(property_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_resident_onboarding_property
  ON resident_onboarding(property_id, orientation_completed_at);
