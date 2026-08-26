// ProInspect Building Management capability-based access model. Never gate
// API access with ad-hoc role checks when a capability can express the rule.

export const ROLES = [
  'system_administrator',
  'strata_manager',
  'council_member',
  'building_manager',
  'relief_building_manager',
  'contractor',
  'resident',
] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  // Property / structure
  'property.read', 'property.manage',
  // Users
  'user.read', 'user.invite', 'user.manage', 'user.audit.read',
  // Operational forms and daily diary
  'form.read', 'activity.read', 'activity.create',
  // Resident requests / defects / work orders
  'request.create', 'request.read', 'request.triage',
  'defect.read', 'defect.manage', 'defect.verify',
  'workorder.read', 'workorder.manage', 'workorder.complete', 'workorder.verify',
  // Contractors / attendance / keys
  'contractor.read', 'contractor.manage',
  'attendance.read', 'attendance.manage', 'attendance.override',
  'key.read', 'key.manage',
  // Access devices
  'accessdevice.read', 'accessdevice.request', 'accessdevice.manage',
  // Moves
  'move.create', 'move.read', 'move.approve', 'move.manage',
  // Inspections
  'inspection.read', 'inspection.run', 'inspection.manage',
  // Assets / maintenance
  'asset.read', 'asset.manage', 'maintenance.read', 'maintenance.manage',
  // Waste
  'waste.read', 'waste.manage',
  // Incidents / bylaw
  'incident.read', 'incident.manage',
  'bylaw.read', 'bylaw.create', 'bylaw.decide',
  // Quotes / approvals
  'quote.read', 'quote.manage', 'approval.decide',
  // Notices / documents / communications
  'notice.read', 'notice.manage', 'document.read', 'document.manage',
  // Reporting / dashboards / audit
  'dashboard.bm.read', 'dashboard.strata.read',
  'report.generate', 'report.edit', 'report.finalise', 'audit.read',
  // Integration outbox / future Google Sheets connector
  'integration.read', 'integration.manage',
  // Tasks / calendar
  'task.read', 'task.manage', 'calendar.read',
  // Handover
  'handover.read', 'handover.manage',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const residentCapabilities: Capability[] = [
  'request.create', 'request.read',
  'move.create', 'move.read',
  'accessdevice.request', 'accessdevice.read',
  'notice.read', 'document.read',
];

// Contractors may submit their own attendance and completion evidence, but
// cannot manage the key register, other contractors, or the document library.
const contractorCapabilities: Capability[] = [
  'workorder.read', 'workorder.complete',
  'attendance.read', 'attendance.manage',
];

const buildingManagerCapabilities: Capability[] = [
  'property.read',
  'form.read', 'activity.read', 'activity.create',
  'request.read', 'request.triage',
  'defect.read', 'defect.manage', 'defect.verify',
  'workorder.read', 'workorder.manage', 'workorder.complete', 'workorder.verify',
  'contractor.read', 'contractor.manage',
  'attendance.read', 'attendance.manage', 'attendance.override',
  'key.read', 'key.manage',
  'accessdevice.read', 'accessdevice.manage',
  'move.read', 'move.approve', 'move.manage',
  'inspection.read', 'inspection.run', 'inspection.manage',
  'asset.read', 'asset.manage', 'maintenance.read', 'maintenance.manage',
  'waste.read', 'waste.manage',
  'incident.read', 'incident.manage',
  'bylaw.read', 'bylaw.create',
  'quote.read', 'quote.manage',
  'notice.read', 'notice.manage', 'document.read', 'document.manage',
  'dashboard.bm.read',
  'report.generate', 'report.edit', 'report.finalise',
  'task.read', 'task.manage', 'calendar.read',
  'handover.read', 'handover.manage',
];

// Relief Building Manager has the same operational permissions, while account
// expiry remains enforced by auth middleware.
const reliefBuildingManagerCapabilities: Capability[] = buildingManagerCapabilities;

const strataManagerCapabilities: Capability[] = [
  'property.read', 'user.read', 'user.invite', 'user.manage',
  'form.read', 'activity.read',
  'request.read',
  'defect.read', 'defect.manage',
  'workorder.read',
  'contractor.read',
  'attendance.read',
  'key.read',
  'accessdevice.read',
  'move.read', 'move.approve',
  'inspection.read',
  'asset.read', 'maintenance.read',
  'waste.read',
  'incident.read',
  'bylaw.read', 'bylaw.decide',
  'quote.read', 'quote.manage', 'approval.decide',
  'notice.read', 'notice.manage', 'document.read', 'document.manage',
  'dashboard.bm.read', 'dashboard.strata.read',
  'report.generate', 'report.edit', 'report.finalise', 'audit.read',
  'integration.read', 'integration.manage',
  'task.read', 'calendar.read',
  'handover.read',
];

const councilMemberCapabilities: Capability[] = [
  'property.read', 'form.read', 'activity.read',
  'defect.read', 'workorder.read', 'contractor.read',
  'move.read', 'asset.read', 'maintenance.read', 'incident.read',
  'quote.read', 'notice.read', 'document.read',
  'dashboard.strata.read', 'report.generate',
];

const systemAdministratorCapabilities: Capability[] = [...CAPABILITIES];

export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  system_administrator: systemAdministratorCapabilities,
  strata_manager: strataManagerCapabilities,
  council_member: councilMemberCapabilities,
  building_manager: buildingManagerCapabilities,
  relief_building_manager: reliefBuildingManagerCapabilities,
  contractor: contractorCapabilities,
  resident: residentCapabilities,
};

export function roleCapabilities(role: Role | undefined): readonly Capability[] {
  return role ? ROLE_CAPABILITIES[role] ?? [] : [];
}

export function roleHasCapability(role: Role | undefined, capability: Capability): boolean {
  return roleCapabilities(role).includes(capability);
}

// Roles whose operational scope is a single property. Strata, Council and
// System Administrators may operate across both Prima and Meridian.
export const SINGLE_PROPERTY_ROLES: readonly Role[] = [
  'building_manager',
  'relief_building_manager',
  'contractor',
  'resident',
];

export function isMultiPropertyRole(role: Role): boolean {
  return !SINGLE_PROPERTY_ROLES.includes(role);
}
