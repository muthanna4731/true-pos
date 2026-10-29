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
