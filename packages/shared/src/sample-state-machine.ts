// P4.17 — sample state machine. The production sample follows
// requested → uploaded → sent → in_transit → delivered →
// (revision_requested → uploaded…) | approved.
// The legacy SHIPPED value stays readable for older rows but the new flow
// uses SENT. Approved samples are terminal: they can no longer be revised.

export const SAMPLE_STATUSES = [
  'REQUESTED',
  'UPLOADED',
  'SENT',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'REVISION_REQUESTED',
  'APPROVED',
  'REJECTED',
  'STOPPED',
] as const;

export type SampleStatusCode = (typeof SAMPLE_STATUSES)[number];

export const SAMPLE_TRANSITIONS: Record<SampleStatusCode, readonly SampleStatusCode[]> = {
  REQUESTED: ['UPLOADED', 'STOPPED'],
  REVISION_REQUESTED: ['UPLOADED', 'STOPPED'],
  UPLOADED: ['SENT', 'STOPPED'],
  SENT: ['IN_TRANSIT', 'DELIVERED', 'STOPPED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERED', 'STOPPED'],
  IN_TRANSIT: ['DELIVERED', 'STOPPED'],
  DELIVERED: ['REVISION_REQUESTED', 'APPROVED', 'STOPPED'],
  APPROVED: [],
  REJECTED: [],
  STOPPED: [],
};

// Roles relative to the sample/order. Sales may enter manual milestones.
export const SAMPLE_TRANSITION_ACTORS: Record<
  SampleStatusCode,
  Partial<Record<SampleStatusCode, readonly SampleActorRole[]>>
> = {
  REQUESTED: { UPLOADED: ['supplier'], STOPPED: ['buyer', 'supplier', 'admin'] },
  REVISION_REQUESTED: { UPLOADED: ['supplier'], STOPPED: ['buyer', 'supplier', 'admin'] },
  UPLOADED: { SENT: ['supplier'], STOPPED: ['buyer', 'supplier', 'admin'] },
  SENT: {
    IN_TRANSIT: ['supplier', 'sales'],
    DELIVERED: ['supplier', 'sales', 'buyer'],
    STOPPED: ['buyer', 'supplier', 'admin'],
  },
  SHIPPED: {
    IN_TRANSIT: ['supplier', 'sales'],
    DELIVERED: ['supplier', 'sales', 'buyer'],
    STOPPED: ['buyer', 'supplier', 'admin'],
  },
  IN_TRANSIT: {
    DELIVERED: ['supplier', 'sales', 'buyer'],
    STOPPED: ['buyer', 'supplier', 'admin'],
  },
  DELIVERED: {
    REVISION_REQUESTED: ['buyer'],
    APPROVED: ['buyer'],
    STOPPED: ['buyer', 'supplier', 'admin'],
  },
  APPROVED: {},
  REJECTED: {},
  STOPPED: {},
};

export const SAMPLE_ACTOR_ROLES = ['buyer', 'supplier', 'sales', 'admin'] as const;

export type SampleActorRole = (typeof SAMPLE_ACTOR_ROLES)[number];

export interface SampleStateSnapshot {
  status: SampleStatusCode;
}

export type SampleTransitionResult =
  | { ok: true; from: SampleStatusCode; to: SampleStatusCode }
  | { ok: false; code: 'INVALID_TRANSITION' | 'FORBIDDEN'; message: string };

export function isSampleStatus(value: unknown): value is SampleStatusCode {
  return typeof value === 'string' && (SAMPLE_STATUSES as readonly string[]).includes(value);
}

export function sampleStage(status: SampleStatusCode, revisionCount = 0) {
  const round = revisionCount + 1;
  return { status, round };
}

export function sampleTransition(
  sample: SampleStateSnapshot,
  to: SampleStatusCode,
  actor: { role: SampleActorRole },
): SampleTransitionResult {
  const from = sample.status;
  const allowed = SAMPLE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Không thể chuyển mẫu từ ${from} sang ${to}.`,
    };
  }
  const roles = SAMPLE_TRANSITION_ACTORS[from]?.[to] ?? [];
  if (!roles.includes(actor.role)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `Vai trò ${actor.role} không được thực hiện bước này.`,
    };
  }
  return { ok: true, from, to };
}
