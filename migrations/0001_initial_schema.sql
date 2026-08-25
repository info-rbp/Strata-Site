-- PM Hub — Phase 1 core schema
-- Mirrors the ProInspect pattern: every operational record scopes to a property,
-- every mutation is auditable, every workflow has an explicit status enum.

-- =========================================================================
-- 1. PROPERTY STRUCTURE
-- =========================================================================

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  building_id TEXT REFERENCES buildings(id),
  level_label TEXT,                 -- e.g. "Level 3", "Basement 1", "Roof"
  location_type TEXT NOT NULL,      -- common_area | basement | roof | lobby | plant_room | car_park | waste_room | other
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  building_id TEXT REFERENCES buildings(id),
  unit_number TEXT NOT NULL,
  level_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(property_id, unit_number)
);

-- =========================================================================
-- 2. PEOPLE, USERS, OCCUPANCY, ROLES
-- =========================================================================

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Canonical roles, mirrors ProInspect's UserRole + capability model
-- resident | building_manager | relief_building_manager | strata_manager |
-- council_member | contractor | system_administrator
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  person_id TEXT REFERENCES people(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  property_scope TEXT,               -- NULL = all properties (admin/strata), else single property_id
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | expired
  access_expires_at TEXT,            -- for relief_building_manager time-limited access
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- owner | tenant | authorised_agent
CREATE TABLE IF NOT EXISTS occupancies (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  user_id TEXT REFERENCES users(id),
  occupancy_role TEXT NOT NULL,      -- owner | tenant | authorised_agent
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 3. TASK ENGINE (every workflow action materialises as a task)
-- =========================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  title TEXT NOT NULL,
  task_type TEXT NOT NULL,          -- triage | inspection | contractor_setup | move_setup | maintenance_service | approval_followup | key_return | other
  linked_entity_type TEXT,          -- defect | work_order | move_booking | access_device | incident | service_event
  linked_entity_id TEXT,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'normal', -- normal | urgent
  assignee_user_id TEXT REFERENCES users(id),
  assignee_role TEXT,                -- fallback role-based assignment
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | completed | cancelled
  completion_evidence TEXT,          -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_property_status ON tasks(property_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);

-- =========================================================================
-- 4. RESIDENT REQUESTS -> DEFECTS -> WORK ORDERS
-- =========================================================================

CREATE TABLE IF NOT EXISTS resident_requests (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  requested_by_person_id TEXT REFERENCES people(id),
  location_text TEXT,
  category TEXT NOT NULL,           -- water_leak | lift | access_door | lighting | garage | waste | cleaning | security | damage | noise | other
  description TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal', -- normal | urgent
  apartment_access_required INTEGER NOT NULL DEFAULT 0,
  contact_details TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new | triaged | converted_to_defect | closed
  defect_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defect status model (Section 8.2):
-- new -> bm_assessment -> minor_repair | contractor_required -> awaiting_approval
--     -> approved -> contractor_booked -> in_progress -> awaiting_verification -> completed -> closed
CREATE TABLE IF NOT EXISTS defects (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  location_id TEXT REFERENCES locations(id),
  unit_id TEXT REFERENCES units(id),
  asset_id TEXT REFERENCES assets(id),
  category TEXT NOT NULL,
  source TEXT NOT NULL,             -- resident | inspection | contractor | building_manager | strata | incident
  source_resident_request_id TEXT REFERENCES resident_requests(id),
  source_inspection_id TEXT,
  source_incident_id TEXT,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'normal', -- normal | high | immediate_danger
  priority TEXT NOT NULL DEFAULT 'normal',
  is_common_property INTEGER NOT NULL DEFAULT 1,
  immediate_response TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to_user_id TEXT REFERENCES users(id),
  assigned_contractor_id TEXT REFERENCES contractors(id),
  quote_required INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  completion_date TEXT,
  work_completed_notes TEXT,
  cost_amount REAL,
  requires_permanent_followup INTEGER NOT NULL DEFAULT 0,
  verified_by_user_id TEXT REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_defects_property_status ON defects(property_id, status);

CREATE TABLE IF NOT EXISTS defect_evidence (
  id TEXT PRIMARY KEY,
  defect_id TEXT NOT NULL REFERENCES defects(id),
  r2_key TEXT NOT NULL,
  content_type TEXT,
  caption TEXT,
  uploaded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  defect_id TEXT REFERENCES defects(id),
  service_event_id TEXT REFERENCES service_events(id),
  scope TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id),
  asset_id TEXT REFERENCES assets(id),
  contractor_id TEXT REFERENCES contractors(id),
  scheduled_at TEXT,
  access_needs TEXT,
  shutdown_required INTEGER NOT NULL DEFAULT 0,
  resident_impact_notes TEXT,
  status TEXT NOT NULL DEFAULT 'created', -- created | scheduled | in_progress | completed | verified | cancelled
  findings TEXT,
  work_performed TEXT,
  recommendations TEXT,
  service_report_r2_key TEXT,
  verified_by_user_id TEXT REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_work_orders_property_status ON work_orders(property_id, status);

-- =========================================================================
-- 5. CONTRACTORS, ATTENDANCE, KEYS
-- =========================================================================

CREATE TABLE IF NOT EXISTS contractors (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  trade_category TEXT NOT NULL,     -- plumbing | electrical | lift | fire | cleaning | gardening | security | general | other
  licence_details TEXT,
  insurance_expiry TEXT,
  compliance_expiry TEXT,
  emergency_contact TEXT,
  properties_covered TEXT,          -- JSON array of property_id
  access_permissions TEXT,          -- JSON
  status TEXT NOT NULL DEFAULT 'active', -- active | inactive | suspended
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contractor_attendance (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  contractor_id TEXT NOT NULL REFERENCES contractors(id),
  work_order_id TEXT REFERENCES work_orders(id),
  purpose TEXT,
  sign_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  sign_out_at TEXT,
  key_issued INTEGER NOT NULL DEFAULT 0,
  key_id TEXT REFERENCES keys_register(id),
  bm_arrival_ack_by_user_id TEXT REFERENCES users(id),
  service_report_r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'on_site', -- on_site | pending_key_return | closed
  override_reason TEXT,
  verified_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendance_property_status ON contractor_attendance(property_id, status);

CREATE TABLE IF NOT EXISTS keys_register (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  description TEXT NOT NULL,
  location_id TEXT REFERENCES locations(id),
  custody_status TEXT NOT NULL DEFAULT 'in_register', -- in_register | issued | lost | permanently_issued
  currently_held_by TEXT,             -- free text or contractor/user reference
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS key_transactions (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES keys_register(id),
  contractor_attendance_id TEXT REFERENCES contractor_attendance(id),
  issued_to TEXT NOT NULL,
  transaction_type TEXT NOT NULL,   -- issue | return | lost | permanent_issue
  issued_by_user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

-- =========================================================================
-- 6. ACCESS DEVICES (fobs/keys/swipes)
-- =========================================================================

CREATE TABLE IF NOT EXISTS access_device_requests (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  requested_by_person_id TEXT REFERENCES people(id),
  request_type TEXT NOT NULL,       -- replacement_fob | additional_fob | remote | swipe | physical_key | lost_stolen
  requester_role TEXT,              -- owner | tenant | authorised_agent
  owner_authorisation_status TEXT DEFAULT 'not_required', -- not_required | pending | approved | declined
  payment_reference TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | awaiting_authorisation | approved | programming | ready_for_collection | issued | declined
  collection_appointment_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_devices (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  request_id TEXT REFERENCES access_device_requests(id),
  serial_number TEXT,
  device_type TEXT NOT NULL,        -- fob | swipe | remote | key | other
  unit_id TEXT REFERENCES units(id),
  assigned_person_id TEXT REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'stock', -- stock | pending_programming | active | lost | stolen | deactivated | returned | destroyed
  access_profile TEXT,
  id_check_notes TEXT,
  collected_by TEXT,
  issue_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS access_device_history (
  id TEXT PRIMARY KEY,
  access_device_id TEXT NOT NULL REFERENCES access_devices(id),
  event_type TEXT NOT NULL,         -- issued | transferred | replaced | deactivated | returned
  notes TEXT,
  actor_user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 7. MOVES & DELIVERIES
-- =========================================================================

-- new -> pending_approval -> approved | declined -> pre_move_setup -> in_progress -> post_move_inspection -> closed
CREATE TABLE IF NOT EXISTS move_bookings (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  requested_by_person_id TEXT REFERENCES people(id),
  move_type TEXT NOT NULL,          -- move_in | move_out | furniture_delivery | furniture_removal | bulky_item
  requested_at TEXT NOT NULL,       -- requested date/time
  removalist_name TEXT,
  vehicle_details TEXT,
  estimated_duration_minutes INTEGER,
  rules_acknowledged INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  decline_reason TEXT,
  approved_by_user_id TEXT REFERENCES users(id),
  approved_at TEXT,
  pre_move_inspection_notes TEXT,
  post_move_inspection_notes TEXT,
  damage_defect_id TEXT REFERENCES defects(id),
  keys_returned INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moves_property_status ON move_bookings(property_id, status);

CREATE TABLE IF NOT EXISTS resident_onboarding (
  id TEXT PRIMARY KEY,
  move_booking_id TEXT REFERENCES move_bookings(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  modules_ack TEXT,                 -- JSON: which induction modules acknowledged
  rules_ack INTEGER NOT NULL DEFAULT 0,
  orientation_completed_by_user_id TEXT REFERENCES users(id),
  orientation_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | in_progress | complete
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 8. INSPECTIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS inspection_templates (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  frequency TEXT,                    -- daily | weekly | monthly | ad_hoc
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_checkpoints (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES inspection_templates(id),
  location_id TEXT REFERENCES locations(id),
  sequence_no INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  qr_marker_code TEXT
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  template_id TEXT NOT NULL REFERENCES inspection_templates(id),
  inspector_user_id TEXT REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed
  exceptions_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inspection_results (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id),
  checkpoint_id TEXT NOT NULL REFERENCES inspection_checkpoints(id),
  result TEXT NOT NULL,              -- pass | fail | not_applicable
  observation TEXT,
  photo_r2_key TEXT,
  defect_id TEXT REFERENCES defects(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 9. ASSETS & PREVENTIVE MAINTENANCE (Phase 2 groundwork - schema included now)
-- =========================================================================

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  location_id TEXT REFERENCES locations(id),
  system_category TEXT NOT NULL,    -- fire | hot_water | pump | lift | hvac | exhaust | roller_door | automatic_door | intercom | cctv | access_control | roof_waterproofing | other
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  commissioning_date TEXT,
  warranty_expiry TEXT,
  criticality TEXT NOT NULL DEFAULT 'normal', -- normal | high | critical
  responsible_contractor_id TEXT REFERENCES contractors(id),
  qr_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  frequency_days INTEGER NOT NULL,
  responsible_contractor_id TEXT REFERENCES contractors(id),
  standard_scope TEXT,
  required_evidence TEXT,
  last_completed_at TEXT,
  next_due_at TEXT,
  reminder_days_before TEXT,          -- JSON array e.g. [30,14]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_events (
  id TEXT PRIMARY KEY,
  maintenance_plan_id TEXT NOT NULL REFERENCES maintenance_plans(id),
  scheduled_at TEXT,
  completed_at TEXT,
  work_order_id TEXT REFERENCES work_orders(id),
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | completed | verified | overdue
  verified_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 10. WASTE
-- =========================================================================

CREATE TABLE IF NOT EXISTS waste_services (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  stream TEXT NOT NULL,              -- general | recycling | fogo | container_deposit | cardboard | other
  day_of_week TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS waste_events (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  waste_service_id TEXT REFERENCES waste_services(id),
  event_type TEXT NOT NULL,          -- staging | collection_check | washing_return | exception
  exception_category TEXT,           -- blocked_chute | overflowing_bins | contamination | abandoned_items | cardboard_not_flattened | damaged_bin | odour_leak | collection_missed
  recorded_by_user_id TEXT REFERENCES users(id),
  minutes_spent INTEGER,
  notes TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 11. INCIDENTS & BY-LAW OBSERVATIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  location_id TEXT REFERENCES locations(id),
  category TEXT NOT NULL,           -- water_leak | power_loss | lift_entrapment | fire_system_fault | garage_door_failure | access_security_failure | sewage_overflow | storm_damage | flooding | property_damage | safety_hazard
  reported_by_user_id TEXT REFERENCES users(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal', -- normal | high
  immediate_risk TEXT,
  actions_taken TEXT,
  emergency_service_contractor TEXT,
  damage_notes TEXT,
  temporary_repair_notes TEXT,
  linked_defect_id TEXT REFERENCES defects(id),
  status TEXT NOT NULL DEFAULT 'open', -- open | monitoring | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bylaw_observations (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  category TEXT NOT NULL,           -- storage_in_bays | obstruction | unauthorised_move | common_area_items | waste_breach | parking_vehicle | other
  observation TEXT NOT NULL,
  observed_by_user_id TEXT REFERENCES users(id),
  strata_outcome TEXT DEFAULT 'pending', -- pending | information_only | resident_contact | formal_breach_action | no_action | monitor
  strata_decided_by_user_id TEXT REFERENCES users(id),
  strata_decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 12. QUOTES & APPROVALS
-- =========================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  defect_id TEXT REFERENCES defects(id),
  contractor_id TEXT REFERENCES contractors(id),
  amount REAL NOT NULL,
  document_r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | recommended | approved | declined | more_info_requested
  bm_recommendation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  quote_id TEXT REFERENCES quotes(id),
  defect_id TEXT REFERENCES defects(id),
  decision TEXT NOT NULL,           -- approved | declined | more_information
  decision_maker_user_id TEXT REFERENCES users(id),
  amount REAL,
  comments TEXT,
  conditions TEXT,
  decided_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 13. NOTICES, COMMUNICATIONS, DOCUMENTS
-- =========================================================================

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all', -- all | building | floor | unit_group
  audience_filter TEXT,               -- JSON detail
  published_by_user_id TEXT REFERENCES users(id),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS communications (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  channel TEXT NOT NULL,             -- email | in_app | sms
  recipient TEXT,
  subject TEXT,
  body TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_status TEXT DEFAULT 'sent'
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  title TEXT NOT NULL,
  category TEXT,
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  version TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal', -- internal | resident_visible | restricted
  uploaded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 14. INVENTORY (Phase 2 groundwork)
-- =========================================================================

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  minimum_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- 15. NOTIFICATIONS (in-app)
-- =========================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  property_id TEXT REFERENCES properties(id),
  title TEXT NOT NULL,
  body TEXT,
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);

-- =========================================================================
-- 16. AUDIT TRAIL (immutable/append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id),
  actor_user_id TEXT REFERENCES users(id),
  actor_role TEXT,
  action TEXT NOT NULL,              -- create | update | delete | approve | status_change | issue | verify | login
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_value TEXT,                 -- JSON
  after_value TEXT,                  -- JSON
  reason TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_property_time ON audit_events(property_id, occurred_at);

-- =========================================================================
-- 17. UNIFIED CALENDAR EVENTS
-- =========================================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  event_type TEXT NOT NULL,          -- move | contractor_visit | preventive_maintenance | waste_task | inspection | resident_appointment | outage
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_property_time ON calendar_events(property_id, starts_at);

-- =========================================================================
-- 18. HANDOVER
-- =========================================================================

CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  outgoing_user_id TEXT REFERENCES users(id),
  incoming_user_id TEXT REFERENCES users(id),
  access_expires_at TEXT,
  snapshot TEXT,                     -- JSON compiled open items
  status TEXT NOT NULL DEFAULT 'active', -- active | completed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS handover_checklist_items (
  id TEXT PRIMARY KEY,
  handover_id TEXT NOT NULL REFERENCES handovers(id),
  label TEXT NOT NULL,
  category TEXT,                     -- plant_room | roof | waste_area | fire_controls | garage | loading_area | open_item
  acknowledged INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT
);
