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

// Money currencies. Never use float for money amounts.
export enum Currency {
  VND = 'VND',
  CNY = 'CNY',
}
