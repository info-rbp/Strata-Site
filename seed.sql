-- PM Hub — Phase 1 demo data for Prima & Meridian Apartments.
-- All demo users share the password: Passw0rd!
-- (PBKDF2-SHA256, 100k iterations, per lib/crypto.ts hashPassword() output)

-- =========================================================================
-- Properties, buildings, locations, units
-- =========================================================================

INSERT OR IGNORE INTO properties (id, name, address, timezone) VALUES
  ('prop_prima', 'Prima Apartments', '12 Harbourview Street, Docklands VIC 3008', 'Australia/Melbourne'),
  ('prop_meridian', 'Meridian Apartments', '48 Riverside Quay, South Bank VIC 3006', 'Australia/Melbourne');

INSERT OR IGNORE INTO buildings (id, property_id, name) VALUES
  ('bldg_prima_a', 'prop_prima', 'Prima Tower A'),
  ('bldg_meridian_a', 'prop_meridian', 'Meridian North Tower');

INSERT OR IGNORE INTO locations (id, property_id, building_id, level_label, location_type, name) VALUES
  ('loc_prima_lobby', 'prop_prima', 'bldg_prima_a', 'Ground', 'lobby', 'Main Lobby'),
  ('loc_prima_carpark', 'prop_prima', 'bldg_prima_a', 'B1', 'car_park', 'Basement Car Park'),
  ('loc_prima_roof', 'prop_prima', 'bldg_prima_a', 'Roof', 'roof', 'Rooftop Plant Area'),
  ('loc_prima_waste', 'prop_prima', 'bldg_prima_a', 'B1', 'waste_room', 'Waste Room'),
  ('loc_meridian_lobby', 'prop_meridian', 'bldg_meridian_a', 'Ground', 'lobby', 'Main Lobby'),
  ('loc_meridian_carpark', 'prop_meridian', 'bldg_meridian_a', 'B1', 'car_park', 'Basement Car Park'),
  ('loc_meridian_plant', 'prop_meridian', 'bldg_meridian_a', 'Roof', 'plant_room', 'Rooftop Plant Room'),
  ('loc_meridian_waste', 'prop_meridian', 'bldg_meridian_a', 'B1', 'waste_room', 'Waste Room');

INSERT OR IGNORE INTO units (id, property_id, building_id, unit_number, level_label) VALUES
  ('unit_prima_101', 'prop_prima', 'bldg_prima_a', '101', 'Level 1'),
  ('unit_prima_205', 'prop_prima', 'bldg_prima_a', '205', 'Level 2'),
  ('unit_prima_312', 'prop_prima', 'bldg_prima_a', '312', 'Level 3'),
  ('unit_meridian_1002', 'prop_meridian', 'bldg_meridian_a', '1002', 'Level 10'),
  ('unit_meridian_1503', 'prop_meridian', 'bldg_meridian_a', '1503', 'Level 15'),
  ('unit_meridian_607', 'prop_meridian', 'bldg_meridian_a', '607', 'Level 6');

-- =========================================================================
-- People & Users — one per role, plus resident occupants
-- All passwords: Passw0rd!
-- =========================================================================

INSERT OR IGNORE INTO people (id, full_name, email, phone) VALUES
  ('person_admin', 'Ava Sysadmin', 'admin@pmhub.demo', '0400000001'),
  ('person_strata', 'Sarah Chen', 'strata@pmhub.demo', '0400000002'),
  ('person_council', 'Marcus Webb', 'council@pmhub.demo', '0400000003'),
  ('person_bm_prima', 'Ben Ortiz', 'bm.prima@pmhub.demo', '0400000004'),
  ('person_relief_bm', 'Rhea Nolan', 'relief.bm@pmhub.demo', '0400000005'),
  ('person_bm_meridian', 'Marco Silva', 'bm.meridian@pmhub.demo', '0400000006'),
  ('person_contractor_plumb', 'Tom Reeves', 'plumbing@pmhub.demo', '0400000007'),
  ('person_resident_101', 'Olivia Grant', 'olivia.grant@pmhub.demo', '0400000101'),
  ('person_resident_205', 'Liam Foster', 'liam.foster@pmhub.demo', '0400000102'),
  ('person_resident_1002', 'Emma Walsh', 'emma.walsh@pmhub.demo', '0400000103');

