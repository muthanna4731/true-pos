import Dexie, { type Table } from 'dexie';
import type {
  Bill,
  BillLine,
  Claim,
  Count,
  DayClose,
  Grn,
  Indent,
  LoyaltyLedgerRow,
  LoyaltyMember,
  Loss,
  Offer,
  Payment,
  Price,
  Product,
  Reward,
  Shift,
  StockMovement,
  Store,
  Supplier,
  SupplierPayment,
  Transfer,
  User,
} from '../domain/types';

/** Next bill sequence for `[storeCode, counter]`. Practice bills use `counter + 100`. */
export interface CounterRow {
  storeCode: string;
  counter: number;
  next: number;
}

/** A change waiting to be sent to the server. `synced` is 0 or 1 (booleans are not index keys). */
export interface OutboxRow {
  id?: number;
  kind: 'bill' | 'void';
  ref: string;
  at: string;
  synced: 0 | 1;
}

export type LoyaltyQueueItem =
  | { id?: number; memberCode: string; billRupees: number; billRef: string; storeCode: string }
  | { id?: number; reverse: string };

export interface KvRow {
  key: string;
  value: unknown;
}

export class TruePosDB extends Dexie {
  products!: Table<Product, string>;
  prices!: Table<Price, number>;
  stores!: Table<Store, string>;
  users!: Table<User, string>;
  movements!: Table<StockMovement, number>;
  bills!: Table<Bill, string>;
  billLines!: Table<BillLine, number>;
  payments!: Table<Payment, number>;
  shifts!: Table<Shift, string>;
  dayCloses!: Table<DayClose, [string, string]>;
  counters!: Table<CounterRow, [string, number]>;
  offers!: Table<Offer, string>;
  indents!: Table<Indent, string>;
  grns!: Table<Grn, string>;
  transfers!: Table<Transfer, string>;
  counts!: Table<Count, string>;
  losses!: Table<Loss, number>;
  claims!: Table<Claim, string>;
  suppliers!: Table<Supplier, string>;
  supplierPayments!: Table<SupplierPayment, number>;
  outbox!: Table<OutboxRow, number>;
  loyaltyQueue!: Table<LoyaltyQueueItem, number>;
  kv!: Table<KvRow, string>;
  loyaltyMembers!: Table<LoyaltyMember, string>;
  loyaltyLedger!: Table<LoyaltyLedgerRow, number>;
  rewards!: Table<Reward, string>;

  constructor(name = 'true-pos') {
    super(name);
    this.version(1).stores({
      products: 'id, subcategory, brand, &barcode',
      prices: '++id, productId, [productId+effectiveFrom]',
      stores: 'code',
      users: 'id, role',
      movements: '++id, [storeCode+productId], [storeCode+at], kind, ref',
      bills: 'number, &clientId, [storeCode+at], shiftId, status',
      billLines: '++id, billNumber, productId',
      payments: '++id, billNumber',
      shifts: 'id, storeCode, cashierId, closedAt',
      dayCloses: '[storeCode+date]',
      counters: '[storeCode+counter]',
      offers: 'code',
      indents: 'id, storeCode, status',
      grns: 'id, storeCode, type, status',
      transfers: 'id, fromStore, toStore, status',
      counts: 'id, storeCode',
      losses: '++id, storeCode, at',
      claims: 'id, grnId',
      suppliers: 'id',
      supplierPayments: '++id, supplierId',
      outbox: '++id, synced',
      loyaltyQueue: '++id',
      kv: 'key',
      loyaltyMembers: 'code',
      loyaltyLedger: '++id, memberCode, [storeCode+fy+billRef]',
      rewards: 'id',
    });
  }
}

export const db = new TruePosDB();

/** Empty every table (the schema stays). Reopens the database if a test closed it. */
export async function resetDb(target: TruePosDB = db): Promise<void> {
  if (!target.isOpen()) await target.open();
  await target.transaction('rw', target.tables, () => Promise.all(target.tables.map((t) => t.clear())));
}
