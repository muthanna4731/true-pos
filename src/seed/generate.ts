import { billNumber } from '../domain/billNumber';
import { sha256Hex } from '../domain/hash';
import { minLevel } from '../domain/orders';
import { financialYear } from '../domain/time';
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
  Paise,
  PayMode,
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
import type { CounterRow, KvRow, LoyaltyQueueItem, OutboxRow } from '../db/db';
import catalogue from './catalogue.json';
import { mulberry32 } from './rng';

export interface SeedData {
  products: Product[];
  prices: Price[];
  stores: Store[];
  users: User[];
  movements: StockMovement[];
  bills: Bill[];
  billLines: BillLine[];
  payments: Payment[];
  shifts: Shift[];
  dayCloses: DayClose[];
  counters: CounterRow[];
  offers: Offer[];
  indents: Indent[];
  grns: Grn[];
  transfers: Transfer[];
  counts: Count[];
  losses: Loss[];
  claims: Claim[];
  suppliers: Supplier[];
  supplierPayments: SupplierPayment[];
  outbox: OutboxRow[];
  loyaltyQueue: LoyaltyQueueItem[];
  kv: KvRow[];
  loyaltyMembers: LoyaltyMember[];
  loyaltyLedger: LoyaltyLedgerRow[];
  rewards: Reward[];
}

export interface SeedOpts {
  seed: number;
  /** IST calendar date `YYYY-MM-DD`. History runs for `days` days up to yesterday. */
  today: string;
  days?: number;
}

// ---- tuning knobs -------------------------------------------------------------------------------

const HUB = 'TSTS1';
const ACTIVE_COUNT = 60;
const HUB_BILLS_PER_DAY = 195;
const MEAN_LINES = 0.5 * 1 + 0.35 * 2 + 0.15 * 3;
const ZIPF_S = 1.1;
const DAY_FACTOR = [1.0, 0.88, 0.88, 0.93, 1.0, 1.15, 1.2]; // Sunday first
const DELIVERY_EVERY_DAYS = 6;
const REFILL_CASES = 8;
const OFFER_CODE = 'EFKA102';

/** What the active list of a store is made of (the two forced 90 ml packs, Efkays 180 and KF Strong come on top). */
const ACTIVE_PLAN = { p90: 16, p180: 24, big: 3, beer: 10, wine: 0, nalc: 3 } as const;

// ---- dates (IST) --------------------------------------------------------------------------------

const DAY_MS = 86400000;
const IST_OFFSET_MIN = 330;

function dayMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}
const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number): string => dateOf(dayMs(date) + n * DAY_MS);

function addMonths(date: string, n: number): string {
  const d = new Date(dayMs(date));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return dateOf(d.getTime());
}

/** ISO instant for a wall-clock time in IST on `date`. */
function istAt(date: string, minutes: number, seconds = 0): string {
  return new Date(dayMs(date) + (minutes * 60 + seconds) * 1000 - IST_OFFSET_MIN * 60000).toISOString();
}

// ---- generator ----------------------------------------------------------------------------------

interface StoreCtx {
  store: Store;
  n: number;
  cashierId: string;
  managerId: string;
  scale: number;
  active: Product[];
  cumWeights: number[];
  seq: number;
}

function find(products: Product[], description: string): Product {
  const p = products.find((x) => x.description === description);
  if (!p) throw new Error(`seed: product not in catalogue: ${description}`);
  return p;
}

