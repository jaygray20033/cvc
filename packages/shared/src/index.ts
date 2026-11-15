// Shared types and enums for api + web.

// The 7 platform roles (see CLAUDE.md and demo domain.js).
export enum Role {
  Buyer = 'buyer',
  Participant = 'participant',
  Retailer = 'retailer',
  Supplier = 'supplier',
  Sales = 'sales',
  Inspector = 'inspector',
  Admin = 'admin',
}

// All role values, used for Zod validation and seed data.
export const ROLE_VALUES: Role[] = Object.values(Role);

// Fine-grained permission groups for admin users (P2.10). Stored as extra
// rows in the user_roles table; only meaningful for users holding `admin`.
// - admin_super: everything incl. system config
// - admin_finance: payout/approve money (exclusive with ops/support)
// - admin_ops: operations
// - admin_support: customer support
export const ADMIN_GROUPS = ['admin_super', 'admin_finance', 'admin_ops', 'admin_support'] as const;

export type AdminGroup = (typeof ADMIN_GROUPS)[number];

// Groups allowed to approve/payout money (P2.10).
export const ADMIN_MONEY_GROUPS: AdminGroup[] = ['admin_finance', 'admin_super'];
// Groups allowed to change system configuration (P2.10).
export const ADMIN_CONFIG_GROUPS: AdminGroup[] = ['admin_super'];

// Money currencies. Never use float for money amounts.
export enum Currency {
  VND = 'VND',
  CNY = 'CNY',
}

// KYC gating levels (P2.15). Applied with @RequireKyc(level) on endpoints that
// must be blocked until the account is verified. Ordered: FULL implies BASIC.
// - BASIC: personal identity verified — has an APPROVED KYC submission.
//   Used for: join a lot (mua hộ), register to sell (bán giùm), sign contract.
// - FULL: BASIC + a bank account on file (needed before money can move out).
//   Used for: withdraw/payout (rút tiền).
// The exact endpoint->level mapping is provisional pending business sign-off;
// adjust the decorator argument, not the guard.
export const KYC_LEVELS = ['BASIC', 'FULL'] as const;

export type KycLevel = (typeof KYC_LEVELS)[number];
