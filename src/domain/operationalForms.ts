// ProInspect Building Management operational form vocabulary.
//
// Keep these values stable: they are persisted in D1, emitted through the
// integration outbox, and will become Google Sheets column contracts later.
// Labels may change; values and schema versions must be migrated deliberately.

export const FORM_SCHEMA_VERSION = '2026-08-26.1';

export const OPERATIONAL_FORM_TYPES = [
  'daily_activity',
  'building_inspection',
  'maintenance_defect',
  'contractor_sign_in',
  'contractor_sign_out',
  'move_booking',
  'resident_induction',
  'access_device_request',
  'access_device_issue',
  'waste_activity',
  'incident',
  'bylaw_observation',
] as const;

export type OperationalFormType = (typeof OPERATIONAL_FORM_TYPES)[number];

export const MONTHLY_REPORT_SECTIONS = [
  'executive_summary',
  'building_maintenance_repairs',
  'building_security',
  'cleaning',
  'gardening_grounds',
  'resident_movements',
  'resident_inductions',
  'waste_management',
  'contractor_activity',
  'access_devices_keys',
  'bylaw_issues',
  'leave_plans',
  'other',
  'outstanding_actions',
] as const;

export type MonthlyReportSection = (typeof MONTHLY_REPORT_SECTIONS)[number];

export interface FormOption {
  value: string;
  label: string;
  reportSection?: MonthlyReportSection;
}

export interface OperationalFormDefinition {
  type: OperationalFormType;
  title: string;
  shortTitle: string;
  description: string;
  audience: 'building_manager' | 'contractor' | 'resident' | 'internal';
  expectedCompletionSeconds: number;
  reportSection: MonthlyReportSection;
  schemaVersion: string;
}

export const ACTIVITY_CATEGORIES: readonly FormOption[] = [
  { value: 'maintenance_repairs', label: 'Maintenance & Repairs', reportSection: 'building_maintenance_repairs' },
  { value: 'building_security', label: 'Building Security', reportSection: 'building_security' },
  { value: 'cleaning', label: 'Cleaning', reportSection: 'cleaning' },
  { value: 'gardening_grounds', label: 'Gardening & Grounds', reportSection: 'gardening_grounds' },
  { value: 'resident_movement', label: 'Resident Movement', reportSection: 'resident_movements' },
  { value: 'resident_induction', label: 'Resident Induction', reportSection: 'resident_inductions' },
  { value: 'waste_management', label: 'Waste Management', reportSection: 'waste_management' },
  { value: 'contractor_management', label: 'Contractor Management', reportSection: 'contractor_activity' },
  { value: 'access_control', label: 'Access Control', reportSection: 'access_devices_keys' },
  { value: 'common_property', label: 'Common Property', reportSection: 'other' },
  { value: 'administration', label: 'Administration', reportSection: 'other' },
  { value: 'leave_plan', label: 'Leave Plan', reportSection: 'leave_plans' },
  { value: 'other', label: 'Other', reportSection: 'other' },
] as const;

export const INSPECTION_TYPES: readonly FormOption[] = [
  { value: 'start_of_day', label: 'Start-of-Day Check' },
  { value: 'floor', label: 'Floor-by-Floor Inspection' },
  { value: 'basement', label: 'Basement Inspection' },
  { value: 'roof', label: 'Roof Inspection' },
  { value: 'waste_area', label: 'Waste Area Inspection' },
  { value: 'common_area', label: 'Common Area Inspection' },
  { value: 'move_pre', label: 'Pre-Move Inspection' },
  { value: 'move_post', label: 'Post-Move Inspection' },
  { value: 'other', label: 'Other Inspection' },
] as const;

export const INSPECTION_ITEMS: readonly FormOption[] = [
  { value: 'lighting', label: 'Lighting' },
  { value: 'doors_access', label: 'Doors & Access' },
  { value: 'walls_ceilings', label: 'Walls & Ceilings' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'water_leaks_staining', label: 'Water Leaks & Staining' },
  { value: 'waste_condition', label: 'Waste Condition' },
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'fire_stairs', label: 'Fire Stairs' },
  { value: 'signage', label: 'Signage' },
  { value: 'security', label: 'Security' },
  { value: 'plant_equipment', label: 'Plant & Equipment' },
  { value: 'obstructions_storage', label: 'Obstructions & Storage' },
] as const;

