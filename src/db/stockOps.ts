import Dexie from 'dexie';
import { newId } from '../domain/id';
import { clock, istDate } from '../domain/time';
import { onHand } from '../domain/stock';
import type { Claim, Grn, GrnLine, Loss, StockMovement } from '../domain/types';
import { db } from './db';

/** Tax collected at source on a KSBCL invoice. */
const TCS_RATE = 0.02;

/** The purchase price in force on an IST day: the latest price that has started. 0 when there is none. */
async function purchasePrice(productId: string, istDay: string): Promise<number> {
  const price = await db.prices.where('[productId+effectiveFrom]').between([productId, Dexie.minKey], [productId, istDay], true, true).last();
  return price?.purchase ?? 0;
}

/**
 * Turn a placed order into a delivery to count: the manager has typed the invoice number, and the lines are the
 * order's cases in bottles at the purchase price in force. Returns the delivery's id; asking again for the same
 * order returns the first one.
 */
export function draftGrn(indentId: string, invoiceNo: string): Promise<string> {
  const invoice = invoiceNo.trim();
  if (invoice === '') return Promise.reject(new Error('bad_invoice'));
  return db.transaction('rw', [db.indents, db.grns, db.products, db.prices], async () => {
    const indent = await db.indents.get(indentId);
    if (!indent) throw new Error('indent_not_found');
    const existing = await db.grns.where('storeCode').equals(indent.storeCode).filter((g) => g.indentId === indentId).first();
    if (existing) return existing.id;

    const now = clock.now();
    const day = istDate(now);
    const lines: GrnLine[] = [];
    // An order that lists a product twice becomes one delivery line.
    const cases = new Map<string, number>();
    for (const l of indent.lines) cases.set(l.productId, (cases.get(l.productId) ?? 0) + l.cases);
    for (const [productId, n] of cases) {
      const product = await db.products.get(productId);
      if (!product) throw new Error('product_not_found');
      lines.push({ productId, expected: n * product.caseSize, unitPrice: await purchasePrice(productId, day) });
    }
    const invoiceAmount = lines.reduce((s, l) => s + l.expected * l.unitPrice, 0);
    const grn: Grn = {
      id: `GRN-${day.replaceAll('-', '')}-${newId().slice(0, 6)}`,
      storeCode: indent.storeCode,
      type: 'ksbcl',
      status: 'draft',
      supplierId: 'SUP-KSBCL',
      indentId,
      invoiceNo: invoice,
      receivedAt: now,
      invoiceAmount,
      tcs: Math.round(invoiceAmount * TCS_RATE),
      lines,
    };
    await db.grns.add(grn);
    return grn.id;
  });
}

const validCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Book a delivery. `counted` is every bottle that came through the door, broken ones included: all of it is a
 * purchase, and the broken ones leave again as a breakage loss, so stock rises by the sound bottles. A line that
 * came short or broken gets a claim for short + broken bottles. All in one transaction; a second go is refused.
 */
export function receiveGrn(grnId: string, lines: { productId: string; counted: number; broken: number }[], by: string): Promise<void> {
  return db.transaction('rw', [db.grns, db.movements, db.losses, db.claims, db.indents], async () => {
    const grn = await db.grns.get(grnId);
    if (!grn) throw new Error('grn_not_found');
    if (grn.status === 'received') throw new Error('grn_received');

    if (new Set(grn.lines.map((g) => g.productId)).size !== grn.lines.length) throw new Error('duplicate_lines');
    const given = new Map(lines.map((l) => [l.productId, l]));
    if (given.size !== lines.length) throw new Error('bad_count');
    for (const l of lines) {
      if (!grn.lines.some((g) => g.productId === l.productId)) throw new Error('unknown_product');
      if (!validCount(l.counted) || !validCount(l.broken) || l.broken > l.counted) throw new Error('bad_count');
    }

    const at = clock.now();
    const movements: StockMovement[] = [];
    const losses: Loss[] = [];
    const claims: Claim[] = [];
    const saved: GrnLine[] = grn.lines.map((line) => {
      const { counted, broken } = given.get(line.productId) ?? { counted: 0, broken: 0 };
      const short = line.expected - counted;
      if (counted > 0) movements.push({ storeCode: grn.storeCode, productId: line.productId, qty: counted, kind: 'purchase', ref: grn.id, at });
      if (broken > 0) {
        const ref = `LOSS-${grn.id}-${line.productId}`;
        movements.push({ storeCode: grn.storeCode, productId: line.productId, qty: -broken, kind: 'loss', ref, at });
        losses.push({ storeCode: grn.storeCode, productId: line.productId, qty: broken, reason: 'breakage', at, by, ref });
      }
      if (short > 0 || broken > 0) {
        const qty = Math.max(short, 0) + broken;
        claims.push({
          id: newId(),
          grnId: grn.id,
          storeCode: grn.storeCode,
          productId: line.productId,
          qty,
          amount: qty * line.unitPrice,
          status: 'open',
        });
      }
      return { ...line, counted, short, broken };
    });

    await db.grns.update(grn.id, { status: 'received', receivedAt: at, lines: saved });
    await db.movements.bulkAdd(movements);
    await db.losses.bulkAdd(losses);
    await db.claims.bulkAdd(claims);
    if (grn.indentId) await db.indents.update(grn.indentId, { status: 'received' });
  });
}

/**
 * Save a shelf count. Each line is compared with what the ledger says is on hand; any difference is written as a
 * `count_adjust` movement (negative for a shortage, positive for a surplus). Returns every line with its difference.
 */
export function saveCount(
  storeCode: string,
  counts: { productId: string; counted: number }[],
  by: string,
): Promise<{ productId: string; expected: number; counted: number; diff: number }[]> {
  if (counts.length === 0) return Promise.reject(new Error('empty_count'));
  if (counts.some((c) => !validCount(c.counted))) return Promise.reject(new Error('bad_count'));
  return db.transaction('rw', [db.counts, db.movements], async () => {
    const id = newId();
    const at = clock.now();
    const results: { productId: string; expected: number; counted: number; diff: number }[] = [];
    for (const c of counts) {
      const rows = await db.movements.where('[storeCode+productId]').equals([storeCode, c.productId]).toArray();
      const expected = onHand(rows, storeCode, c.productId);
      results.push({ productId: c.productId, expected, counted: c.counted, diff: c.counted - expected });
    }
    await db.counts.add({ id, storeCode, at, countedBy: by, lines: results.map((r) => ({ productId: r.productId, system: r.expected, counted: r.counted })) });
    await db.movements.bulkAdd(
      results.filter((r) => r.diff !== 0).map((r) => ({ storeCode, productId: r.productId, qty: r.diff, kind: 'count_adjust' as const, ref: id, at })),
    );
    return results;
  });
}
