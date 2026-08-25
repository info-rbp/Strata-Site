// Explicit status machines for every lifecycle in the build guide. Status
// transitions are validated here, server-side — never trust a client-supplied
// status jump. Mirrors ProInspect's workflow-gate pattern (see
// packages/domain/src/workflow.ts in the reference repo).

export const DEFECT_STATUSES = [
  'new',
  'bm_assessment',
  'minor_repair',
  'contractor_required',
  'awaiting_approval',
  'approved',
  'contractor_booked',
  'in_progress',
  'awaiting_verification',
  'completed',
  'closed',
] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

const DEFECT_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  new: ['bm_assessment'],
  bm_assessment: ['minor_repair', 'contractor_required'],
  minor_repair: ['awaiting_verification', 'completed'],
  contractor_required: ['awaiting_approval', 'approved', 'contractor_booked'],
  awaiting_approval: ['approved', 'bm_assessment'],
  approved: ['contractor_booked'],
  contractor_booked: ['in_progress'],
  in_progress: ['awaiting_verification'],
  awaiting_verification: ['completed', 'in_progress'],
  completed: ['closed'],
  closed: [],
};

export function canTransitionDefect(from: DefectStatus, to: DefectStatus): boolean {
  return DEFECT_TRANSITIONS[from]?.includes(to) ?? false;
}

// Closing a defect requires completion evidence + BM verification unless the
// defect was a same-visit minor repair.
export function canCloseDefect(params: {
  status: DefectStatus;
  hasCompletionEvidence: boolean;
  verifiedByUserId: string | null | undefined;
}): { allowed: boolean; reason?: string } {
  if (params.status !== 'completed') {
    return { allowed: false, reason: 'Defect must be in completed status before closing.' };
  }
  if (!params.hasCompletionEvidence) {
    return { allowed: false, reason: 'Completion evidence is required before closing a defect.' };
  }
  if (!params.verifiedByUserId) {
    return { allowed: false, reason: 'Building Manager verification is required before closing a defect.' };
  }
  return { allowed: true };
}

export const WORK_ORDER_STATUSES = [
  'created',
  'scheduled',
  'in_progress',
  'completed',
  'verified',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  created: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: ['verified'],
  verified: [],
  cancelled: [],
};

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export const MOVE_STATUSES = [
  'new',
  'pending_approval',
  'approved',
  'declined',
  'pre_move_setup',
  'in_progress',
  'post_move_inspection',
  'closed',
] as const;
export type MoveStatus = (typeof MOVE_STATUSES)[number];

const MOVE_TRANSITIONS: Record<MoveStatus, MoveStatus[]> = {
  new: ['pending_approval'],
  pending_approval: ['approved', 'declined'],
  approved: ['pre_move_setup'],
  declined: [],
  pre_move_setup: ['in_progress'],
  in_progress: ['post_move_inspection'],
  post_move_inspection: ['closed'],
  closed: [],
};

export function canTransitionMove(from: MoveStatus, to: MoveStatus): boolean {
  return MOVE_TRANSITIONS[from]?.includes(to) ?? false;
}

// A move cannot close until keys/access items are returned and post-move
// inspection is complete (Section 5.3).
export function canCloseMove(params: {
  status: MoveStatus;
  keysReturned: boolean;
  hasPostMoveInspection: boolean;
}): { allowed: boolean; reason?: string } {
  if (params.status !== 'post_move_inspection') {
    return { allowed: false, reason: 'Move must be in post_move_inspection status.' };
  }
  if (!params.keysReturned) {
    return { allowed: false, reason: 'Keys/access items must be returned before the move can close.' };
  }
  if (!params.hasPostMoveInspection) {
    return { allowed: false, reason: 'Post-move inspection must be recorded before closing.' };
  }
  return { allowed: true };
}

export const ACCESS_DEVICE_REQUEST_STATUSES = [
  'submitted',
  'awaiting_authorisation',
  'approved',
  'programming',
  'ready_for_collection',
  'issued',
  'declined',
] as const;
export type AccessDeviceRequestStatus = (typeof ACCESS_DEVICE_REQUEST_STATUSES)[number];

const ACCESS_DEVICE_REQUEST_TRANSITIONS: Record<AccessDeviceRequestStatus, AccessDeviceRequestStatus[]> = {
  submitted: ['awaiting_authorisation', 'approved', 'declined'],
  awaiting_authorisation: ['approved', 'declined'],
  approved: ['programming'],
  programming: ['ready_for_collection'],
  ready_for_collection: ['issued'],
  issued: [],
  declined: [],
};

export function canTransitionAccessDeviceRequest(
  from: AccessDeviceRequestStatus,
  to: AccessDeviceRequestStatus,
): boolean {
  return ACCESS_DEVICE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

// Contractor sign-out cannot fully close while a key is outstanding, unless a
// Building Manager override with a reason is recorded (Section 9.2).
export function canSignOutAttendance(params: {
  keyIssued: boolean;
  keyReturned: boolean;
  overrideReason?: string | null;
}): { allowed: boolean; requiresOverride: boolean; reason?: string } {
  if (!params.keyIssued || params.keyReturned) {
    return { allowed: true, requiresOverride: false };
  }
  if (params.overrideReason && params.overrideReason.trim().length > 0) {
    return { allowed: true, requiresOverride: true };
  }
  return {
    allowed: false,
    requiresOverride: true,
    reason: 'A key/access item remains outstanding. Building Manager override with reason is required to sign out.',
  };
}

// High-risk defects and high-severity incidents require immediate escalation
// tasks — used by routes to decide default task priority/urgency.
export function isImmediateEscalation(riskLevel: string): boolean {
  return riskLevel === 'high' || riskLevel === 'immediate_danger';
}
