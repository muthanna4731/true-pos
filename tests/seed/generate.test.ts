import { beforeAll, describe, expect, it } from 'vitest';
import { db, resetDb, TruePosDB } from '../../src/db/db';
import { recordSale } from '../../src/db/sales';
import { sha256Hex } from '../../src/domain/hash';
import { clock, istDate } from '../../src/domain/time';
import { parseBillNumber } from '../../src/domain/billNumber';
import type { Product } from '../../src/domain/types';
import { generateSeed, type SeedData } from '../../src/seed/generate';
import { advanceClock, DEMO_SEED, loadSeedIfEmpty, resetDemo, restoreClock } from '../../src/seed/load';
import { mulberry32 } from '../../src/seed/rng';

const TODAY = '2026-10-29';
const YESTERDAY = '2026-10-28';
const MEMBER_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

let seed: SeedData;
let byId: Map<string, Product>;
function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}
const find = (description: string) => seed.products.find((p) => p.description === description)!;
const stockOf = (store: string, productId: string) =>
  seed.movements.filter((m) => m.storeCode === store && m.productId === productId).reduce((s, m) => s + m.qty, 0);

describe('mulberry32', () => {
  it('repeats for a seed, differs across seeds, and stays in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(xs[0]);
  });
});

describe('sha256Hex', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('a'.repeat(100))).toBe('2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e');
  });
});

