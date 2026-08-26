-- Property-specific operating rules keep building procedures configurable
-- rather than burying Meridian-only rules in browser code.
CREATE TABLE IF NOT EXISTS property_operating_settings (
  property_id TEXT PRIMARY KEY REFERENCES properties(id),
  move_notice_hours INTEGER,
  move_weekdays_only INTEGER NOT NULL DEFAULT 0,
  move_start_time TEXT,
  move_end_time TEXT,
  maximum_vehicle_height_mm INTEGER,
  move_access_instructions TEXT,
  contractor_sign_in_instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO property_operating_settings
  (property_id, move_notice_hours, move_weekdays_only, move_start_time,
   move_end_time, maximum_vehicle_height_mm, move_access_instructions,
   contractor_sign_in_instructions)
VALUES
  ('prop_prima', NULL, 0, NULL, NULL, NULL,
   'Follow the approved route and Building Manager directions. Lift protection must be arranged before bulky-item movements.',
   'All contractors must sign in, record any access item issued, and sign out before leaving.'),
  ('prop_meridian', 48, 1, '08:00', '16:00', 2100,
   'Moves and large-item deliveries require at least 48 hours notice, use the basement lift route, must not use fire stairs, and must follow the approved weekday time window. Basement ramp clearance is 2.1 metres.',
   'All contractors must sign in, record any access item issued, and sign out before leaving. Keys must be returned before departure.');
