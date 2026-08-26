-- ProInspect Building Management - production account bootstrap and demo lockdown
--
-- Plain-text passwords are never stored in this repository. Password hashes
-- below are PBKDF2-SHA256 (100,000 iterations) generated specifically for the
-- initial production accounts. Temporary credentials are handed to the system
-- owner separately and should be rotated through the application after first
-- login.

-- =========================================================================
-- 1. Named production people and users
-- =========================================================================

INSERT OR IGNORE INTO people (id, full_name, email, phone) VALUES
  ('person_prod_admin', 'Gianpaulo Coletti', 'info@remotebusinesspartner.com.au', NULL),
  ('person_prod_strata', 'Shan Goodlet', 'shan.goodlet@lpg.com.au', NULL),
  ('person_prod_bm_prima', 'Gianpaulo Coletti', 'buildingmanager.prima@gmail.com', NULL),
  ('person_prod_bm_meridian', 'Gianpaulo Coletti', 'buildingmanager.meridian@gmail.com', NULL);

INSERT OR IGNORE INTO users
  (id, person_id, email, password_hash, role, property_scope, status)
VALUES
  (
    'user_prod_admin',
    'person_prod_admin',
    'info@remotebusinesspartner.com.au',
    'pbkdf2$100000$1dd3aef9980dd735e98a773d6d70733b$d460fb90f5c2a39e83dfa22796f39f8573d500266e5943d42eb8915fc34cfbd4',
    'system_administrator',
    NULL,
    'active'
  ),
  (
    'user_prod_strata',
    'person_prod_strata',
    'shan.goodlet@lpg.com.au',
    'pbkdf2$100000$6f927507c93708053df796482c583bf4$26a662a3a8a0e647d9d2c3325b9b944056dc3f03cff2724731866d4af2d25cd8',
    'strata_manager',
    NULL,
    'active'
  ),
  (
    'user_prod_bm_prima',
    'person_prod_bm_prima',
    'buildingmanager.prima@gmail.com',
    'pbkdf2$100000$128d6a73fad1169459fbc59828aee69c$2212565e04bd7dd38a208e49eb708cb7cac6fe04cc7967d7ed7403e03892e93a',
    'building_manager',
    'prop_prima',
    'active'
  ),
  (
    'user_prod_bm_meridian',
    'person_prod_bm_meridian',
    'buildingmanager.meridian@gmail.com',
    'pbkdf2$100000$515bc0520e53d90e05255c60c82a8a0e$6c51f984a38a8ff4759867d055676a9360f74b18a1fe3e4c517ae815b3688655',
    'building_manager',
    'prop_meridian',
    'active'
  );

-- If a production email already exists, retain the existing account and
-- credentials rather than silently overwriting them. This makes the migration
-- safe to run in an environment where an operator created the account first.

-- =========================================================================
-- 2. Lock down publicly documented demo credentials
-- =========================================================================

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@pmhub.demo');

DELETE FROM notifications
WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@pmhub.demo');

UPDATE users
SET status = 'suspended', updated_at = datetime('now')
WHERE email LIKE '%@pmhub.demo';

-- Seeded residents must not appear as current occupants in a production
-- resident/unit register. Preserve their historical rows for referential
-- integrity while making them inactive.
UPDATE occupancies
SET is_current = 0,
    end_date = COALESCE(end_date, date('now'))
WHERE id IN ('occ_101', 'occ_205', 'occ_1002');

-- =========================================================================
-- 3. Remove the known Phase-1 sample operational issue
-- =========================================================================

-- Detach any test records that an operator may have linked to the sample defect
-- before removing it. This keeps the migration safe if exploratory use of the
-- live demo created work orders, quotes or approvals after the original seed.
UPDATE work_orders SET defect_id = NULL WHERE defect_id = 'defect_demo_1';
UPDATE quotes SET defect_id = NULL WHERE defect_id = 'defect_demo_1';
DELETE FROM defect_evidence WHERE defect_id = 'defect_demo_1';
DELETE FROM tasks
WHERE (linked_entity_type = 'defect' AND linked_entity_id = 'defect_demo_1')
   OR (linked_entity_type = 'resident_request' AND linked_entity_id = 'req_demo_1');
UPDATE resident_requests SET defect_id = NULL WHERE id = 'req_demo_1';
DELETE FROM defects WHERE id = 'defect_demo_1';
DELETE FROM resident_requests WHERE id = 'req_demo_1';

-- Leave the property/building/location/inspection-template reference data in
-- place. Those records are required for the application to remain usable after
-- demo accounts are disabled and can be replaced incrementally with verified
-- building data.