INSERT OR IGNORE INTO users (id, person_id, email, password_hash, role, property_scope, status) VALUES
  ('user_admin', 'person_admin', 'admin@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'system_administrator', NULL, 'active'),
  ('user_strata', 'person_strata', 'strata@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'strata_manager', NULL, 'active'),
  ('user_council', 'person_council', 'council@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'council_member', NULL, 'active'),
  ('user_bm_prima', 'person_bm_prima', 'bm.prima@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'building_manager', 'prop_prima', 'active'),
  ('user_relief_bm', 'person_relief_bm', 'relief.bm@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'relief_building_manager', 'prop_prima', 'active'),
  ('user_bm_meridian', 'person_bm_meridian', 'bm.meridian@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'building_manager', 'prop_meridian', 'active'),
  ('user_contractor_plumb', 'person_contractor_plumb', 'plumbing@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'contractor', 'prop_prima', 'active'),
  ('user_resident_101', 'person_resident_101', 'olivia.grant@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'resident', 'prop_prima', 'active'),
  ('user_resident_205', 'person_resident_205', 'liam.foster@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'resident', 'prop_prima', 'active'),
  ('user_resident_1002', 'person_resident_1002', 'emma.walsh@pmhub.demo', 'pbkdf2$100000$b59dd20d272ea490d3d22f834d247a7c$19a61dc83bb370a80139fb723791b610901991b71214a21b5c574f855596cc23', 'resident', 'prop_meridian', 'active');

INSERT OR IGNORE INTO occupancies (id, unit_id, person_id, user_id, occupancy_role, start_date, is_current) VALUES
  ('occ_101', 'unit_prima_101', 'person_resident_101', 'user_resident_101', 'owner', '2023-01-01', 1),
  ('occ_205', 'unit_prima_205', 'person_resident_205', 'user_resident_205', 'tenant', '2024-03-01', 1),
  ('occ_1002', 'unit_meridian_1002', 'person_resident_1002', 'user_resident_1002', 'owner', '2022-06-15', 1);

-- =========================================================================
-- Contractors & keys
-- =========================================================================

INSERT OR IGNORE INTO contractors (id, company_name, contact_name, contact_phone, contact_email, trade_category, licence_details, insurance_expiry, compliance_expiry, emergency_contact, properties_covered, status) VALUES
  ('ctr_ace_plumbing', 'Ace Plumbing & Gas', 'Tom Reeves', '0400000007', 'plumbing@pmhub.demo', 'plumbing', 'PL-88213', '2027-06-30', '2027-06-30', '0400000007', '["prop_prima","prop_meridian"]', 'active'),
  ('ctr_bright_electrical', 'Bright Electrical Services', 'Nina Kelly', '0400000201', 'electrical@pmhub.demo', 'electrical', 'EL-55021', '2027-03-15', '2027-03-15', '0400000201', '["prop_prima","prop_meridian"]', 'active'),
  ('ctr_liftcare', 'LiftCare Solutions', 'Greg Adams', '0400000202', 'lift@pmhub.demo', 'lift', 'LC-19004', '2026-12-01', '2026-12-01', '0400000202', '["prop_prima","prop_meridian"]', 'active'),
  ('ctr_greenclean', 'GreenClean Facilities', 'Priya Nair', '0400000203', 'cleaning@pmhub.demo', 'cleaning', NULL, '2027-01-20', '2027-01-20', '0400000203', '["prop_prima","prop_meridian"]', 'active');

INSERT OR IGNORE INTO keys_register (id, property_id, description, location_id, custody_status) VALUES
  ('key_prima_plant', 'prop_prima', 'Rooftop Plant Room Master Key', 'loc_prima_roof', 'in_register'),
  ('key_prima_waste', 'prop_prima', 'Waste Room Key', 'loc_prima_waste', 'in_register'),
  ('key_meridian_plant', 'prop_meridian', 'Rooftop Plant Room Master Key', 'loc_meridian_plant', 'in_register'),
  ('key_meridian_waste', 'prop_meridian', 'Waste Room Key', 'loc_meridian_waste', 'in_register');

-- =========================================================================
-- Inspection templates & checkpoints (Prima daily common-area walk)
-- =========================================================================

INSERT OR IGNORE INTO inspection_templates (id, property_id, name, frequency) VALUES
  ('tmpl_prima_daily', 'prop_prima', 'Daily Common Area Walk', 'daily'),
  ('tmpl_meridian_daily', 'prop_meridian', 'Daily Common Area Walk', 'daily');

INSERT OR IGNORE INTO inspection_checkpoints (id, template_id, location_id, sequence_no, label) VALUES
  ('cp_prima_1', 'tmpl_prima_daily', 'loc_prima_lobby', 1, 'Lobby — cleanliness & lighting'),
  ('cp_prima_2', 'tmpl_prima_daily', 'loc_prima_carpark', 2, 'Car park — lighting & line marking'),
  ('cp_prima_3', 'tmpl_prima_daily', 'loc_prima_waste', 3, 'Waste room — bins & odour'),
  ('cp_prima_4', 'tmpl_prima_daily', 'loc_prima_roof', 4, 'Roof plant area — general condition'),
  ('cp_meridian_1', 'tmpl_meridian_daily', 'loc_meridian_lobby', 1, 'Lobby — cleanliness & lighting'),
  ('cp_meridian_2', 'tmpl_meridian_daily', 'loc_meridian_carpark', 2, 'Car park — lighting & line marking'),
  ('cp_meridian_3', 'tmpl_meridian_daily', 'loc_meridian_waste', 3, 'Waste room — bins & odour'),
  ('cp_meridian_4', 'tmpl_meridian_daily', 'loc_meridian_plant', 4, 'Plant room — general condition');

-- =========================================================================
-- A couple of sample defects / requests so dashboards aren't empty
-- =========================================================================

INSERT OR IGNORE INTO resident_requests (id, property_id, unit_id, requested_by_person_id, category, description, urgency, status) VALUES
  ('req_demo_1', 'prop_prima', 'unit_prima_101', 'person_resident_101', 'water_leak', 'Water stain appearing on the ceiling near the kitchen.', 'urgent', 'new');

INSERT OR IGNORE INTO defects (id, property_id, location_id, unit_id, category, source, source_resident_request_id, description, risk_level, status) VALUES
  ('defect_demo_1', 'prop_prima', NULL, 'unit_prima_101', 'water_leak', 'resident', 'req_demo_1', 'Water stain appearing on the ceiling near the kitchen, reported by resident.', 'high', 'new');
