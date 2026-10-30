import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../../src/db/db';
import { recordSale, DayClosedError } from '../../../src/db/sales';
import { buildProduct } from '../../../src/domain/catalogue';
import { sha256Hex } from '../../../src/domain/hash';
import type { Bill, Product } from '../../../src/domain/types';
import BillScreen from '../../../src/ui/bill/BillScreen';
import { RECEIPT_TIMING } from '../../../src/ui/bill/PayButtons';
import { login, logout } from '../../../src/ui/shell/session';

// Wrap recordSale so a test can make one call fail; by default it runs the real thing.
vi.mock('../../../src/db/sales', async (original) => {
  const real = await original<typeof import('../../../src/db/sales')>();
  return { ...real, recordSale: vi.fn(real.recordSale) };
});

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const DAY_MS = 86400000;
const daysAgo = (n: number): string => new Date(Date.parse(NOON_IST) - n * DAY_MS).toISOString();

// Four bottles, all among the shop's best sellers so each has a Top 12 tile.
const FIXTURE: [string, string, number][] = [
  ['WHISKY', 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', 5500],
  ['WHISKY', 'ROYAL STAG DELUXE WHISKY 90 - TPACK', 7500],
  ['RUM', 'BACARDI RESERVA OCHO 180 - BTL', 30000],
  ['WHISKY', 'BAGPIPER DELUXE WHISKY 90 - TPACK', 5000],
];
const products: Product[] = FIXTURE.map(([subcategory, description], i) => buildProduct({ subcategory, description, mrpRupees: 0 }, i + 1));
const [OC, STAG, BACARDI, BAG] = products;

function past(number: string): Bill {
  return {
    number,
    clientId: `c-${number}`,
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId: 'S0',
    at: daysAgo(2),
    gross: 0,
    discount: 0,
    tax: 0,
    net: 0,
    status: 'paid',
  };
}

async function seedFixture(): Promise<void> {
  await resetDb();
  await db.stores.add({ code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' });
  await db.users.add({ id: 'U1', name: 'Asha', phone: '9000000001', role: 'cashier', pinHash: sha256Hex('U1:1111'), storeCodes: ['TSTS1'] });
  await db.products.bulkAdd(products);
  await db.prices.bulkAdd(
    products.map((p, i) => ({ productId: p.id, mrp: FIXTURE[i][2], purchase: 0, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'seed' })),
  );
  await db.movements.bulkAdd(
    products.map((p) => ({ storeCode: 'TSTS1', productId: p.id, qty: 100, kind: 'opening' as const, ref: 'open', at: daysAgo(30) })),
  );
  // Old paid bills rank the four bottles, best first: OC 40, Stag 37, Bacardi 34, Bagpiper 31.
  for (let i = 0; i < products.length; i++) {
    const n = `TSTS1/26-27/${i + 1}`;
    await db.bills.add(past(n));
    await db.billLines.add({ billNumber: n, productId: products[i].id, qty: 40 - i * 3, mrp: 0, discount: 0, tax: 0, amount: 0 });
  }
}

const top = () => screen.getByRole('region', { name: 'Top 12 at this shop' });
const cart = () => screen.getByRole('region', { name: 'Cart' });

const newBills = () => db.bills.filter((b) => b.shiftId !== 'S0').toArray();
const stockOf = async (id: string): Promise<number> => (await db.movements.where('[storeCode+productId]').equals(['TSTS1', id]).toArray()).reduce((s, m) => s + m.qty, 0);

let user: ReturnType<typeof userEvent.setup>;
let taps = 0;
/** Every user tap goes through here so a test can count them. */
async function tap(el: HTMLElement): Promise<void> {
  taps++;
  await user.click(el);
}
const tile = (name: string) => within(top()).getByRole('button', { name });
const payButton = (name: RegExp | string) => screen.findByRole('button', { name });

async function renderBill(): Promise<void> {
  render(<BillScreen />);
  await waitFor(() => expect(within(top()).getAllByRole('button').length).toBeGreaterThan(0));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  vi.mocked(recordSale).mockClear();
  RECEIPT_TIMING.ms = 4000;
  user = userEvent.setup();
  taps = 0;
  await seedFixture();
  sessionStorage.clear();
  logout();
  await login('U1', '1111');
});

afterEach(() => {
  logout();
  vi.useRealTimers();
});

describe('bill screen: paying', () => {
  it('pays exact cash in one tap, shows the receipt with the bill number and the total, and clears the cart', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('Cash ₹55'));
    const dialog = screen.getByRole('dialog', { name: 'Cash' });
    await tap(within(dialog).getByRole('button', { name: 'Exact' }));

    const r = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(r).getByText(/TSTS1\/26-27\/100001/)).toBeInTheDocument();
    expect(within(r).getAllByText('₹55').length).toBeGreaterThan(0);
    // IST date and time, never the raw ISO instant.
    expect(within(r).getByText(/29 Oct 2026/)).toBeInTheDocument();
    expect(within(r).getByText(/12:00 PM/)).toBeInTheDocument();
    expect(within(r).queryByText(/2026-10-29/)).toBeNull();
    expect(within(cart()).getByText('Tap a bottle to start the bill')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cash' })).toBeNull();
    expect(await db.payments.toArray()).toEqual([expect.objectContaining({ mode: 'cash', amount: 5500 })]);
  });

  it('shows the change in notes and coins when more cash is given', async () => {
    await renderBill();
    await tap(tile(BACARDI.shortName));
    await tap(tile(STAG.shortName)); // 300 + 75 = ₹375
    await tap(await payButton('Cash ₹375'));
    const dialog = screen.getByRole('dialog', { name: 'Cash' });
    await tap(within(dialog).getByRole('button', { name: '₹500' }));
    expect(within(dialog).getByText('Give back ₹125')).toBeInTheDocument();
    expect(within(dialog).getByText('100')).toBeInTheDocument();
    expect(within(dialog).getByText('20')).toBeInTheDocument();
    expect(within(dialog).getByText('Coins ₹5')).toBeInTheDocument();
    expect(await db.bills.filter((b) => b.shiftId !== 'S0').count()).toBe(0);
    await tap(within(dialog).getByRole('button', { name: 'Done' }));
    await screen.findByRole('dialog', { name: 'Receipt' });
    // The drawer takes the bill amount, not the cash given.
    expect(await db.payments.toArray()).toEqual([expect.objectContaining({ mode: 'cash', amount: 37500 })]);
  });

  it('takes the cash given from the keypad and hides Done until it covers the total', async () => {
    await renderBill();
    await tap(tile(BACARDI.shortName));
    await tap(await payButton('Cash ₹300'));
    const dialog = screen.getByRole('dialog', { name: 'Cash' });
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
    await tap(within(dialog).getByRole('button', { name: '2' }));
    await tap(within(dialog).getByRole('button', { name: '9' }));
    await tap(within(dialog).getByRole('button', { name: '9' }));
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
    expect(within(dialog).queryByText(/Give back/)).toBeNull();
    await tap(within(dialog).getByRole('button', { name: 'Delete' }));
    await tap(within(dialog).getByRole('button', { name: '0' }));
    await tap(within(dialog).getByRole('button', { name: '0' }));
    // 2, 9, 0, 0 -> ₹2,900
    expect(within(dialog).getByText('Give back ₹2,600')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('lets the cashier back out of the cash dialog without recording anything', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('Cash ₹55'));
    await tap(within(screen.getByRole('dialog', { name: 'Cash' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(cart()).getByText(OC.shortName)).toBeInTheDocument();
    expect(await newBills()).toHaveLength(0);
  });

  it('pays by card at once, and tapping Card twice quickly makes exactly one bill and one stock deduction', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    const card = await payButton('Card ₹55');
    // Two taps in the same instant, before React can re-render.
    await act(async () => {
      card.click();
      card.click();
    });
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(vi.mocked(recordSale)).toHaveBeenCalledTimes(1);
    expect(await newBills()).toHaveLength(1);
    expect(await db.payments.toArray()).toEqual([expect.objectContaining({ mode: 'card', amount: 5500 })]);
    expect(await stockOf(OC.id)).toBe(99);
  });

  it('shows a QR code and Paid for UPI, and records the UPI payment on Paid', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('UPI ₹55'));
    const dialog = screen.getByRole('dialog', { name: 'UPI' });
    await waitFor(() => expect(dialog.querySelector('svg')).not.toBeNull());
    expect(within(dialog).getByText('₹55')).toBeInTheDocument();
    await tap(within(dialog).getByRole('button', { name: 'Paid' }));
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(await db.payments.toArray()).toEqual([expect.objectContaining({ mode: 'upi', amount: 5500 })]);
  });

  it('splits ₹1,000 as ₹500 cash and ₹500 UPI into two payment rows, and only enables Pay when the parts add up', async () => {
    await renderBill();
    for (let i = 0; i < 3; i++) await tap(tile(BACARDI.shortName));
    for (let i = 0; i < 2; i++) await tap(tile(BAG.shortName));
    await tap(await payButton('Split payment'));
    const dialog = screen.getByRole('dialog', { name: 'Split payment' });
    const pay = within(dialog).getByRole('button', { name: 'Pay' });
    expect(pay).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Cash'), '500');
    expect(pay).toBeDisabled();
    expect(within(dialog).getByText('Left ₹500')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('UPI'), '400');
    expect(pay).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('UPI'));
    await user.type(within(dialog).getByLabelText('UPI'), '500');
    expect(pay).toBeEnabled();
    await tap(pay);
    await screen.findByRole('dialog', { name: 'Receipt' });
    const payments = await db.payments.toArray();
    expect(payments).toHaveLength(2);
    expect(payments).toEqual(
      expect.arrayContaining([expect.objectContaining({ mode: 'cash', amount: 50000 }), expect.objectContaining({ mode: 'upi', amount: 50000 })]),
    );
  });

  it('fills the rest of the split with one tap', async () => {
    await renderBill();
    for (let i = 0; i < 3; i++) await tap(tile(BACARDI.shortName)); // ₹900
    await tap(await payButton('Split payment'));
    const dialog = screen.getByRole('dialog', { name: 'Split payment' });
    await user.type(within(dialog).getByLabelText('Cash'), '500');
    await tap(within(dialog).getByRole('button', { name: 'UPI: the rest' }));
    expect(within(dialog).getByLabelText('UPI')).toHaveValue('400');
    expect(within(dialog).getByRole('button', { name: 'Pay' })).toBeEnabled();
  });

  it('hides every pay button when the cart is empty', async () => {
    await renderBill();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^(Cash|UPI|Card)/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Split payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
  });

  it('marks the receipt PRACTICE and leaves stock alone in practice mode', async () => {
    await db.kv.put({ key: 'practice', value: true });
    await renderBill();
    expect(await screen.findByText("PRACTICE — bills don't count")).toBeInTheDocument();
    await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹55'));
    const r = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(r).getByText('PRACTICE')).toBeInTheDocument();
    const [bill] = await newBills();
    expect(bill.status).toBe('practice');
    expect(await stockOf(OC.id)).toBe(100);
    expect(await db.outbox.count()).toBe(0);
  });

  it('shows no practice band when practice mode is off', async () => {
    await db.kv.put({ key: 'practice', value: false });
    await renderBill();
    await tap(tile(OC.shortName));
    await payButton('Card ₹55');
    expect(screen.queryByText("PRACTICE — bills don't count")).toBeNull();
  });

  it('reopens the last receipt from Reprint, and tapping the receipt closes it', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹55'));
    await tap(await screen.findByRole('dialog', { name: 'Receipt' }));
    expect(screen.queryByRole('dialog', { name: 'Receipt' })).toBeNull();

    await tap(await payButton('Reprint'));
    const r = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(r).getByText(/TSTS1\/26-27\/100001/)).toBeInTheDocument();
    expect(within(r).getByText(OC.shortName)).toBeInTheDocument();
    expect(within(r).getByText('Card')).toBeInTheDocument();
    await tap(r);
    expect(screen.queryByRole('dialog', { name: 'Receipt' })).toBeNull();
  });

  it('closes the receipt by itself after the preview time', async () => {
    RECEIPT_TIMING.ms = 150;
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹55'));
    await screen.findByRole('dialog', { name: 'Receipt' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Receipt' })).toBeNull());
    expect(await newBills()).toHaveLength(1);
  });

  it('keeps the default receipt preview at 4 seconds', () => {
    expect(RECEIPT_TIMING.ms).toBe(4000);
  });

  it('gives two sales in a row different bill numbers and client ids', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹55'));
    await tap(await screen.findByRole('dialog', { name: 'Receipt' }));
    await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹55'));
    await screen.findByRole('dialog', { name: 'Receipt' });
    await waitFor(async () => expect(await newBills()).toHaveLength(2));
    const bills = await newBills();
    expect(new Set(bills.map((b) => b.number)).size).toBe(2);
    expect(new Set(bills.map((b) => b.clientId)).size).toBe(2);
    expect(await stockOf(OC.id)).toBe(98);
  });

  it('takes at most 7 taps to build and pay a 5-bottle bill', async () => {
    await renderBill();
    for (let i = 0; i < 5; i++) await tap(tile(OC.shortName));
    await tap(await payButton('Card ₹275'));
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(taps).toBeLessThanOrEqual(7);
    const lines = await db.billLines.filter((l) => l.billNumber.startsWith('TSTS1/26-27/1000')).toArray();
    expect(lines).toEqual([expect.objectContaining({ productId: OC.id, qty: 5 })]);
  });

  it('replaces the pay buttons with a message when the day is closed', async () => {
    await db.dayCloses.add({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST, totals: {} });
    await renderBill();
    await tap(tile(OC.shortName));
    expect(await screen.findByText('Day closed for today. Ask your manager.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Cash|UPI|Card)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Split payment' })).toBeNull();
  });

  it('shows the day-closed message instead of crashing when the day closes during the payment', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    const card = await payButton('Card ₹55');
    vi.mocked(recordSale).mockRejectedValueOnce(new DayClosedError());
    await tap(card);
    expect(await screen.findByText('Day closed for today. Ask your manager.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Cash|UPI|Card)/ })).toBeNull();
    expect(await newBills()).toHaveLength(0);
  });

  it('says so and lets the cashier try again when saving fails', async () => {
    await renderBill();
    await tap(tile(OC.shortName));
    const card = await payButton('Card ₹55');
    vi.mocked(recordSale).mockRejectedValueOnce(new Error('disk full'));
    await tap(card);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the bill, try again');
    expect(within(cart()).getByText(OC.shortName)).toBeInTheDocument();
    await tap(await payButton('Card ₹55'));
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(await newBills()).toHaveLength(1);
  });

  it('prices the receipt lines from the bill, with a total', async () => {
    await renderBill();
    await tap(tile(BACARDI.shortName));
    await tap(tile(BACARDI.shortName));
    await tap(await payButton('Card ₹600'));
    const r = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(within(r).getByText(BACARDI.shortName)).toBeInTheDocument();
    expect(within(r).getByText('×2')).toBeInTheDocument();
    expect(within(r).getByText('Hebbal')).toBeInTheDocument();
    expect(within(r).getByText('Total')).toBeInTheDocument();
    expect(within(r).queryByText('PRACTICE')).toBeNull();
  });
});
