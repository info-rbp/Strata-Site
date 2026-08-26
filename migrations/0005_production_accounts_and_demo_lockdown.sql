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

-- =========================================================================
-- 4. Remove known illustrative units from the production unit register
-- =========================================================================

-- These six units were explicitly created as Phase-1 seed examples. Production
-- must not present them as real Prima/Meridian lots. Preserve any exploratory
-- operational record where possible by detaching its sample-unit reference;
-- records whose workflow requires a unit (moves/onboarding) are demo data and
-- are removed.

DELETE FROM resident_onboarding
WHERE unit_id IN (
  'unit_prima_101','unit_prima_205','unit_prima_312',
  'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
)
OR move_booking_id IN (
  SELECT id FROM move_bookings WHERE unit_id IN (
    'unit_prima_101','unit_prima_205','unit_prima_312',
    'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
  )
);

DELETE FROM tasks
WHERE linked_entity_type = 'move_booking'
  AND linked_entity_id IN (
    SELECT id FROM move_bookings WHERE unit_id IN (
      'unit_prima_101','unit_prima_205','unit_prima_312',
      'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
    )
  );

DELETE FROM calendar_events
WHERE linked_entity_type = 'move_booking'
  AND linked_entity_id IN (
    SELECT id FROM move_bookings WHERE unit_id IN (
      'unit_prima_101','unit_prima_205','unit_prima_312',
      'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
    )
  );

DELETE FROM move_bookings
WHERE unit_id IN (
  'unit_prima_101','unit_prima_205','unit_prima_312',
  'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
);

DELETE FROM occupancies
WHERE unit_id IN (
  'unit_prima_101','unit_prima_205','unit_prima_312',
  'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
);

UPDATE resident_requests SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE defects SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE access_device_requests SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE access_devices SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE incidents SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE bylaw_observations SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE waste_events SET responsible_unit_id = NULL
WHERE responsible_unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');
UPDATE daily_activity_logs SET unit_id = NULL
WHERE unit_id IN ('unit_prima_101','unit_prima_205','unit_prima_312','unit_meridian_1002','unit_meridian_1503','unit_meridian_607');

DELETE FROM units
WHERE id IN (
  'unit_prima_101','unit_prima_205','unit_prima_312',
  'unit_meridian_1002','unit_meridian_1503','unit_meridian_607'
);

-- =========================================================================
-- 5. Remove known illustrative contractors and keys
-- =========================================================================

-- Attendance created against the seeded contractors is demo attendance. Remove
-- its transactions first, then detach seeded contractors from any retained
-- maintenance records before deleting the contractor directory entries.

DELETE FROM key_transactions
WHERE contractor_attendance_id IN (
  SELECT id FROM contractor_attendance
  WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean')
);

DELETE FROM tasks
WHERE linked_entity_type = 'contractor_attendance'
  AND linked_entity_id IN (
    SELECT id FROM contractor_attendance
    WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean')
  );

DELETE FROM contractor_attendance
WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');

UPDATE work_orders SET contractor_id = NULL
WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');
UPDATE quotes SET contractor_id = NULL
WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');
UPDATE assets SET responsible_contractor_id = NULL
WHERE responsible_contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');
UPDATE maintenance_plans SET responsible_contractor_id = NULL
WHERE responsible_contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');
UPDATE daily_activity_logs SET contractor_id = NULL
WHERE contractor_id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');

DELETE FROM contractors
WHERE id IN ('ctr_ace_plumbing','ctr_bright_electrical','ctr_liftcare','ctr_greenclean');

-- The seeded key register is illustrative as well. Detach any exploratory
-- attendance reference and remove both its transaction history and key rows.
UPDATE contractor_attendance
SET key_id = NULL, key_issued = 0
WHERE key_id IN ('key_prima_plant','key_prima_waste','key_meridian_plant','key_meridian_waste');

DELETE FROM key_transactions
WHERE key_id IN ('key_prima_plant','key_prima_waste','key_meridian_plant','key_meridian_waste');

DELETE FROM keys_register
WHERE id IN ('key_prima_plant','key_prima_waste','key_meridian_plant','key_meridian_waste');

-- Keep verified property identity, corrected buildings, generic common-area
-- locations and the reusable inspection templates/checkpoints. Real unit,
-- contractor, resident and key registers can now be imported without being
-- mixed with Phase-1 examples.