export function generateSeed(opts: SeedOpts): SeedData {
  const days = opts.days ?? 30;
  const today = opts.today;
  const rng = mulberry32(opts.seed);
  const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p: number) => rng() < p;
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const digits = (n: number) => String(ri(0, 10 ** n - 1)).padStart(n, '0');
  const uuid = () => {
    const h = () => ((rng() * 4294967296) >>> 0).toString(16).padStart(8, '0');
    const a = h() + h() + h() + h();
    return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
  };

  const products = catalogue.products as Product[];
  const mrpRupees = catalogue.mrp as Record<string, number>;
  const mrpOf = (p: Product): Paise => mrpRupees[p.id] * 100;
  const byId = new Map(products.map((p) => [p.id, p]));

  // The planted problems and the offer rely on these exact products. Fail loudly if the catalogue moves.
  const oc90 = find(products, 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK');
  const haywards90 = find(products, 'HAYWARDS CHEERS WHISKY 90 - TPACK');
  const efkays180 = find(products, 'EFKAYS WHISKY 180 - TPACK');
  const corona500 = find(products, 'CORONA EXTRA PREMIUM BEER 500 - CAN');
  const kfStrong650 = find(products, 'KINGFISHER STRONG PREMIUM BEER 650 - BTL');

  const firstDay = addDays(today, -days);
  const yesterday = addDays(today, -1);

  // ---- stores, users, prices, offer, suppliers ----

  const stores: Store[] = [];
  for (let i = 1; i <= 10; i++) {
    const gold = i === 10;
    stores.push({
      code: gold ? 'TSGLD' : `TSTS${i}`,
      number: String(i).padStart(2, '0'),
      name: gold ? 'True Spirits Gold' : `True Spirits ${i}`,
      branchSlug: null,
      isHub: i === 1,
      upiVpa: `truespirits${i}@okaxis`,
      licenceNo: `CL2-DEMO-${String(i).padStart(3, '0')}`,
    });
  }

  const user = (id: string, name: string, role: User['role'], pin: string, storeCodes: string[], phone: string): User => ({
    id,
    name,
    phone,
    role,
    pinHash: sha256Hex(`${id}:${pin}`),
    storeCodes,
  });
  const users: User[] = [];
  stores.forEach((s, i) => {
    const n = i + 1;
    users.push(user(`U-C${s.number}`, `Cashier ${n}`, 'cashier', '1111', [s.code], `99999000${s.number}`));
    users.push(user(`U-M${s.number}`, `Manager ${n}`, 'manager', '2222', [s.code], `99999001${s.number}`));
  });
  const allCodes = stores.map((s) => s.code);
  users.push(user('U-OFFICE', 'Office', 'office', '3333', allCodes, '9999900200'));
  users.push(user('U-OWNER', 'Owner', 'owner', '4444', allCodes, '9999900300'));

  const prices: Price[] = products.map((p) => ({
    productId: p.id,
    mrp: mrpOf(p),
    purchase: Math.round(mrpOf(p) / 1.1),
    aroed: 0,
    cess: 0,
    effectiveFrom: '2026-04-01',
    pushedBy: 'U-OFFICE',
  }));
  const purchaseOf = new Map(prices.map((pr) => [pr.productId, pr.purchase]));

  const offers: Offer[] = [
    {
      code: OFFER_CODE,
      type: 'store',
      productId: efkays180.id,
      discountType: 'amount',
      amountPerUnit: 500,
      from: firstDay,
      to: addDays(today, 30),
      createdBy: 'U-OWNER',
    },
  ];

  const suppliers: Supplier[] = [{ id: 'SUP-KSBCL', name: 'KSBCL', kind: 'ksbcl' }];

  // ---- ledger ----

  const movements: StockMovement[] = [];
  const stock = new Map<string, number>();
  const key = (store: string, pid: string) => `${store}|${pid}`;
  const have = (store: string, pid: string) => stock.get(key(store, pid)) ?? 0;
  const move = (
    storeCode: string,
    productId: string,
    qty: number,
    kind: StockMovement['kind'],
    ref: string,
    at: string,
    expiresOn?: string,
  ) => {
    movements.push({ storeCode, productId, qty, kind, ref, at, ...(expiresOn ? { expiresOn } : {}) });
    stock.set(key(storeCode, productId), have(storeCode, productId) + qty);
  };

  // ---- active lists ----

  const isIml = (p: Product, sizes: (number | null)[]) => p.category === 'IML' && sizes.includes(p.sizeMl);
  const forcedIds = new Set([oc90.id, haywards90.id, efkays180.id, kfStrong650.id, corona500.id]);
  const pool = (pred: (p: Product) => boolean) => products.filter((p) => !forcedIds.has(p.id) && pred(p));
  const pools = {
    p90: pool((p) => isIml(p, [90])),
    p180: pool((p) => isIml(p, [180]) && mrpOf(p) <= 35000),
    big: pool((p) => isIml(p, [375]) && mrpOf(p) <= 60000),
    beer: pool((p) => p.category === 'BEER'),
    wine: pool((p) => p.category === 'WINE'),
    nalc: pool((p) => p.category === 'NALC'),
  };

  const ctxs: StoreCtx[] = stores.map((store, i) => {
    const picked = (Object.keys(ACTIVE_PLAN) as (keyof typeof ACTIVE_PLAN)[]).flatMap((k) =>
      shuffle(pools[k]).slice(0, ACTIVE_PLAN[k]),
    );
    // Other 90 ml packs are stocked but sit in the lower half of the ranking, so the two forced packs lead the 90 ml sales.
    const rest = shuffle(picked.filter((p) => p.sizeMl !== 90));
    rest.splice(2, 0, efkays180); // rank 5 once the two forced packs are in front
    rest.splice(5, 0, kfStrong650);
    rest.push(...shuffle(picked.filter((p) => p.sizeMl === 90)));
    const active = [oc90, haywards90, ...rest];
    if (active.length !== ACTIVE_COUNT) throw new Error('seed: active list is not 60 products');
    const cum: number[] = [];
    active.reduce((s, _p, r) => {
      const t = s + 1 / Math.pow(r + 1, ZIPF_S);
      cum.push(t);
      return t;
    }, 0);
    return {
      store,
      n: i + 1,
      cashierId: `U-C${store.number}`,
      managerId: `U-M${store.number}`,
      scale: i === 0 ? 1 : 0.4 + 0.5 * rng(),
      active,
      cumWeights: cum,
      seq: 100001,
    };
  });
  const hubCtx = ctxs[0];
  const activeSet = new Map(ctxs.map((c) => [c.store.code, new Set(c.active.map((p) => p.id))]));

  // ---- opening stock ----

  const openAt = istAt(firstDay, 8 * 60);
  const openingExpiry = addMonths(firstDay, 6);
  const plantedExpiry = addDays(today, 20);
  const openStock = (storeCode: string, p: Product, qty: number, expiresOn?: string) => {
    if (qty <= 0) return;
    const beer = p.category === 'BEER';
    move(storeCode, p.id, qty, 'opening', 'OPENING', openAt, beer ? (expiresOn ?? openingExpiry) : undefined);
  };
  let plantedBeer: Product | undefined;
  let hubTotal = 0;
  for (const c of ctxs) {
    const code = c.store.code;
    const act = activeSet.get(code)!;
    const isTop = (p: Product) => p.id === oc90.id || p.id === haywards90.id;
    const casesFor = (p: Product) => (isTop(p) ? ri(8, 10) : Math.max(ri(2, 10), ri(2, 10), ri(2, 10), ri(2, 10)));
    const stockedShare = c.store.isHub ? 0.92 : 0.25 + 0.35 * rng();
    // Draw once, then (for the smaller shops) scale the case counts so the shop holds 25-60% of the hub's bottles.
    const draws = products.flatMap((p) => {
      if (p.id === corona500.id && code === HUB) return []; // planted negative: nothing on the shelf
      if (act.has(p.id)) return [{ p, active: true, n: casesFor(p) }];
      return chance(stockedShare) ? [{ p, active: false, n: ri(0, 24) }] : [];
    });
    const shelf = (k: number) =>
      draws.map((d) => ({ p: d.p, qty: d.active ? Math.max(2, Math.min(10, Math.round(d.n * k))) * d.p.caseSize : d.n }));
    const total = (k: number) => shelf(k).reduce((s, x) => s + x.qty, 0);
    let k = 1;
    if (!c.store.isHub) {
      const target = stockedShare * hubTotal;
      let lo = 0.1;
      let hi = 1;
      for (let it = 0; it < 14; it++) {
        k = (lo + hi) / 2;
        if (total(k) < target) lo = k;
        else hi = k;
      }
    }
    const items = shelf(k);
    if (code === 'TSTS5') {
      // Planted (delivered later, see plantShortDatedBeer): an inactive beer, so it never sells. It has no opening stock.
      plantedBeer = products.find((p) => p.category === 'BEER' && !act.has(p.id) && p.id !== corona500.id)!;
      const at = items.findIndex((x) => x.p.id === plantedBeer!.id);
      if (at >= 0) items.splice(at, 1);
    }
    for (const x of items) openStock(code, x.p, x.qty);
    if (c.store.isHub) hubTotal = items.reduce((s, x) => s + x.qty, 0);
  }

  // ---- history ----

  const bills: Bill[] = [];
  const billLines: BillLine[] = [];
  const payments: Payment[] = [];
  const shifts: Shift[] = [];
  const dayCloses: DayClose[] = [];
  const indents: Indent[] = [];
  const grns: Grn[] = [];
  const transfers: Transfer[] = [];
  const losses: Loss[] = [];
  const supplierPayments: SupplierPayment[] = [];
  const usedIds = new Set<string>();
  const uniqueDigits = (prefix: string) => {
    for (;;) {
      const id = prefix + digits(6);
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
  };

  // How many units a store is expected to sell per day, by active rank, used to keep the hub from giving away its own stock.
  const hubDailyUnits = (rank: number) => {
    const total = hubCtx.cumWeights[ACTIVE_COUNT - 1];
    const share = 1 / Math.pow(rank + 1, ZIPF_S) / total;
    const p = hubCtx.active[rank];
    const meanQty = p.sizeMl === 90 ? 1.6 : 1.2;
    return HUB_BILLS_PER_DAY * MEAN_LINES * share * meanQty;
  };

  const deliverGrn = (date: string) => {
    const at = istAt(date, 8 * 60 + 30);
    const grnId = `GRN-${date.replaceAll('-', '')}-1`;
    const indentId = uniqueDigits('INDMYH26');
    const lines: Grn['lines'] = [];
    const indentLines: Indent['lines'] = [];
    hubCtx.active.forEach((p) => {
      const missing = REFILL_CASES * p.caseSize - have(HUB, p.id);
      let cases = Math.ceil(missing / p.caseSize);
      if (p.id === kfStrong650.id && date === yesterday) cases = Math.max(cases, 2);
      if (cases <= 0) return;
      const expected = cases * p.caseSize;
      const short = p.id === kfStrong650.id && date === yesterday ? 24 : 0; // planted: 2 cases short
      lines.push({ productId: p.id, expected, counted: expected - short, short, broken: 0, unitPrice: purchaseOf.get(p.id)! });
      indentLines.push({ productId: p.id, cases });
    });
    const invoiceAmount = lines.reduce((s, l) => s + l.expected * l.unitPrice, 0);
    const grn: Grn = {
      id: grnId,
      storeCode: HUB,
      type: 'ksbcl',
      status: 'received',
      supplierId: 'SUP-KSBCL',
      indentId,
      invoiceNo: uniqueDigits('SMYH26'),
      receivedAt: at,
      invoiceAmount,
      tcs: Math.round(invoiceAmount * 0.02),
      lines,
    };
    indents.push({ id: indentId, storeCode: HUB, placedAt: istAt(addDays(date, -3), 15 * 60), status: 'received', lines: indentLines });
    grns.push(grn);
    for (const l of lines) {
      const p = byId.get(l.productId)!;
      move(HUB, l.productId, l.counted!, 'purchase', grnId, at, p.category === 'BEER' ? addMonths(date, 6) : undefined);
    }
    return grn;
  };

  // Planted: TS5 takes in a short-dated beer lot (a real dated purchase with its own GRN) that expires in 20 days.
  const plantShortDatedBeer = (date: string) => {
    const beer = plantedBeer!;
    const at = istAt(date, 8 * 60 + 45);
    const id = `GRN-${date.replaceAll('-', '')}-TS5`;
    const expected = 24;
    const unitPrice = purchaseOf.get(beer.id)!;
    const invoiceAmount = expected * unitPrice;
    grns.push({
      id,
      storeCode: 'TSTS5',
      type: 'ksbcl',
      status: 'received',
      supplierId: 'SUP-KSBCL',
      invoiceNo: uniqueDigits('SMYH26'),
      receivedAt: at,
      invoiceAmount,
      tcs: Math.round(invoiceAmount * 0.02),
      lines: [{ productId: beer.id, expected, counted: expected, short: 0, broken: 0, unitPrice }],
    });
    move('TSTS5', beer.id, expected, 'purchase', id, at, plantedExpiry);
  };

  const sendTransfer = (t: Transfer, date: string, receive: boolean) => {
    const out = istAt(date, receive ? 9 * 60 : 14 * 60);
    t.dispatchedAt = out;
    for (const l of t.lines) move(t.fromStore, l.productId, -l.qty, 'transfer_out', t.id, out);
    if (!receive) return;
    const inAt = istAt(date, 9 * 60 + 40);
    t.receivedAt = inAt;
    for (const l of t.lines) {
      const beer = byId.get(l.productId)!.category === 'BEER';
      move(t.toStore, l.productId, l.qty, 'transfer_in', t.id, inAt, beer ? addMonths(date, 5) : undefined);
    }
  };

  // Bottles sold per store, product and day index, so a shop's recent average can set its reorder level.
  const unitsByDay = new Map<string, number>();
  const avgDaily = (c: StoreCtx, p: Product, rank: number, dayIndex: number): number => {
    if (dayIndex === 0) {
      const share = 1 / Math.pow(rank + 1, ZIPF_S) / c.cumWeights[ACTIVE_COUNT - 1]; // no history yet: expected sales
      return HUB_BILLS_PER_DAY * c.scale * MEAN_LINES * share * (p.sizeMl === 90 ? 1.6 : 1.2);
    }
    const from = Math.max(0, dayIndex - 7);
    let sum = 0;
    for (let d = from; d < dayIndex; d++) sum += unitsByDay.get(`${c.store.code}|${p.id}|${d}`) ?? 0;
    return sum / (dayIndex - from);
  };

  const dailyTransfers = (date: string, daysAgo: number, dayIndex: number) => {
    const toNext = ((((daysAgo - 2) % DELIVERY_EVERY_DAYS) + DELIVERY_EVERY_DAYS) % DELIVERY_EVERY_DAYS) + 1;
    const spare = new Map<string, number>();
    hubCtx.active.forEach((p, r) => {
      const reserve = Math.ceil(hubDailyUnits(r) * (toNext + 1));
      spare.set(p.id, Math.max(0, have(HUB, p.id) - reserve));
    });
    // Below the reorder level: top up to twice that level, in whole cases, from what the hub can spare.
    // On a quiet day, when fewer than two shops can be served, shops also ask for a routine top-up on
    // products under a wider multiple of the level, so the hub still dispatches 2-4 transfers every day.
    const count = ri(2, 4);
    const plan = (trigger: number) => {
      const left = new Map(spare);
      const planned: { c: StoreCtx; lines: Transfer['lines'] }[] = [];
      for (const c of shuffle(ctxs.slice(1))) {
        if (planned.length >= count) break;
        const lines: Transfer['lines'] = [];
        c.active.forEach((p, rank) => {
          if (lines.length >= 14) return;
          const level = minLevel(avgDaily(c, p, rank, dayIndex));
          const onShelf = have(c.store.code, p.id);
          if (onShelf >= trigger * level) return;
          const wantCases = Math.ceil((2 * level - onShelf) / p.caseSize);
          const cases = Math.min(wantCases, Math.floor((left.get(p.id) ?? 0) / p.caseSize));
          if (cases <= 0) return;
          lines.push({ productId: p.id, qty: cases * p.caseSize });
          left.set(p.id, left.get(p.id)! - cases * p.caseSize);
        });
        if (lines.length) planned.push({ c, lines });
      }
      return planned;
    };
    let planned = plan(1);
    for (let trigger = 2; planned.length < 2 && trigger <= 6; trigger++) planned = plan(trigger);
    let i = 0;
    for (const w of planned) {
      const lines = w.lines;
      i += 1;
      const t: Transfer = {
        id: `TR-${date.replaceAll('-', '')}-${i}`,
        fromStore: HUB,
        toStore: w.c.store.code,
        lines,
        permitNo: `KA-EX-${digits(6)}`,
        status: 'received',
      };
      sendTransfer(t, date, true);
      transfers.push(t);
    }
  };

  const plantTransfer = (date: string) => {
    const lines = hubCtx.active
      .filter((p) => p.sizeMl !== 90 && have(HUB, p.id) >= 5 * p.caseSize)
      .slice(0, 2)
      .map((p) => ({ productId: p.id, qty: p.caseSize }));
    if (lines.length < 2) throw new Error('seed: hub has no stock to plant the in-transit transfer');
    const t: Transfer = { id: 'TR-PLANT-1', fromStore: HUB, toStore: 'TSTS8', lines, permitNo: `KA-EX-${digits(6)}`, status: 'in_transit' };
    sendTransfer(t, date, false);
    transfers.push(t);
  };

  // Bill times: 10:00-22:30 in 10-minute slots, busiest 18:00-21:00.
  const slotCum: number[] = [];
  for (let s = 0, t = 0; s < 75; s++) {
    const hour = 10 + Math.floor(s / 6);
    t += hour >= 18 && hour < 21 ? 2.4 : hour < 12 ? 0.6 : hour < 15 ? 0.8 : 1;
    slotCum.push(t);
  }
  const pickSlot = () => {
    const x = rng() * slotCum[slotCum.length - 1];
    let lo = 0;
    let hi = slotCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (slotCum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const pickRank = (c: StoreCtx) => {
    const x = rng() * c.cumWeights[c.cumWeights.length - 1];
    let lo = 0;
    let hi = c.cumWeights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c.cumWeights[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

  interface Cell { bills: number; net: Paise; cash: Paise; upi: Paise; card: Paise }

  const sellDay = (c: StoreCtx, date: string, daysAgo: number, dayIndex: number): Cell => {
    const code = c.store.code;
    const weekday = new Date(dayMs(date)).getUTCDay();
    const nBills = Math.max(1, Math.round(HUB_BILLS_PER_DAY * c.scale * DAY_FACTOR[weekday] * (1 + 0.06 * normal())));
    const times = Array.from({ length: nBills }, () => pickSlot() * 10 + ri(0, 9)).sort((a, b) => a - b);
    const shiftId = `SH-${code}-${date.replaceAll('-', '')}`;
    // Planted: three Corona 500 cans billed at the hub yesterday with nothing on the shelf.
    const coronaAt = new Set(code === HUB && daysAgo === 1 ? [0.3, 0.55, 0.8].map((f) => Math.floor(nBills * f)) : []);
    const cell: Cell = { bills: 0, net: 0, cash: 0, upi: 0, card: 0 };

    times.forEach((slotMin, idx) => {
      const at = istAt(date, 10 * 60 + slotMin, ri(0, 59));
      const lines: { p: Product; qty: number }[] = [];
      if (coronaAt.has(idx)) {
        lines.push({ p: corona500, qty: 1 });
      } else {
        const wanted = (() => { const r = rng(); return r < 0.5 ? 1 : r < 0.85 ? 2 : 3; })();
        for (let l = 0; l < wanted; l++) {
          let chosen: Product | undefined;
          for (let tries = 0; tries < 10 && !chosen; tries++) {
            const p = c.active[pickRank(c)];
            if (have(code, p.id) > 0 && !lines.some((x) => x.p.id === p.id)) chosen = p;
          }
          // Stock ran out on the picks: take the most popular product that is still on the shelf.
          chosen ??= c.active.find((p) => have(code, p.id) > 0 && !lines.some((x) => x.p.id === p.id));
          if (!chosen) continue;
          const r = rng();
          const want = chosen.sizeMl === 90 ? (r < 0.7 ? 1 : r < 0.9 ? 2 : 5) : r < 0.8 ? 1 : 2;
          // Only 1, 2 or 5 (5 on 90 ml): when the shelf is short of the wanted quantity, drop to the largest that fits.
          const qty = (chosen.sizeMl === 90 ? [5, 2, 1] : [2, 1]).find((q) => q <= want && q <= have(code, chosen!.id))!;
          lines.push({ p: chosen, qty });
          move(code, chosen.id, -qty, 'sale', '', at); // ref filled in below
        }
        if (!lines.length) return;
      }

      const number = billNumber(code, 1, financialYear(at), c.seq);
      c.seq += 1;
      // Fix up the refs of the movements just written for this bill (the planted bills write theirs here).
      if (coronaAt.has(idx)) move(code, corona500.id, -1, 'sale', number, at);
      else for (let m = movements.length - lines.length; m < movements.length; m++) movements[m].ref = number;

      let gross = 0;
      let discount = 0;
      for (const { p, qty } of lines) {
        const offer = p.id === efkays180.id;
        const d = offer ? 500 * qty : 0;
        unitsByDay.set(`${code}|${p.id}|${dayIndex}`, (unitsByDay.get(`${code}|${p.id}|${dayIndex}`) ?? 0) + qty);
        gross += mrpOf(p) * qty;
        discount += d;
        billLines.push({
          billNumber: number,
          productId: p.id,
          qty,
          mrp: mrpOf(p),
          ...(offer ? { offerCode: OFFER_CODE } : {}),
          discount: d,
          tax: 0,
          amount: mrpOf(p) * qty - d,
        });
      }
      const net = gross - discount;
      const r = rng();
      const mode: PayMode = r < 0.7 ? 'upi' : r < 0.95 ? 'cash' : 'card';
      bills.push({
        number,
        clientId: uuid(),
        storeCode: code,
        counter: 1,
        cashierId: c.cashierId,
        shiftId,
        at,
        gross,
        discount,
        tax: 0,
        net,
        status: 'paid',
      });
      payments.push({ billNumber: number, mode, amount: net });
      cell.bills += 1;
      cell.net += net;
      cell[mode] += net;
    });
    return cell;
  };

  const lossReasons: Loss['reason'][] = ['breakage', 'breakage', 'breakage', 'theft', 'other'];
  let lossNo = 0;

  for (let i = 0; i < days; i++) {
    const date = addDays(firstDay, i);
    const daysAgo = days - i;
    if (daysAgo % DELIVERY_EVERY_DAYS === 1) deliverGrn(date);
    if (i === 1) plantShortDatedBeer(date);
    dailyTransfers(date, daysAgo, i);
    if (daysAgo === 2) plantTransfer(date);

    for (const c of ctxs) {
      const cell = sellDay(c, date, daysAgo, i);
      const code = c.store.code;

      // An occasional breakage or similar, written off after closing.
      if (chance(0.12)) {
        const p = c.active[ri(5, ACTIVE_COUNT - 1)];
        const qty = Math.min(ri(1, 2), have(code, p.id));
        if (qty > 0) {
          lossNo += 1;
          const ref = `LOSS-${String(lossNo).padStart(4, '0')}`;
          const at = istAt(date, 22 * 60 + 40);
          move(code, p.id, -qty, 'loss', ref, at);
          losses.push({ storeCode: code, productId: p.id, qty, reason: lossReasons[ri(0, lossReasons.length - 1)], at, by: c.managerId, ref });
        }
      }

      const floatPaise = 200000;
      const expected = floatPaise + cell.cash;
      const diff = chance(0.8) ? 0 : (chance(0.5) ? -1 : 1) * ri(1, 10) * 1000;
      shifts.push({
        id: `SH-${code}-${date.replaceAll('-', '')}`,
        storeCode: code,
        cashierId: c.cashierId,
        openedAt: istAt(date, 9 * 60 + 45),
        closedAt: istAt(date, 22 * 60 + 50),
        floatPaise,
        counted: expected + diff,
        expected,
        diff,
      });
      // Planted: TS4 never locked yesterday.
      if (!(code === 'TSTS4' && date === yesterday)) {
        dayCloses.push({
          storeCode: code,
          date,
          lockedAt: istAt(date, 23 * 60),
          totals: { bills: cell.bills, net: cell.net, cash: cell.cash, upi: cell.upi, card: cell.card },
        });
      }
    }
  }

  // The last two deliveries are not paid for yet.
  for (const g of grns.filter((x) => x.storeCode === HUB).slice(0, -2)) {
    supplierPayments.push({ supplierId: 'SUP-KSBCL', amount: g.invoiceAmount + g.tcs, paidOn: addDays(g.receivedAt.slice(0, 10), 10), ref: g.invoiceNo });
  }

  // ---- counters: live billing carries on from the last seeded number ----

  const counters: CounterRow[] = ctxs.map((c) => ({ storeCode: c.store.code, counter: 1, next: c.seq }));

  // ---- loyalty stand-in ----

  const joined = istAt(addDays(today, -20), 12 * 60);
  const fy = financialYear(istAt(today, 12 * 60));
  const loyaltyMembers: LoyaltyMember[] = [
    { code: '7K3M9QX2RA', name: 'Ravi', phone: '9845014821', createdAt: joined },
    { code: 'B4N8TC5WZ6', name: 'Meena', phone: '9000000002', createdAt: joined },
    { code: 'H2D9F7GKP3', name: 'Kiran', phone: '9000000003', createdAt: joined },
  ];
  const earn = (memberCode: string, points: number, billRef: string, storeCode: string): LoyaltyLedgerRow => ({
    memberCode,
    points,
    kind: 'earn',
    storeCode,
    fy,
    billRef,
    at: istAt(addDays(today, -10), 18 * 60),
  });
  const loyaltyLedger: LoyaltyLedgerRow[] = [
    earn('7K3M9QX2RA', 150, 'SEED-1', HUB),
    earn('7K3M9QX2RA', 90, 'SEED-2', HUB),
    earn('B4N8TC5WZ6', 60, 'SEED-3', 'TSTS2'),
    earn('H2D9F7GKP3', 120, 'SEED-4', 'TSTS3'),
  ];
  const rewards: Reward[] = [
    { id: 'R-50', name: '₹50 off next visit', cost: 100, active: true },
    { id: 'R-150', name: '₹150 off next visit', cost: 250, active: true },
  ];

  return {
    products,
    prices,
    stores,
    users,
    movements,
    bills,
    billLines,
    payments,
    shifts,
    dayCloses,
    counters,
    offers,
    indents,
    grns,
    transfers,
    counts: [],
    losses,
    claims: [],
    suppliers,
    supplierPayments,
    outbox: [],
    loyaltyQueue: [],
    kv: [],
    loyaltyMembers,
    loyaltyLedger,
    rewards,
  };
}
