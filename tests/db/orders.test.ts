import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { advanceIndent, placeIndent, saveDraftIndent } from '../../src/db/orders';
import { raiseClaim } from '../../src/db/stockOps';
import type { Grn } from '../../src/domain/types';

beforeEach(async () => {
  await resetDb();
});

describe('indents', () => {
  it('saves a draft without the zero lines, and refuses an empty or fractional order', async () => {
    const id = await saveDraftIndent('TSTS1', [
      { productId: 'A', cases: 2 },
      { productId: 'B', cases: 0 },
    ]);
    expect(await db.indents.get(id)).toMatchObject({ status: 'draft', lines: [{ productId: 'A', cases: 2 }] });
    await expect(saveDraftIndent('TSTS1', [{ productId: 'A', cases: 0 }])).rejects.toThrow('empty_order');
    await expect(saveDraftIndent('TSTS1', [{ productId: 'A', cases: 1.5 }])).rejects.toThrow('bad_cases');
  });

  it('places a draft under its KSBCL number, once, and only with a well-formed, unused number', async () => {
    const id = await saveDraftIndent('TSTS1', [{ productId: 'A', cases: 2 }]);
    await expect(placeIndent(id, '123')).rejects.toThrow('bad_indent');
    await expect(placeIndent(id, '26008779.00')).rejects.toThrow('bad_indent');
    await placeIndent(id, ' indmyh26009468 ');
    expect(await db.indents.get(id)).toBeUndefined();
    expect(await db.indents.get('INDMYH26009468')).toMatchObject({ status: 'placed', storeCode: 'TSTS1', lines: [{ productId: 'A', cases: 2 }] });

    const other = await saveDraftIndent('TSTS1', [{ productId: 'A', cases: 1 }]);
    await expect(placeIndent(other, 'INDMYH26009468')).rejects.toThrow('indent_exists');
    await expect(placeIndent('INDMYH26009468', 'INDMYH26009469')).rejects.toThrow('not_a_draft');
  });

  it('moves placed to paid to dispatched, and no further: Received comes only from the delivery', async () => {
    const id = await saveDraftIndent('TSTS1', [{ productId: 'A', cases: 2 }]);
    await expect(advanceIndent(id, 'placed')).rejects.toThrow('cannot_advance'); // a draft is placed first
    await placeIndent(id, 'INDMYH26009468');
    await advanceIndent('INDMYH26009468', 'placed');
    expect((await db.indents.get('INDMYH26009468'))?.status).toBe('paid');
    // A double tap on [Mark paid] must not skip to Dispatched.
    await expect(advanceIndent('INDMYH26009468', 'placed')).rejects.toThrow('cannot_advance');
    expect((await db.indents.get('INDMYH26009468'))?.status).toBe('paid');
    await advanceIndent('INDMYH26009468', 'paid');
    expect((await db.indents.get('INDMYH26009468'))?.status).toBe('dispatched');
    await expect(advanceIndent('INDMYH26009468', 'paid')).rejects.toThrow('cannot_advance');
  });
});

describe('raiseClaim', () => {
  const grn: Grn = {
    id: 'GRN-1',
    storeCode: 'TSTS1',
    type: 'ksbcl',
    status: 'received',
    supplierId: 'SUP-KSBCL',
    invoiceNo: 'SMYH26000001',
    receivedAt: '2026-10-28T03:00:00.000Z',
    invoiceAmount: 0,
    tcs: 0,
    lines: [
      { productId: 'A', expected: 48, counted: 24, short: 24, broken: 0, unitPrice: 1000 },
      { productId: 'B', expected: 12, counted: 12, short: 0, broken: 2, unitPrice: 2000 },
      { productId: 'C', expected: 12, counted: 12, short: 0, broken: 0, unitPrice: 500 },
    ],
  };

  it('files one claim per short or broken line, worth short + broken at the unit price, and asking again adds none', async () => {
    await db.grns.add(grn);
    await raiseClaim('GRN-1');
    await raiseClaim('GRN-1');
    const claims = (await db.claims.toArray()).sort((a, b) => a.productId.localeCompare(b.productId));
    expect(claims).toMatchObject([
      { productId: 'A', qty: 24, amount: 24000, status: 'filed' },
      { productId: 'B', qty: 2, amount: 4000, status: 'filed' },
    ]);
  });

  it('files the claim the count already opened instead of adding a second', async () => {
    await db.grns.add(grn);
    await db.claims.add({ id: 'C1', grnId: 'GRN-1', storeCode: 'TSTS1', productId: 'A', qty: 24, amount: 24000, status: 'open' });
    await raiseClaim('GRN-1');
    expect((await db.claims.toArray()).filter((c) => c.productId === 'A').length).toBe(1);
    expect((await db.claims.get('C1'))?.status).toBe('filed');
  });
});