// seed 1 is the test fixture; DEMO_SEED is what ships, so the calibration ranges must hold for both.
describe.each([1, DEMO_SEED])('generateSeed (seed %i)', (seedNo) => {
  beforeAll(() => {
    seed = generateSeed({ seed: seedNo, today: TODAY });
    byId = new Map(seed.products.map((p) => [p.id, p]));
  });

  it('is deterministic: two calls give identical JSON (compared as strings, not deep-equal)', () => {
    const again = generateSeed({ seed: seedNo, today: TODAY });
    expect(JSON.stringify(again) === JSON.stringify(seed)).toBe(true);
    expect(JSON.stringify(generateSeed({ seed: seedNo + 1, today: TODAY })) === JSON.stringify(seed)).toBe(false);
  });

  it('builds the ten stores, the staff and the PIN hashes', () => {
    expect(seed.stores.map((s) => s.code)).toEqual([...Array.from({ length: 9 }, (_, i) => `TSTS${i + 1}`), 'TSGLD']);
    expect(seed.stores.map((s) => s.number)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(seed.stores.filter((s) => s.isHub).map((s) => s.code)).toEqual(['TSTS1']);
    expect(seed.stores[9]).toMatchObject({ name: 'True Spirits Gold', branchSlug: null, upiVpa: 'truespirits10@okaxis' });
    expect(seed.stores[2]).toMatchObject({ name: 'True Spirits 3', upiVpa: 'truespirits3@okaxis' });
    expect(seed.users).toHaveLength(22);
    const cashier = seed.users.find((u) => u.name === 'Cashier 3')!;
    expect(cashier).toMatchObject({ role: 'cashier', storeCodes: ['TSTS3'] });
    expect(cashier.pinHash).toBe(sha256Hex(`${cashier.id}:1111`));
    const owner = seed.users.find((u) => u.name === 'Owner')!;
    expect(owner.pinHash).toBe(sha256Hex(`${owner.id}:4444`));
    expect(seed.users.find((u) => u.name === 'Manager 10')!.pinHash).toBe(sha256Hex(`U-M10:2222`));
    expect(sha256Hex(`${seed.users.find((u) => u.name === 'Office')!.id}:3333`)).toBe(seed.users.find((u) => u.name === 'Office')!.pinHash);
  });

  it('prices every product at MRP / 1.10 with no AROED or cess, from 1 April 2026', () => {
    expect(seed.prices).toHaveLength(seed.products.length);
    for (const pr of seed.prices) {
      expect(pr).toMatchObject({ aroed: 0, cess: 0, effectiveFrom: '2026-04-01' });
      expect(pr.purchase).toBe(Math.round(pr.mrp / 1.1));
    }
    expect(seed.prices[0].mrp % 100).toBe(0);
  });

  it('TS1 bills per day average 180-210 over exactly the 30 days before today', () => {
    const perDay = new Map<string, number>();
    for (const b of seed.bills) if (b.storeCode === 'TSTS1') perDay.set(istDate(b.at), (perDay.get(istDate(b.at)) ?? 0) + 1);
    expect(perDay.size).toBe(30);
    expect([...perDay.keys()].sort()[0]).toBe('2026-09-29');
    expect([...perDay.keys()].sort()[29]).toBe(YESTERDAY);
    const mean = [...perDay.values()].reduce((s, n) => s + n, 0) / 30;
    expect(mean).toBeGreaterThanOrEqual(180);
    expect(mean).toBeLessThanOrEqual(210);
  });

  it('TS1 average net bill is Rs 290-360 and 40-60% of its units are 90 ml', () => {
    const ts1 = seed.bills.filter((b) => b.storeCode === 'TSTS1');
    const avg = ts1.reduce((s, b) => s + b.net, 0) / ts1.length;
    expect(avg).toBeGreaterThanOrEqual(29000);
    expect(avg).toBeLessThanOrEqual(36000);
    const numbers = new Set(ts1.map((b) => b.number));
    let units = 0;
    let small = 0;
    for (const l of seed.billLines) {
      if (!numbers.has(l.billNumber)) continue;
      units += l.qty;
      if (byId.get(l.productId)!.sizeMl === 90) small += l.qty;
    }
    expect(small / units).toBeGreaterThanOrEqual(0.4);
    expect(small / units).toBeLessThanOrEqual(0.6);
  });

  it('other shops bill 0.4-0.9 of TS1 and hold 25-60% of its opening bottles; TS1 holds 30,000-38,000', () => {
    const opening = (code: string) => seed.movements.filter((m) => m.storeCode === code && m.ref === 'OPENING').reduce((s, m) => s + m.qty, 0);
    const hub = opening('TSTS1');
    expect(hub).toBeGreaterThanOrEqual(30000);
    expect(hub).toBeLessThanOrEqual(38000);
    const hubBills = seed.bills.filter((b) => b.storeCode === 'TSTS1').length;
    for (const s of seed.stores.slice(1)) {
      expect(opening(s.code) / hub).toBeGreaterThanOrEqual(0.25);
      expect(opening(s.code) / hub).toBeLessThanOrEqual(0.6);
      const ratio = seed.bills.filter((b) => b.storeCode === s.code).length / hubBills;
      expect(ratio).toBeGreaterThan(0.38);
      expect(ratio).toBeLessThan(0.92);
    }
  });

  it('every opening-day stock line is 2-10 cases for active products and at most 24 bottles otherwise', () => {
    const ts1 = seed.movements.filter((m) => m.storeCode === 'TSTS1' && m.ref === 'OPENING');
    let activeLines = 0;
    for (const m of ts1) {
      const cs = byId.get(m.productId)!.caseSize;
      const wholeCases = m.qty % cs === 0 && m.qty / cs >= 2 && m.qty / cs <= 10;
      if (wholeCases) activeLines += 1;
      expect(m.qty <= 24 || wholeCases).toBe(true);
    }
    expect(activeLines).toBeGreaterThanOrEqual(60);
  });

  it('only beer carries an expiry date; opening stock is all kind opening, and every purchase has a GRN', () => {
    const withExpiry = seed.movements.filter((m) => m.expiresOn);
    expect(withExpiry.length).toBeGreaterThan(0);
    for (const m of withExpiry) expect(byId.get(m.productId)!.category).toBe('BEER');
    const opening = seed.movements.filter((m) => m.ref === 'OPENING');
    expect(opening.every((m) => m.kind === 'opening')).toBe(true);
    expect(opening.some((m) => m.expiresOn)).toBe(true);
    const grnIds = new Set(seed.grns.map((g) => g.id));
    const purchases = seed.movements.filter((m) => m.kind === 'purchase');
    expect(purchases.length).toBeGreaterThan(0);
    for (const m of purchases) expect(grnIds.has(m.ref)).toBe(true);
    const grnBeer = purchases.find((m) => byId.get(m.productId)!.category === 'BEER' && m.storeCode === 'TSTS1')!;
    const [y, mo, d] = istDate(grnBeer.at).split('-').map(Number);
    const due = new Date(Date.UTC(y, mo - 1 + 6, d)).toISOString().slice(0, 10);
    expect(grnBeer.expiresOn).toBe(due);
  });

  it('bill numbers are legal and none copies the real TS1 series', () => {
    for (const b of seed.bills) {
      expect(b.number).toMatch(/^[A-Z0-9/-]{1,20}$/);
      expect(b.number.startsWith('TSTS1/26-27/12')).toBe(false);
    }
    expect(new Set(seed.bills.map((b) => b.number)).size).toBe(seed.bills.length);
    expect(new Set(seed.bills.map((b) => b.clientId)).size).toBe(seed.bills.length);
  });

  it('bills look like recordSale output: lines, one payment, sale movements, matching totals', () => {
    const lines = groupBy(seed.billLines, (l) => l.billNumber);
    const pays = groupBy(seed.payments, (p) => p.billNumber);
    const sales = groupBy(
      seed.movements.filter((m) => m.kind === 'sale'),
      (m) => m.ref,
    );
    expect(sales.size).toBe(seed.bills.length);
    let sawOffer = false;
    for (const b of seed.bills) {
      const ls = lines.get(b.number)!;
      expect(ls.length).toBeGreaterThanOrEqual(1);
      expect(ls.length).toBeLessThanOrEqual(3);
      expect(b.gross).toBe(ls.reduce((s, l) => s + l.mrp * l.qty, 0));
      expect(b.discount).toBe(ls.reduce((s, l) => s + l.discount, 0));
      expect(b.net).toBe(b.gross - b.discount);
      expect(b.status).toBe('paid');
      expect(pays.get(b.number)!.reduce((s, p) => s + p.amount, 0)).toBe(b.net);
      const mv = sales.get(b.number)!;
      expect(mv.map((m) => `${m.productId}:${m.qty}`).sort()).toEqual(ls.map((l) => `${l.productId}:${-l.qty}`).sort());
      expect(mv.every((m) => m.storeCode === b.storeCode && m.at === b.at)).toBe(true);
      for (const l of ls) {
        expect(l.amount).toBe(l.mrp * l.qty - l.discount);
        if (l.offerCode) {
          sawOffer = true;
          expect(l.offerCode).toBe('EFKA102');
          expect(l.discount).toBe(500 * l.qty);
          expect(l.productId).toBe(find('EFKAYS WHISKY 180 - TPACK').id);
        }
      }
    }
    expect(sawOffer).toBe(true);
    expect(seed.offers).toEqual([
      expect.objectContaining({ code: 'EFKA102', type: 'store', amountPerUnit: 500, from: '2026-09-29', to: '2026-11-28' }),
    ]);
  });

  it('payments run about 70% UPI, 25% cash, 5% card; qty 5 only on 90 ml packs', () => {
    const share = (mode: string) => seed.payments.filter((p) => p.mode === mode).length / seed.payments.length;
    expect(share('upi')).toBeGreaterThan(0.67);
    expect(share('upi')).toBeLessThan(0.73);
    expect(share('cash')).toBeGreaterThan(0.22);
    expect(share('cash')).toBeLessThan(0.28);
    expect(share('card')).toBeGreaterThan(0.03);
    expect(share('card')).toBeLessThan(0.07);
    for (const l of seed.billLines) if (l.qty === 5) expect(byId.get(l.productId)!.sizeMl).toBe(90);
  });

  it('line quantities are only 1, 2 or 5', () => {
    expect(new Set(seed.billLines.map((l) => l.qty))).toEqual(new Set([1, 2, 5]));
  });

  it('bills fall between 10:00 and 22:30 IST and peak at 18:00-21:00', () => {
    const minutes = seed.bills.map((b) => {
      const [h, m] = new Date(new Date(b.at).getTime() + 330 * 60000).toISOString().slice(11, 16).split(':').map(Number);
      return h * 60 + m;
    });
    expect(Math.min(...minutes)).toBeGreaterThanOrEqual(10 * 60);
    expect(Math.max(...minutes)).toBeLessThan(22 * 60 + 40);
    const peak = minutes.filter((m) => m >= 18 * 60 && m < 21 * 60).length / minutes.length;
    expect(peak).toBeGreaterThan(0.35); // 3 of 12.5 hours would be 24% if flat
  });

  it('OC 90 and Haywards 90 are the top two sellers at TS1', () => {
    const top = groupBy(
      seed.billLines.filter((l) => l.billNumber.startsWith('TSTS1/')),
      (l) => l.productId,
    );
    const ranked = [...top].map(([id, ls]) => [id, ls.reduce((s, l) => s + l.qty, 0)] as const).sort((a, b) => b[1] - a[1]);
    expect(ranked[0][0]).toBe(find('ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK').id);
    expect(ranked[1][0]).toBe(find('HAYWARDS CHEERS WHISKY 90 - TPACK').id);
  });

  it('only the planted Corona 500 can at TS1 is ever negative', () => {
    const net = new Map<string, number>();
    for (const m of seed.movements) net.set(`${m.storeCode}|${m.productId}`, (net.get(`${m.storeCode}|${m.productId}`) ?? 0) + m.qty);
    const negative = [...net].filter(([, v]) => v < 0);
    expect(negative).toEqual([[`TSTS1|${find('CORONA EXTRA PREMIUM BEER 500 - CAN').id}`, -3]]);
  });

  it('generated sales never take a shelf below zero at the moment of sale (apart from the planted cans)', () => {
    const corona = find('CORONA EXTRA PREMIUM BEER 500 - CAN').id;
    const running = new Map<string, number>();
    const ordered = seed.movements.map((m, i) => ({ m, i })).sort((a, b) => (a.m.at === b.m.at ? a.i - b.i : a.m.at < b.m.at ? -1 : 1));
    for (const { m } of ordered) {
      const k = `${m.storeCode}|${m.productId}`;
      const v = (running.get(k) ?? 0) + m.qty;
      running.set(k, v);
      if (m.productId !== corona) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('TS1 gets a KSBCL delivery every 6 days with valid numbers, 2% TCS and refills to 8 cases', () => {
    const grns = seed.grns.filter((g) => g.storeCode === 'TSTS1');
    expect(grns.map((g) => istDate(g.receivedAt))).toEqual(['2026-10-04', '2026-10-10', '2026-10-16', '2026-10-22', YESTERDAY].sort());
    for (const g of grns) {
      expect(g.invoiceNo).toMatch(/^SMYH26\d{6}$/);
      expect(g.indentId).toMatch(/^INDMYH26\d{6}$/);
      expect(seed.indents.find((i) => i.id === g.indentId)).toBeTruthy();
      expect(g.invoiceAmount).toBe(g.lines.reduce((s, l) => s + l.expected * l.unitPrice, 0));
      expect(g.tcs).toBe(Math.round(g.invoiceAmount * 0.02));
      for (const l of g.lines) expect(l.expected % byId.get(l.productId)!.caseSize).toBe(0);
    }
    const first = grns[0];
    const oc = first.lines.find((l) => l.productId === find('ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK').id)!;
    const before = seed.movements
      .filter((m) => m.storeCode === 'TSTS1' && m.productId === oc.productId && m.at < first.receivedAt)
      .reduce((s, m) => s + m.qty, 0);
    expect(before + oc.expected).toBeGreaterThanOrEqual(8 * 96);
    expect(before + oc.expected).toBeLessThan(9 * 96);
  });

  it('moves 2-4 transfers a day from TS1, all received with a permit', () => {
    const regular = seed.transfers.filter((t) => t.id !== 'TR-PLANT-1');
    const perDay = groupBy(regular, (t) => t.id.slice(3, 11));
    expect(perDay.size).toBe(30);
    for (const ts of perDay.values()) {
      expect(ts.length).toBeGreaterThanOrEqual(2);
      expect(ts.length).toBeLessThanOrEqual(4);
    }
    for (const t of regular) {
      expect(t).toMatchObject({ fromStore: 'TSTS1', status: 'received' });
      expect(t.toStore).not.toBe('TSTS1');
      expect(t.permitNo).toMatch(/^KA-EX-\d{6}$/);
      expect(t.lines.length).toBeGreaterThan(0);
      expect(t.receivedAt! > t.dispatchedAt!).toBe(true);
      const out = seed.movements.filter((m) => m.ref === t.id && m.kind === 'transfer_out');
      const into = seed.movements.filter((m) => m.ref === t.id && m.kind === 'transfer_in');
      expect(out.reduce((s, m) => s - m.qty, 0)).toBe(into.reduce((s, m) => s + m.qty, 0));
    }
  });

  it('one closed shift per shop per day; a day close for each past day except TS4 yesterday', () => {
    expect(seed.shifts).toHaveLength(300);
    expect(new Set(seed.shifts.map((s) => s.id)).size).toBe(300);
    for (const s of seed.shifts) {
      expect(s.closedAt).toBeTruthy();
      expect(s.diff).toBe(s.counted! - s.expected!);
    }
    for (const b of seed.bills) expect(seed.shifts.some((s) => s.id === b.shiftId)).toBe(true);
    expect(seed.shifts.some((s) => istDate(s.openedAt) === TODAY)).toBe(false);
    expect(seed.dayCloses).toHaveLength(299);
    expect(seed.dayCloses.some((d) => d.date === TODAY)).toBe(false);
  });

  it('counters carry on from the last seeded bill of each shop', () => {
    expect(seed.counters).toHaveLength(10);
    for (const c of seed.counters) {
      const seqs = seed.bills.filter((b) => b.storeCode === c.storeCode).map((b) => parseBillNumber(b.number).seq);
      expect(c.counter).toBe(1);
      expect(c.next).toBe(Math.max(...seqs) + 1);
      expect(Math.min(...seqs)).toBe(100001);
    }
  });

  it('plants all five problems', () => {
    const kf = find('KINGFISHER STRONG PREMIUM BEER 650 - BTL');
    const corona = find('CORONA EXTRA PREMIUM BEER 500 - CAN');

    // 1. yesterday's TS1 delivery is 2 cases short on KF Strong 650
    const grn = seed.grns.find((g) => g.storeCode === 'TSTS1' && istDate(g.receivedAt) === YESTERDAY)!;
    expect(grn.lines.find((l) => l.productId === kf.id)).toMatchObject({ short: 24 });
    expect(grn.lines.filter((l) => l.short).length).toBe(1);

    // 2. a transfer stuck in transit since 2 days ago
    const t = seed.transfers.find((x) => x.id === 'TR-PLANT-1')!;
    expect(t).toMatchObject({ fromStore: 'TSTS1', toStore: 'TSTS8', status: 'in_transit' });
    expect(istDate(t.dispatchedAt!)).toBe('2026-10-27');
    expect(t.receivedAt).toBeUndefined();
    expect(seed.movements.some((m) => m.ref === 'TR-PLANT-1' && m.kind === 'transfer_in')).toBe(false);

    // 3. Corona 500 can is minus 3 at TS1, through three sale movements beyond stock
    expect(stockOf('TSTS1', corona.id)).toBe(-3);
    expect(seed.movements.filter((m) => m.storeCode === 'TSTS1' && m.productId === corona.id && m.kind === 'sale')).toHaveLength(3);

    // 4. a TS5 beer purchase expires in 20 days with stock left
    const near = seed.movements.find((m) => m.storeCode === 'TSTS5' && m.kind === 'purchase' && m.expiresOn === '2026-11-18')!;
    expect(byId.get(near.productId)!.category).toBe('BEER');
    expect(near.ref).not.toBe('OPENING');
    expect(seed.grns.find((g) => g.id === near.ref)).toMatchObject({ storeCode: 'TSTS5' });
    expect(istDate(near.at) < TODAY).toBe(true);
    expect(stockOf('TSTS5', near.productId)).toBeGreaterThan(0);

    // 5. TS4 never locked yesterday, though every other shop did
    expect(seed.dayCloses.some((d) => d.storeCode === 'TSTS4' && d.date === YESTERDAY)).toBe(false);
    expect(seed.dayCloses.filter((d) => d.date === YESTERDAY)).toHaveLength(9);
    expect(seed.shifts.some((s) => s.storeCode === 'TSTS4' && istDate(s.closedAt!) === YESTERDAY)).toBe(true);
  });

  it('has the loyalty stand-in: three members, Ravi on 240, two rewards, and no loyalty switch', () => {
    expect(seed.loyaltyMembers).toHaveLength(3);
    for (const m of seed.loyaltyMembers) expect(m.code).toMatch(MEMBER_CODE);
    expect(seed.loyaltyMembers[0]).toMatchObject({ code: '7K3M9QX2RA', name: 'Ravi', phone: '9845014821' });
    const balance = (code: string) => seed.loyaltyLedger.filter((r) => r.memberCode === code).reduce((s, r) => s + r.points, 0);
    expect(balance('7K3M9QX2RA')).toBe(240);
    expect(new Set(seed.loyaltyMembers.map((m) => m.phone)).size).toBe(3);
    expect(seed.rewards).toHaveLength(2);
    expect(seed.rewards[0]).toMatchObject({ name: '₹50 off next visit', cost: 100 });
    expect(seed.kv.some((r) => r.key === 'loyalty')).toBe(false);
    expect(seed.bills.some((b) => b.memberCode)).toBe(false);
  });

  it('carries no real name and no queued sync work', () => {
    const text = JSON.stringify({ ...seed, products: [] });
    expect(text).not.toContain('Mallesh');
    expect(seed.outbox).toEqual([]);
    expect(seed.loyaltyQueue).toEqual([]);
  });
});

describe('loadSeedIfEmpty / resetDemo / demo clock', () => {
  const SHORT = { days: 3 };

  it('fills an empty database once and leaves a filled one alone', async () => {
    await resetDb();
    await loadSeedIfEmpty(db, SHORT);
    const bills = await db.bills.count();
    expect(bills).toBeGreaterThan(0);
    expect(await db.stores.count()).toBe(10);
    expect(await db.counters.count()).toBe(10);
    expect(await db.kv.get('loyalty')).toBeUndefined();
    await loadSeedIfEmpty(db, SHORT);
    expect(await db.bills.count()).toBe(bills);
  });

  it('live billing continues each shop sequence after the last seeded bill', async () => {
    await resetDb();
    await loadSeedIfEmpty(db, SHORT);
    const last = (await db.bills.where('storeCode').equals('TSTS2').toArray())
      .map((b) => parseBillNumber(b.number).seq)
      .reduce((a, b) => Math.max(a, b));
    const bill = await recordSale({
      clientId: 'live-1',
      storeCode: 'TSTS2',
      counter: 1,
      cashierId: 'U-C02',
      shiftId: 'S-live',
      lines: [{ productId: 'P0320', qty: 1, mrp: 5500, discount: 0, tax: 0 }],
      payments: [{ mode: 'cash', amount: 5500 }],
      practice: false,
    });
    expect(parseBillNumber(bill.number).seq).toBe(last + 1);
  });

  it('keeps the clock offset in kv and restores it on load; resetDemo clears it', async () => {
    try {
      await resetDb();
      await loadSeedIfEmpty(db, SHORT);
      const start = Date.parse(clock.now());
      await advanceClock(db, 2);
      await advanceClock(db, 1);
      expect((await db.kv.get('clockOffsetDays'))?.value).toBe(3);
      expect(Math.round((Date.parse(clock.now()) - start) / 86400000)).toBe(3);
      clock.setOffsetDays(0);
      await restoreClock(db);
      expect(Math.round((Date.parse(clock.now()) - start) / 86400000)).toBe(3);
      clock.setOffsetDays(0);
      await loadSeedIfEmpty(db, SHORT); // a filled database restores the offset too
      expect(Math.round((Date.parse(clock.now()) - start) / 86400000)).toBe(3);
      await resetDemo(db, SHORT);
      expect(Math.round((Date.parse(clock.now()) - start) / 86400000)).toBe(0);
      expect(await db.kv.get('clockOffsetDays')).toBeUndefined();
      expect(await db.stores.count()).toBe(10);
    } finally {
      clock.setOffsetDays(0);
    }
  });

  it('loads into a separate database instance when given one', async () => {
    const other = new TruePosDB('true-pos-seed-test');
    try {
      await loadSeedIfEmpty(other, SHORT);
      expect(await other.stores.count()).toBe(10);
    } finally {
      other.close();
      await TruePosDB.delete('true-pos-seed-test');
    }
  });
});
