import { billNumber, practiceBillNumber } from '../domain/billNumber';
import { clock, financialYear, istDate } from '../domain/time';
import type { Bill, BillLine, PayMode, Paise, Payment, StockMovement } from '../domain/types';
import { db } from './db';

export class DayClosedError extends Error {
  constructor() {
    super('day_closed');
    this.name = 'DayClosedError';
  }
}

export interface SaleInput {
  clientId: string;
  storeCode: string;
  counter: number;
  cashierId: string;
  shiftId: string;
  lines: { productId: string; qty: number; mrp: Paise; offerCode?: string; discount: Paise; tax: Paise }[];
  payments: { mode: PayMode; amount: Paise }[];
  memberCode?: string;
  practice: boolean;
}

/** First sequence number of a counter: counter 1 carries on from the paper series, others start at 1. */
function firstSeq(counterKey: number): number {
  return counterKey === 1 ? 100001 : 1;
}

/**
 * Record a sale in one transaction. Safe to call twice with the same clientId (a double tap):
 * the second call returns the first bill.
 */
export function recordSale(input: SaleInput): Promise<Bill> {
  if (input.lines.length === 0) return Promise.reject(new Error('empty_bill'));
  if (input.lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) return Promise.reject(new Error('bad_qty'));

  return db.transaction(
    'rw',
    [db.bills, db.billLines, db.payments, db.movements, db.counters, db.outbox, db.loyaltyQueue, db.dayCloses, db.kv],
    async () => {
      const existing = await db.bills.where('clientId').equals(input.clientId).first();
      if (existing) return existing;

      const at = clock.now();
      if (await db.dayCloses.get([input.storeCode, istDate(at)])) throw new DayClosedError();

      const gross = input.lines.reduce((s, l) => s + l.mrp * l.qty, 0);
      const discount = input.lines.reduce((s, l) => s + l.discount, 0);
      const tax = input.lines.reduce((s, l) => s + l.tax, 0);
      const net = gross - discount;
      if (input.payments.reduce((s, p) => s + p.amount, 0) !== net) throw new Error('payments_mismatch');

      const counterKey = input.practice ? input.counter + 100 : input.counter;
      const row = await db.counters.get([input.storeCode, counterKey]);
      const seq = row?.next ?? firstSeq(counterKey);
      await db.counters.put({ storeCode: input.storeCode, counter: counterKey, next: seq + 1 });

      const fy = financialYear(at);
      const number = input.practice
        ? practiceBillNumber(input.storeCode, input.counter, fy, seq)
        : billNumber(input.storeCode, input.counter, fy, seq);

      const bill: Bill = {
        number,
        clientId: input.clientId,
        storeCode: input.storeCode,
        counter: input.counter,
        cashierId: input.cashierId,
        shiftId: input.shiftId,
        at,
        ...(input.memberCode ? { memberCode: input.memberCode } : {}),
        gross,
        discount,
        tax,
        net,
        status: input.practice ? 'practice' : 'paid',
      };
      const lines: BillLine[] = input.lines.map((l) => ({
        billNumber: number,
        productId: l.productId,
        qty: l.qty,
        mrp: l.mrp,
        ...(l.offerCode ? { offerCode: l.offerCode } : {}),
        discount: l.discount,
        tax: l.tax,
        amount: l.mrp * l.qty - l.discount,
      }));
      const payments: Payment[] = input.payments.map((p) => ({ billNumber: number, mode: p.mode, amount: p.amount }));

      await db.bills.add(bill);
      await db.billLines.bulkAdd(lines);
      await db.payments.bulkAdd(payments);

      if (!input.practice) {
        const movements: StockMovement[] = input.lines.map((l) => ({
          storeCode: input.storeCode,
          productId: l.productId,
          qty: -l.qty,
          kind: 'sale',
          ref: number,
          at,
        }));
        await db.movements.bulkAdd(movements);
        await db.outbox.add({ kind: 'bill', ref: number, at, synced: 0 });
        if (input.memberCode && (await db.kv.get('loyalty'))?.value === true) {
          await db.loyaltyQueue.add({
            memberCode: input.memberCode,
            billRupees: Math.floor(net / 100),
            billRef: number,
            storeCode: input.storeCode,
          });
        }
      }
      return bill;
    },
  );
}

/** Void a paid bill: stock goes back, and a loyalty reversal is queued if it had a member. */
export function voidBill(number: string, _managerId: string): Promise<void> {
  return db.transaction(
    'rw',
    [db.bills, db.billLines, db.movements, db.outbox, db.loyaltyQueue],
    async () => {
      const bill = await db.bills.get(number);
      if (!bill) throw new Error('bill_not_found');
      if (bill.status !== 'paid') return;

      const at = clock.now();
      const lines = await db.billLines.where('billNumber').equals(number).toArray();
      await db.bills.update(number, { status: 'void' });
      await db.movements.bulkAdd(
        lines.map((l) => ({ storeCode: bill.storeCode, productId: l.productId, qty: l.qty, kind: 'void' as const, ref: number, at })),
      );
      await db.outbox.add({ kind: 'void', ref: number, at, synced: 0 });
      if (bill.memberCode) await db.loyaltyQueue.add({ reverse: number });
    },
  );
}