export const DEFECT_CATEGORIES: readonly FormOption[] = [
  { value: 'water_leak', label: 'Water Leak / Ingress' },
  { value: 'plumbing', label: 'Plumbing / Hot Water' },
  { value: 'electrical', label: 'Electrical / Lighting' },
  { value: 'lift', label: 'Lift' },
  { value: 'fire_system', label: 'Fire System' },
  { value: 'access_door', label: 'Door / Access Control' },
  { value: 'garage_door', label: 'Garage / Roller Door' },
  { value: 'cctv_security', label: 'CCTV / Security' },
  { value: 'hvac', label: 'Air Conditioning / Ventilation' },
  { value: 'roof_waterproofing', label: 'Roof / Waterproofing' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'gardening', label: 'Gardening / Reticulation' },
  { value: 'waste', label: 'Waste / Bin Chute' },
  { value: 'damage', label: 'Common Property Damage' },
  { value: 'structural', label: 'Structural Concern' },
  { value: 'other', label: 'Other' },
] as const;

export const PRIORITIES: readonly FormOption[] = [
  { value: 'routine', label: 'Routine' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

export const RISK_LEVELS: readonly FormOption[] = [
  { value: 'normal', label: 'Low / Normal' },
  { value: 'high', label: 'High' },
  { value: 'immediate_danger', label: 'Immediate Danger' },
] as const;

export const RESPONSIBILITY_OPTIONS: readonly FormOption[] = [
  { value: 'common_property', label: 'Common Property' },
  { value: 'lot_property', label: 'Lot / Apartment Property' },
  { value: 'shared_or_unclear', label: 'Shared / Unclear' },
] as const;

export const RESPONSIBLE_PARTIES: readonly FormOption[] = [
  { value: 'building_manager', label: 'Building Manager' },
  { value: 'strata_manager', label: 'Strata Manager' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'council_of_owners', label: 'Council of Owners' },
  { value: 'resident_owner', label: 'Resident / Owner' },
  { value: 'cleaner', label: 'Cleaner' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'other', label: 'Other' },
] as const;

export const ACTIVITY_STATUSES: readonly FormOption[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'referred', label: 'Referred' },
] as const;

export const WASTE_TYPES: readonly FormOption[] = [
  { value: 'general', label: 'General Waste' },
  { value: 'recycling', label: 'Recycling' },
  { value: 'fogo', label: 'FOGO' },
  { value: 'container_deposit', label: '10c Containers' },
  { value: 'cardboard', label: 'Cardboard' },
  { value: 'polystyrene', label: 'Polystyrene' },
  { value: 'bulky_items', label: 'Bulky Items' },
  { value: 'other', label: 'Other' },
] as const;

export const WASTE_ACTIVITIES: readonly FormOption[] = [
  { value: 'bins_collected', label: 'Bins Collected' },
  { value: 'bins_put_out', label: 'Bins Put Out' },
  { value: 'bins_returned', label: 'Bins Returned' },
  { value: 'bins_washed', label: 'Bins Washed' },
  { value: 'bins_disinfected', label: 'Bins Disinfected' },
  { value: 'bins_consolidated', label: 'Bins Consolidated' },
  { value: 'chute_checked', label: 'Chute Checked' },
  { value: 'chute_blockage_cleared', label: 'Chute Blockage Cleared' },
  { value: 'container_deposit_collected', label: '10c Containers Collected' },
  { value: 'cardboard_cage_checked', label: 'Cardboard Cage Checked' },
  { value: 'polystyrene_cage_checked', label: 'Polystyrene Cage Checked' },
  { value: 'bulk_waste_identified', label: 'Bulk Waste Identified' },
  { value: 'waste_breach_identified', label: 'Waste Breach Identified' },
  { value: 'collection_missed', label: 'Collection Missed' },
  { value: 'other', label: 'Other' },
] as const;

export const WASTE_EXCEPTION_CATEGORIES: readonly FormOption[] = [
  { value: 'blocked_chute', label: 'Blocked Chute' },
  { value: 'overflowing_bins', label: 'Overflowing Bins' },
  { value: 'contamination', label: 'Recycling Contamination' },
  { value: 'abandoned_items', label: 'Abandoned / Bulky Items' },
  { value: 'cardboard_not_flattened', label: 'Cardboard Not Flattened' },
  { value: 'damaged_bin', label: 'Damaged Bin' },
  { value: 'odour_leak', label: 'Odour / Leak' },
  { value: 'collection_missed', label: 'Collection Missed' },
  { value: 'other', label: 'Other' },
] as const;

export const INCIDENT_CATEGORIES: readonly FormOption[] = [
  { value: 'security', label: 'Security Incident' },
  { value: 'unauthorised_access', label: 'Unauthorised Access' },
  { value: 'theft', label: 'Theft / Attempted Theft' },
  { value: 'vehicle_incident', label: 'Vehicle Incident' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'noise', label: 'Noise / Disturbance' },
  { value: 'water_leak', label: 'Water Leak / Flooding' },
  { value: 'power_loss', label: 'Power Loss' },
  { value: 'lift_entrapment', label: 'Lift Entrapment / Failure' },
  { value: 'fire_system_fault', label: 'Fire System Fault / Alarm' },
  { value: 'garage_door_failure', label: 'Garage Door Failure' },
  { value: 'access_security_failure', label: 'Access / Security System Failure' },
  { value: 'sewage_overflow', label: 'Sewage Overflow' },
  { value: 'storm_damage', label: 'Storm Damage' },
  { value: 'safety_hazard', label: 'Safety Hazard' },
  { value: 'other', label: 'Other' },
] as const;

export const BYLAW_CATEGORIES: readonly FormOption[] = [
  { value: 'storage_in_bays', label: 'Storage in Car Bay / Cage Area' },
  { value: 'obstruction', label: 'Common Area Obstruction' },
  { value: 'unauthorised_move', label: 'Unauthorised Move / Delivery' },
  { value: 'common_area_items', label: 'Items Left in Common Area' },
  { value: 'waste_breach', label: 'Waste / Recycling Breach' },
  { value: 'parking_vehicle', label: 'Parking / Vehicle Breach' },
  { value: 'noise', label: 'Noise Breach' },
  { value: 'pet', label: 'Pet Rule Breach' },
  { value: 'balcony', label: 'Balcony Rule Breach' },
  { value: 'security_access', label: 'Security / Access Breach' },
  { value: 'other', label: 'Other' },
] as const;

export const ACCESS_ITEM_TYPES: readonly FormOption[] = [
  { value: 'none', label: 'None' },
  { value: 'key', label: 'Key' },
  { value: 'fob', label: 'Fob' },
  { value: 'swipe', label: 'Swipe Card' },
  { value: 'remote', label: 'Remote' },
  { value: 'plant_room_key', label: 'Plant Room Key' },
  { value: 'lift_key', label: 'Lift Key' },
  { value: 'other', label: 'Other' },
] as const;

export const MOVE_TYPES: readonly FormOption[] = [
  { value: 'move_in', label: 'Move In' },
  { value: 'move_out', label: 'Move Out' },
  { value: 'furniture_delivery', label: 'Furniture Delivery' },
  { value: 'furniture_removal', label: 'Furniture Removal' },
  { value: 'bulky_item', label: 'Large / Bulky Item' },
  { value: 'contractor_works', label: 'Contractor Works Requiring Lift Protection' },
] as const;

export const MOVE_ACKNOWLEDGEMENTS = [
  { value: 'approved_route', label: 'Use only the approved access route' },
  { value: 'protect_common_property', label: 'Protect common property from damage' },
  { value: 'no_fire_stairs', label: 'Do not use the fire stairs' },
  { value: 'removalist_insured', label: 'Removalist has adequate insurance' },
  { value: 'return_access_items', label: 'Return lift keys and access items immediately' },
  { value: 'damage_responsibility', label: 'Applicant accepts responsibility for damage caused' },
  { value: 'permitted_hours', label: 'Observe approved moving hours and booking conditions' },
] as const;

export const INDUCTION_MODULES = [
  { value: 'access_system', label: 'Access system explained' },
  { value: 'waste_system', label: 'Waste system explained' },
  { value: 'recycling', label: 'Recycling requirements explained' },
  { value: 'common_property_rules', label: 'Common property rules explained' },
  { value: 'parking_storage', label: 'Parking and storage rules explained' },
  { value: 'moves_deliveries', label: 'Move and delivery requirements explained' },
  { value: 'emergency_exits', label: 'Emergency exits explained' },
  { value: 'fire_stairs', label: 'Fire stair requirements explained' },
  { value: 'facilities', label: 'Gym and common facilities explained' },
  { value: 'building_manager_contact', label: 'Building Manager contact process explained' },
  { value: 'security_access', label: 'Security and access explained' },
  { value: 'rules_supplied', label: 'By-laws / building rules supplied' },
] as const;

export const FORM_DEFINITIONS: readonly OperationalFormDefinition[] = [
  {
    type: 'daily_activity',
    title: 'Building Manager Daily Activity Log',
    shortTitle: 'Daily Activity',
    description: 'Record a completed task, observation, communication or follow-up in under a minute.',
    audience: 'building_manager',
    expectedCompletionSeconds: 45,
    reportSection: 'other',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'building_inspection',
    title: 'Building Inspection',
    shortTitle: 'Inspection',
    description: 'Complete a structured common-property inspection and create defects from exceptions.',
    audience: 'building_manager',
    expectedCompletionSeconds: 180,
    reportSection: 'building_maintenance_repairs',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'maintenance_defect',
    title: 'Maintenance & Defect Record',
    shortTitle: 'Defect',
    description: 'Record an issue, risk, immediate response and required follow-up.',
    audience: 'building_manager',
    expectedCompletionSeconds: 75,
    reportSection: 'building_maintenance_repairs',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'contractor_sign_in',
    title: 'Contractor Sign-In',
    shortTitle: 'Contractor In',
    description: 'Record attendance, purpose, site area, vehicle and any access item issued.',
    audience: 'contractor',
    expectedCompletionSeconds: 45,
    reportSection: 'contractor_activity',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'contractor_sign_out',
    title: 'Contractor Sign-Out',
    shortTitle: 'Contractor Out',
    description: 'Record work performed, findings, outstanding matters and return of access items.',
    audience: 'contractor',
    expectedCompletionSeconds: 60,
    reportSection: 'contractor_activity',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'move_booking',
    title: 'Move / Large Item Booking',
    shortTitle: 'Move Booking',
    description: 'Request a move, delivery or bulky-item booking and acknowledge building requirements.',
    audience: 'resident',
    expectedCompletionSeconds: 120,
    reportSection: 'resident_movements',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'resident_induction',
    title: 'New Resident Induction',
    shortTitle: 'Induction',
    description: 'Record completion of the site orientation and building-rule briefing.',
    audience: 'building_manager',
    expectedCompletionSeconds: 90,
    reportSection: 'resident_inductions',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'access_device_request',
    title: 'Security Device / Key Request',
    shortTitle: 'Device Request',
    description: 'Request a fob, swipe, remote or physical key, including owner authority where required.',
    audience: 'resident',
    expectedCompletionSeconds: 90,
    reportSection: 'access_devices_keys',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'access_device_issue',
    title: 'Access Device Issue Register',
    shortTitle: 'Issue Device',
    description: 'Record programming, serial identifiers, collection and identity checks.',
    audience: 'internal',
    expectedCompletionSeconds: 60,
    reportSection: 'access_devices_keys',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'waste_activity',
    title: 'Waste Management Log',
    shortTitle: 'Waste Log',
    description: 'Record routine waste work, exceptions, time spent and collection follow-up.',
    audience: 'building_manager',
    expectedCompletionSeconds: 35,
    reportSection: 'waste_management',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'incident',
    title: 'Incident & Security Record',
    shortTitle: 'Incident',
    description: 'Record an incident, immediate action, CCTV details and escalation.',
    audience: 'building_manager',
    expectedCompletionSeconds: 90,
    reportSection: 'building_security',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
  {
    type: 'bylaw_observation',
    title: 'By-law Observation',
    shortTitle: 'By-law',
    description: 'Record an objective common-property observation for Strata decision.',
    audience: 'building_manager',
    expectedCompletionSeconds: 45,
    reportSection: 'bylaw_issues',
    schemaVersion: FORM_SCHEMA_VERSION,
  },
] as const;

const ACTIVITY_REPORT_SECTION = new Map(
  ACTIVITY_CATEGORIES.map((option) => [option.value, option.reportSection ?? 'other'] as const),
);

export function reportSectionForActivity(category: string): MonthlyReportSection {
  return ACTIVITY_REPORT_SECTION.get(category) ?? 'other';
}

export function isOptionValue(options: readonly FormOption[], value: string): boolean {
  return options.some((option) => option.value === value);
}

export const OPERATIONAL_FORM_CONFIG = {
  schemaVersion: FORM_SCHEMA_VERSION,
  definitions: FORM_DEFINITIONS,
  reportSections: MONTHLY_REPORT_SECTIONS,
  options: {
    activityCategories: ACTIVITY_CATEGORIES,
    inspectionTypes: INSPECTION_TYPES,
    inspectionItems: INSPECTION_ITEMS,
    defectCategories: DEFECT_CATEGORIES,
    priorities: PRIORITIES,
    riskLevels: RISK_LEVELS,
    responsibility: RESPONSIBILITY_OPTIONS,
    responsibleParties: RESPONSIBLE_PARTIES,
    activityStatuses: ACTIVITY_STATUSES,
    wasteTypes: WASTE_TYPES,
    wasteActivities: WASTE_ACTIVITIES,
    wasteExceptions: WASTE_EXCEPTION_CATEGORIES,
    incidentCategories: INCIDENT_CATEGORIES,
    bylawCategories: BYLAW_CATEGORIES,
    accessItemTypes: ACCESS_ITEM_TYPES,
    moveTypes: MOVE_TYPES,
    moveAcknowledgements: MOVE_ACKNOWLEDGEMENTS,
    inductionModules: INDUCTION_MODULES,
  },
} as const;
