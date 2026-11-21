import {
  displayStageFor,
  ORDER_ACTOR_ROLES,
  ORDER_DISPLAY_STAGES,
  ORDER_FLOW,
  ORDER_STATUSES,
  ORDER_TRANSITION_ACTORS,
  ORDER_TRANSITIONS,
  type OrderActorRole,
  orderStageIndex,
  orderStepper,
  transition,
} from '@cvc/shared';
import {
  SAMPLE_ACTOR_ROLES,
  SAMPLE_STATUSES,
  SAMPLE_TRANSITION_ACTORS,
  SAMPLE_TRANSITIONS,
  type SampleActorRole,
  type SampleStatusCode,
  sampleTransition,
} from '@cvc/shared';

// P4.16/P4.17 DoD — every (from, to, role) tuple is checked, not just the
// happy path: invalid edges are INVALID_TRANSITION, valid edges with the
// wrong role are FORBIDDEN, and allowed edges succeed.
describe('order state machine (P4.16)', () => {
  it('covers every status pair and role with the expected outcome', () => {
    let validEdges = 0;
    for (const from of ORDER_STATUSES) {
      const edges = ORDER_TRANSITIONS[from];
      for (const to of ORDER_STATUSES) {
        const isEdge = edges.includes(to);
        if (isEdge) validEdges += 1;
        const actors = (ORDER_TRANSITION_ACTORS[from]?.[to] ?? []) as readonly OrderActorRole[];
        for (const role of ORDER_ACTOR_ROLES) {
          const result = transition({ status: from, stageIndex: 0 }, to, { role });
          if (!isEdge) {
            expect(result).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
          } else if (!actors.includes(role)) {
            expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
          } else {
            expect(result.ok).toBe(true);
          }
        }
      }
    }
    // 9 forward edges + QC rework + 9 cancellations = 19.
    expect(validEdges).toBe(19);
  });

  it('maps the 10 internal statuses onto the 8 buyer stages', () => {
    expect(ORDER_FLOW).toHaveLength(10);
    expect(ORDER_DISPLAY_STAGES).toHaveLength(8);
    expect(orderStageIndex('NEGOTIATING')).toBe(0);
    expect(orderStageIndex('COMPLETED')).toBe(9);
    expect(displayStageFor('PRODUCTION')?.index).toBe(5);
    expect(displayStageFor('QC')?.index).toBe(5);
    expect(displayStageFor('RECEIVED')?.index).toBe(8);
    expect(displayStageFor('CANCELLED')).toBeNull();

    const stepper = orderStepper('PRODUCTION');
    expect(stepper.map((item) => item.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('allows cancellation by both parties before deposit and only admin after', () => {
    expect(transition({ status: 'NEGOTIATING' }, 'CANCELLED', { role: 'buyer' }).ok).toBe(true);
    expect(transition({ status: 'CONTRACT' }, 'CANCELLED', { role: 'supplier' }).ok).toBe(true);
    expect(transition({ status: 'DEPOSIT' }, 'CANCELLED', { role: 'buyer' })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(transition({ status: 'DEPOSIT' }, 'CANCELLED', { role: 'admin' }).ok).toBe(true);
    // Terminal statuses accept nothing.
    for (const to of ORDER_STATUSES) {
      expect(transition({ status: 'COMPLETED' }, to, { role: 'admin' }).ok).toBe(false);
      expect(transition({ status: 'CANCELLED' }, to, { role: 'admin' }).ok).toBe(false);
    }
  });

  it('rejects self-transitions even when the status is otherwise valid', () => {
    for (const status of ORDER_STATUSES) {
      expect(transition({ status }, status, { role: 'admin' })).toMatchObject({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
  });
});

describe('sample state machine (P4.17)', () => {
  it('covers every sample status pair and role', () => {
    for (const from of SAMPLE_STATUSES as readonly SampleStatusCode[]) {
      const edges = SAMPLE_TRANSITIONS[from];
      for (const to of SAMPLE_STATUSES as readonly SampleStatusCode[]) {
        const isEdge = edges.includes(to);
        const actors = (SAMPLE_TRANSITION_ACTORS[from]?.[to] ?? []) as readonly SampleActorRole[];
        for (const role of SAMPLE_ACTOR_ROLES) {
          const result = sampleTransition({ status: from }, to, { role });
          if (!isEdge) {
            expect(result).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
          } else if (!actors.includes(role)) {
            expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
          } else {
            expect(result.ok).toBe(true);
          }
        }
      }
    }
  });

  it('makes approved/rejected/stopped terminal', () => {
    for (const status of ['APPROVED', 'REJECTED', 'STOPPED'] as const) {
      for (const to of SAMPLE_STATUSES) {
        expect(sampleTransition({ status }, to, { role: 'buyer' }).ok).toBe(false);
      }
    }
    expect(sampleTransition({ status: 'DELIVERED' }, 'APPROVED', { role: 'buyer' }).ok).toBe(true);
    expect(
      sampleTransition({ status: 'APPROVED' }, 'REVISION_REQUESTED', { role: 'buyer' }),
    ).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('only the supplier uploads/ships while the buyer receives/revises/approves', () => {
    expect(sampleTransition({ status: 'REQUESTED' }, 'UPLOADED', { role: 'buyer' }).ok).toBe(false);
    expect(sampleTransition({ status: 'REQUESTED' }, 'UPLOADED', { role: 'supplier' }).ok).toBe(
      true,
    );
    expect(sampleTransition({ status: 'UPLOADED' }, 'SENT', { role: 'sales' }).ok).toBe(false);
    expect(sampleTransition({ status: 'UPLOADED' }, 'SENT', { role: 'supplier' }).ok).toBe(true);
    expect(sampleTransition({ status: 'DELIVERED' }, 'APPROVED', { role: 'supplier' }).ok).toBe(
      false,
    );
    expect(sampleTransition({ status: 'DELIVERED' }, 'APPROVED', { role: 'buyer' }).ok).toBe(true);
  });
});
