export type Paise = number;
export type Role = 'cashier' | 'manager' | 'office' | 'owner';
export type ExciseGroup = 'BEER' | 'IML';

export interface Product {
  id: string;
  materialType: 'ALC' | 'NALC';
  category: 'BEER' | 'IML' | 'WINE' | 'NALC';
  subcategory: string;
  description: string;
  brand: string;
  shortName: string;
  sizeMl: number | null;
  pack: 'BTL' | 'CAN' | 'PET' | 'TPACK' | null;
  caseSize: number;
  hsn: string;
  taxRateBp: number;
  barcode: string;
  image?: string;
}

export interface Price {
  id?: number;
  productId: string;
  mrp: Paise;
  purchase: Paise;
  aroed: Paise;
  cess: Paise;
  effectiveFrom: string;
  pushedBy: string;
}

export interface Store {
  code: string;
  number: string;
  name: string;
  branchSlug: string | null;
  isHub: boolean;
  upiVpa: string;
  licenceNo: string;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: Role;
  pinHash: string;
  storeCodes: string[];
}

export type MovementKind =
  | 'opening'
  | 'purchase'
  | 'purchase_return'
  | 'transfer_in'
  | 'transfer_out'
  | 'sale'
  | 'void'
  | 'count_adjust'
  | 'loss';

export interface StockMovement {
  id?: number;
  storeCode: string;
  productId: string;
  qty: number;
  kind: MovementKind;
  ref: string;
  at: string;
  expiresOn?: string;
}

export type PayMode = 'cash' | 'upi' | 'card';

export interface Bill {
  number: string;
  clientId: string;
  storeCode: string;
  counter: number;
  cashierId: string;
  shiftId: string;
  at: string;
  memberCode?: string;
  customerName?: string;
  gross: Paise;
  discount: Paise;
  tax: Paise;
  net: Paise;
  status: 'paid' | 'void' | 'practice';
}

export interface BillLine {
  id?: number;
  billNumber: string;
  productId: string;
  qty: number;
  mrp: Paise;
  offerCode?: string;
  discount: Paise;
  tax: Paise;
  amount: Paise;
}

export interface Payment {
  id?: number;
  billNumber: string;
  mode: PayMode;
  amount: Paise;
}

export interface Offer {
  code: string;
  type: 'store' | 'brand';
  productId?: string;
  brand?: string;
  discountType: 'amount' | 'free_qty';
  amountPerUnit?: Paise;
  buyQty?: number;
  freeQty?: number;
  from: string;
  to: string;
  createdBy: string;
}

export interface Shift {
  id: string;
  storeCode: string;
  cashierId: string;
  openedAt: string;
  closedAt?: string;
  floatPaise: Paise;
  counted?: Paise;
  expected?: Paise;
  diff?: Paise;
}

/** A locked day. `totals` is narrowed by the day-close task. */
export interface DayClose {
  storeCode: string;
  date: string;
  lockedAt: string;
  totals: unknown;
}

export interface Supplier {
  id: string;
  name: string;
  kind: 'ksbcl' | 'other';
}

export interface SupplierPayment {
  id?: number;
  supplierId: string;
  amount: Paise;
  paidOn: string;
  ref: string;
}

/** A KSBCL indent. `id` is the indent number, `INDMYH26` + 6 digits. */
export interface Indent {
  id: string;
  storeCode: string;
  placedAt: string;
  status: 'placed' | 'received';
  lines: { productId: string; cases: number }[];
}

export interface GrnLine {
  productId: string;
  /** Bottles on the invoice. */
  expected: number;
  /** Bottles actually counted at the door. */
  counted?: number;
  short?: number;
  broken?: number;
  unitPrice: Paise;
}

export interface Grn {
  id: string;
  storeCode: string;
  type: 'ksbcl' | 'other';
  status: 'draft' | 'received';
  supplierId: string;
  indentId?: string;
  /** KSBCL invoice number, `SMYH26` + 6 digits. */
  invoiceNo: string;
  receivedAt: string;
  /** Sum of expected x unit price. */
  invoiceAmount: Paise;
  /** Tax collected at source, 2% of the invoice. */
  tcs: Paise;
  lines: GrnLine[];
}

export interface Transfer {
  id: string;
  fromStore: string;
  toStore: string;
  lines: { productId: string; qty: number }[];
  permitNo: string;
  status: 'draft' | 'in_transit' | 'received';
  dispatchedAt?: string;
  receivedAt?: string;
}

export interface Count {
  id: string;
  storeCode: string;
  at: string;
  countedBy: string;
  lines: { productId: string; system: number; counted: number }[];
}

export interface Loss {
  id?: number;
  storeCode: string;
  productId: string;
  qty: number;
  reason: 'breakage' | 'theft' | 'expired' | 'other';
  at: string;
  by: string;
  /** The `ref` of the loss movement. */
  ref: string;
}

export interface Claim {
  id: string;
  grnId: string;
  storeCode: string;
  productId: string;
  qty: number;
  amount: Paise;
  status: 'open' | 'filed' | 'settled';
}

export interface LoyaltyMember {
  code: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface LoyaltyLedgerRow {
  id?: number;
  memberCode: string;
  points: number;
  kind: 'earn' | 'redeem' | 'adjust';
  storeCode: string;
  fy: string;
  billRef: string;
  /** Set on a `redeem` row: the request that made it, so a retry deducts once. */
  requestId?: string;
  /** Set on a `redeem` row: the reward it paid for, so a replay can be checked against the request. */
  rewardId?: string;
  at: string;
}

export interface Reward {
  id: string;
  name: string;
  cost: number;
  active: boolean;
}
