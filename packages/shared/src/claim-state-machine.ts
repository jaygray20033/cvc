// P4.22 — claim (dispute) state machine. Claim statuses are explicit so the
// API never writes `Claim.status` outside this table. Legacy P3.3 values
// (RESOLVED/CANCELLED) stay terminal for rows created before P4.22.
//
// Flow (todo P4.22):
//   opened → proposed → resolution_chosen →
//     (topup_pending → topup_confirmed) |
//     (return_sent → return_received) →
//     refund_executed → refund_confirmed → closed
// Branches: rejected, withdrawn.

export const CLAIM_STATUSES = [
  'OPEN',
  'PROPOSED',
  'RESOLUTION_CHOSEN',
  'TOPUP_PENDING',
  'TOPUP_CONFIRMED',
  'RETURN_SENT',
  'RETURN_RECEIVED',
  'REFUND_EXECUTED',
  'REFUND_CONFIRMED',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  // Legacy (pre-P4.22) terminal values.
  'RESOLVED',
  'CANCELLED',
] as const;

export type ClaimStatusCode = (typeof CLAIM_STATUSES)[number];

export const CLAIM_TRANSITIONS: Record<ClaimStatusCode, readonly ClaimStatusCode[]> = {
  OPEN: ['PROPOSED', 'REJECTED', 'WITHDRAWN'],
  PROPOSED: ['RESOLUTION_CHOSEN', 'TOPUP_PENDING', 'REJECTED', 'WITHDRAWN'],
  RESOLUTION_CHOSEN: ['RETURN_SENT', 'REFUND_EXECUTED', 'REJECTED', 'WITHDRAWN'],
  TOPUP_PENDING: ['TOPUP_CONFIRMED', 'REJECTED'],
  TOPUP_CONFIRMED: ['CLOSED'],
  RETURN_SENT: ['RETURN_RECEIVED', 'REJECTED'],
  RETURN_RECEIVED: ['REFUND_EXECUTED', 'REJECTED'],
  REFUND_EXECUTED: ['REFUND_CONFIRMED'],
  REFUND_CONFIRMED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
  WITHDRAWN: [],
  RESOLVED: [],
  CANCELLED: [],
};

export const CLAIM_ACTOR_ROLES = ['buyer', 'supplier', 'sales', 'inspector', 'admin'] as const;

export type ClaimActorRole = (typeof CLAIM_ACTOR_ROLES)[number];

export type ClaimTransitionActors = Partial<Record<ClaimStatusCode, readonly ClaimActorRole[]>>;

export const CLAIM_TRANSITION_ACTORS: Record<ClaimStatusCode, ClaimTransitionActors> = {
  OPEN: { PROPOSED: ['supplier', 'sales', 'admin'], REJECTED: ['admin'], WITHDRAWN: ['buyer'] },
  PROPOSED: {
    RESOLUTION_CHOSEN: ['buyer'],
    TOPUP_PENDING: ['buyer'],
    REJECTED: ['admin'],
    WITHDRAWN: ['buyer'],
  },
  RESOLUTION_CHOSEN: {
    RETURN_SENT: ['buyer'],
    REFUND_EXECUTED: ['admin'],
    REJECTED: ['admin'],
    WITHDRAWN: ['buyer'],
  },
  TOPUP_PENDING: { TOPUP_CONFIRMED: ['buyer'], REJECTED: ['admin'] },
  TOPUP_CONFIRMED: { CLOSED: ['admin'] },
  RETURN_SENT: { RETURN_RECEIVED: ['admin'], REJECTED: ['admin'] },
  RETURN_RECEIVED: { REFUND_EXECUTED: ['admin'], REJECTED: ['admin'] },
  REFUND_EXECUTED: { REFUND_CONFIRMED: ['buyer'] },
  REFUND_CONFIRMED: { CLOSED: ['admin'] },
  CLOSED: {},
  REJECTED: {},
  WITHDRAWN: {},
  RESOLVED: {},
  CANCELLED: {},
};

// Statuses that still block order completion (P4.16 COMPLETED guard). A claim
// waiting only for the buyer's confirmation or the admin's close is not
// considered open: the money/return part is already done.
export const CLAIM_OPEN_STATUSES: readonly ClaimStatusCode[] = [
  'OPEN',
  'PROPOSED',
  'RESOLUTION_CHOSEN',
  'TOPUP_PENDING',
  'RETURN_SENT',
  'RETURN_RECEIVED',
  'REFUND_EXECUTED',
];

export function isClaimOpen(status: string): boolean {
  return (CLAIM_OPEN_STATUSES as readonly string[]).includes(status);
}

export type ClaimTransitionResult =
  | { ok: true; from: ClaimStatusCode; to: ClaimStatusCode }
  | { ok: false; code: 'INVALID_TRANSITION' | 'FORBIDDEN'; message: string };

export function transitionClaim(
  from: ClaimStatusCode,
  to: ClaimStatusCode,
  actor: { role: ClaimActorRole | string },
): ClaimTransitionResult {
  const allowed = CLAIM_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Không chuyển được khiếu nại từ ${from} sang ${to}.`,
    };
  }
  const actors = CLAIM_TRANSITION_ACTORS[from]?.[to] ?? [];
  if (!actors.includes(actor.role as ClaimActorRole)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `Vai trò ${actor.role} không được chuyển ${from} → ${to}.`,
    };
  }
  return { ok: true, from, to };
}

// Resolution choices accepted per claim type (mirrors the demo flow).
export const CLAIM_RESOLUTIONS = ['TOPUP', 'REFUND', 'RETURN_REFUND'] as const;
export type ClaimResolutionKind = (typeof CLAIM_RESOLUTIONS)[number];

export function allowedResolutionsFor(type: string): readonly ClaimResolutionKind[] {
  return type === 'MISSING' ? ['TOPUP', 'REFUND'] : ['RETURN_REFUND'];
}
