// P4.16 — order state machine. D7 keeps 10 internal statuses for operations
// and shows buyers an 8-stage stepper (production + QC merged). Every status
// change in the API must go through `transition` so the edge list and the
// role matrix live in one place. Guards that need the database (locked terms,
// approved sample, signed contract, payments, QC, shipment, claims) are
// enforced by the OrdersService before it calls this function.

export const ORDER_FLOW = [
  'NEGOTIATING',
  'SAMPLING',
  'CONTRACT',
  'DEPOSIT',
  'PRODUCTION',
  'QC',
  'FINAL_PAYMENT',
  'SHIPPING',
  'RECEIVED',
  'COMPLETED',
] as const;

export type OrderFlowStatus = (typeof ORDER_FLOW)[number];

export const CANCELLED_STATUS = 'CANCELLED' as const;

export type OrderStatusCode = OrderFlowStatus | typeof CANCELLED_STATUS;

export const ORDER_STATUSES: readonly OrderStatusCode[] = [...ORDER_FLOW, CANCELLED_STATUS];

export interface OrderDisplayStage {
  /** 1-based number shown in the buyer stepper. */
  index: number;
  key: string;
  label: string;
  statuses: readonly OrderFlowStatus[];
}

// D7: 8 buyer-facing stages aggregated from the 10 internal states.
export const ORDER_DISPLAY_STAGES: readonly OrderDisplayStage[] = [
  {
    index: 1,
    key: 'negotiating',
    label: 'Thương lượng',
    statuses: ['NEGOTIATING'],
  },
  {
    index: 2,
    key: 'sampling',
    label: 'Lấy mẫu',
    statuses: ['SAMPLING'],
  },
  {
    index: 3,
    key: 'contract',
    label: 'Hợp đồng',
    statuses: ['CONTRACT'],
  },
  {
    index: 4,
    key: 'deposit',
    label: 'Đặt cọc',
    statuses: ['DEPOSIT'],
  },
  {
    index: 5,
    key: 'production_qc',
    label: 'Chờ hàng hoàn tất',
    statuses: ['PRODUCTION', 'QC'],
  },
  {
    index: 6,
    key: 'final_payment',
    label: 'Thanh toán còn lại',
    statuses: ['FINAL_PAYMENT'],
  },
  {
    index: 7,
    key: 'shipping',
    label: 'Vận chuyển',
    statuses: ['SHIPPING'],
  },
  {
    index: 8,
    key: 'received_completed',
    label: 'Nhận hàng & hoàn tất',
    statuses: ['RECEIVED', 'COMPLETED'],
  },
];

export const ORDER_TRANSITIONS: Record<OrderStatusCode, readonly OrderStatusCode[]> = {
  NEGOTIATING: ['SAMPLING', 'CANCELLED'],
  SAMPLING: ['CONTRACT', 'CANCELLED'],
  CONTRACT: ['DEPOSIT', 'CANCELLED'],
  DEPOSIT: ['PRODUCTION', 'CANCELLED'],
  PRODUCTION: ['QC', 'CANCELLED'],
  // QC failure sends the order back to production for rework.
  QC: ['FINAL_PAYMENT', 'PRODUCTION', 'CANCELLED'],
  FINAL_PAYMENT: ['SHIPPING', 'CANCELLED'],
  SHIPPING: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

// Actor roles are relative to the order: buyer = order.buyer, supplier = an
// account of order.supplier, the rest are CVC staff. Admins may inspect every
// order but only the roles below may fire a given edge.
export const ORDER_ACTOR_ROLES = ['buyer', 'supplier', 'sales', 'inspector', 'admin'] as const;

export type OrderActorRole = (typeof ORDER_ACTOR_ROLES)[number];

export type OrderTransitionActors = Partial<Record<OrderStatusCode, readonly OrderActorRole[]>>;

export const ORDER_TRANSITION_ACTORS: Record<OrderStatusCode, OrderTransitionActors> = {
  NEGOTIATING: {
    SAMPLING: ['buyer', 'supplier'],
    CANCELLED: ['buyer', 'supplier', 'admin'],
  },
  SAMPLING: {
    CONTRACT: ['buyer'],
    CANCELLED: ['buyer', 'supplier', 'admin'],
  },
  CONTRACT: {
    DEPOSIT: ['buyer'],
    CANCELLED: ['buyer', 'supplier', 'admin'],
  },
  // After the deposit only staff may cancel (contract terms + D8 pending).
  DEPOSIT: { PRODUCTION: ['admin'], CANCELLED: ['admin'] },
  PRODUCTION: { QC: ['supplier'], CANCELLED: ['admin'] },
  QC: {
    FINAL_PAYMENT: ['inspector', 'admin'],
    PRODUCTION: ['inspector', 'admin'],
    CANCELLED: ['admin'],
  },
  FINAL_PAYMENT: { SHIPPING: ['admin'], CANCELLED: ['admin'] },
  SHIPPING: { RECEIVED: ['buyer'], CANCELLED: ['admin'] },
  RECEIVED: { COMPLETED: ['admin'], CANCELLED: ['admin'] },
  COMPLETED: {},
  CANCELLED: {},
};

export interface OrderStateSnapshot {
  status: OrderStatusCode;
  stageIndex?: number;
}

export interface OrderTransitionActor {
  role: OrderActorRole;
}

export interface OrderStepperItem extends OrderDisplayStage {
  state: 'done' | 'current' | 'pending';
}

export type OrderTransitionResult =
  | {
      ok: true;
      from: OrderStatusCode;
      to: OrderStatusCode;
      /** Index into the 10-status flow; keeps the last value on cancel. */
      stageIndex: number;
      displayStageIndex: number | null;
      displayStage: string | null;
    }
  | {
      ok: false;
      code: 'INVALID_TRANSITION' | 'FORBIDDEN';
      message: string;
    };

export function isOrderStatus(value: unknown): value is OrderStatusCode {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function orderStageIndex(status: OrderStatusCode): number {
  return (ORDER_FLOW as readonly string[]).indexOf(status);
}

export function displayStageFor(status: OrderStatusCode): OrderDisplayStage | null {
  return (
    ORDER_DISPLAY_STAGES.find((stage) => (stage.statuses as readonly string[]).includes(status)) ??
    null
  );
}

export function orderStepper(status: OrderStatusCode): OrderStepperItem[] {
  const stage = displayStageFor(status);
  return ORDER_DISPLAY_STAGES.map((item) => ({
    ...item,
    state:
      stage === null
        ? 'pending'
        : item.index < stage.index
          ? 'done'
          : item.index === stage.index
            ? 'current'
            : 'pending',
  }));
}

// Pure edge + role check. Database guards are the caller's responsibility.
export function transition(
  order: OrderStateSnapshot,
  to: OrderStatusCode,
  actor: OrderTransitionActor,
): OrderTransitionResult {
  const from = order.status;
  const allowed = ORDER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Không thể chuyển đơn từ ${from} sang ${to}.`,
    };
  }

  const roles = ORDER_TRANSITION_ACTORS[from]?.[to] ?? [];
  if (!roles.includes(actor.role)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `Vai trò ${actor.role} không được thực hiện bước này.`,
    };
  }

  const display = displayStageFor(to);
  return {
    ok: true,
    from,
    to,
    stageIndex:
      to === CANCELLED_STATUS ? (order.stageIndex ?? orderStageIndex(from)) : orderStageIndex(to),
    displayStageIndex: display?.index ?? null,
    displayStage: display?.label ?? null,
  };
}
