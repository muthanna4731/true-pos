import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { recordSale } from '../../src/db/sales';
import { buildProduct } from '../../src/domain/catalogue';
import { sha256Hex } from '../../src/domain/hash';
import { onHand } from '../../src/domain/stock';
import type { PayMode, Product } from '../../src/domain/types';
import { setLang } from '../../src/i18n';
import BillScreen from '../../src/ui/bill/BillScreen';
import OfficeRoutes from '../../src/ui/office/OfficeRoutes';
import { login, logout } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';

const products: Product[] = [
  { subcategory: 'WHISKY', description: 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK' },
  { subcategory: 'WHISKY', description: 'ROYAL STAG DELUXE WHISKY 750 - BTL' },
].map((p, i) => buildProduct({ ...p, mrpRupees: 0 }, i + 1));
const [OC, STAG] = products;

const stockOf = async (id: string): Promise<number> => onHand(await db.movements.toArray(), 'TSTS1', id);

let user: ReturnType<typeof userEvent.setup>;
let cashierShift: string;
let n = 0;

async function sell(amount: number, mode: PayMode = 'cash', opts: { qty?: number; practice?: boolean; productId?: string } = {}) {
  n += 1;
  return recordSale({
    clientId: `c${n}`,
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId: cashierShift,
    lines: [{ productId: opts.productId ?? OC.id, qty: opts.qty ?? 1, mrp: amount / (opts.qty ?? 1), discount: 0, tax: 0 }],
    payments: [{ mode, amount }],
    practice: opts.practice ?? false,
  });
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderManager(path = '/office') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/office/*" element={<OfficeRoutes />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  user = userEvent.setup();
  n = 0;
  await resetDb();
  await db.stores.bulkAdd([
    { code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' },
    { code: 'TSTS2', number: '02', name: 'Yelahanka', branchSlug: null, isHub: false, upiVpa: 'y@upi', licenceNo: 'L2' },
  ]);
  await db.users.bulkAdd([
    { id: 'U1', name: 'Cashier 1', phone: '1', role: 'cashier', pinHash: sha256Hex('U1:1111'), storeCodes: ['TSTS1'] },
    { id: 'U2', name: 'Cashier 2', phone: '3', role: 'cashier', pinHash: sha256Hex('U2:1111'), storeCodes: ['TSTS2'] },
    { id: 'U-M', name: 'Manager', phone: '2', role: 'manager', pinHash: sha256Hex('U-M:2222'), storeCodes: ['TSTS1', 'TSTS2'] },
  ]);
  await db.products.bulkAdd(products);
  await db.prices.bulkAdd(products.map((p) => ({ productId: p.id, mrp: 10000, purchase: 7000, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'seed' })));
  await db.movements.bulkAdd(products.map((p) => ({ storeCode: 'TSTS1', productId: p.id, qty: 100, kind: 'opening' as const, ref: 'open', at: '2026-10-01T00:00:00.000Z' })));
  await db.shifts.add({ id: 'SH-U1', storeCode: 'TSTS1', cashierId: 'U1', openedAt: '2026-10-29T04:00:00.000Z', floatPaise: 100000 });
  cashierShift = 'SH-U1';
  sessionStorage.clear();
  logout();
});

afterEach(() => {
  logout();
  setLang('en');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('manager home', () => {
  it('shows the to-do home with the Manager row, today at a glance with its as-of stamp, and Practice mode', async () => {
    await sell(10000, 'cash');
    await sell(20000, 'upi');
    await sell(30000, 'card');
    await sell(99900, 'cash', { practice: true });
    await login('U-M', '2222');
    renderManager();

    const row = await screen.findByRole('region', { name: 'Manager' });
    expect(within(row).getByRole('combobox', { name: 'Shop' })).toBeInTheDocument();
    expect(await screen.findByText('Today: ₹600 · 3 bills · avg ₹200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practice mode' })).toBeInTheDocument();
    // Every other figure of the day.
    const glance = screen.getByRole('region', { name: 'Today at a glance' });
    expect(within(glance).getByText('as of 12:00 PM')).toBeInTheDocument();
    expect(within(glance).getByText('Month to date')).toBeInTheDocument();
    expect(within(glance).getByText('Cash').nextSibling).toHaveTextContent('₹100');
    expect(within(glance).getByText('UPI').nextSibling).toHaveTextContent('₹200');
    expect(within(glance).getByText('Card').nextSibling).toHaveTextContent('₹300');
    expect(within(glance).getByText('Whisky').nextSibling).toHaveTextContent('3 bottles · ₹600');
  });

  it('shows the figures of the shop picked, the hub first', async () => {
    await sell(10000, 'cash');
    await login('U-M', '2222');
    renderManager();
    const row = await screen.findByRole('region', { name: 'Manager' });
    const pick = await within(row).findByRole('combobox', { name: 'Shop' });
    expect(pick).toHaveValue('TSTS1');
    expect(await screen.findByText('Today: ₹100 · 1 bill · avg ₹100')).toBeInTheDocument();
    await user.selectOptions(pick, 'TSTS2');
    expect(await screen.findByText('Today: ₹0 · 0 bills · avg ₹0')).toBeInTheDocument();
  });

  it('stamps a closed day with its locked figures, not a time', async () => {
    await sell(10000);
    await db.dayCloses.add({
      storeCode: 'TSTS1',
      date: '2026-10-29',
      lockedAt: NOON_IST,
      totals: { net: 12300, bills: 1, avgBill: 12300, byMode: { cash: 12300, upi: 0, card: 0 }, alc: 12300, nalc: 0, byType: {}, discount: 0, monthToDate: 12300 },
    });
    await login('U-M', '2222');
    renderManager();
    expect(await screen.findByText('Closed day: locked figures')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Today at a glance' })).queryByText(/as of/)).toBeNull();
    expect(screen.getByText('Today: ₹123 · 1 bill · avg ₹123')).toBeInTheDocument();
  });

  it('turns practice mode on and off for the shop picked, and only for that shop', async () => {
    await login('U-M', '2222');
    renderManager();
    const toggle = await screen.findByRole('button', { name: 'Practice mode' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    await waitFor(async () => expect((await db.kv.get('practice:TSTS1'))?.value).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Practice mode' })).toHaveAttribute('aria-pressed', 'true'));
    expect(await db.kv.get('practice:TSTS2')).toBeUndefined();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), 'TSTS2');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Practice mode' })).toHaveAttribute('aria-pressed', 'false'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), 'TSTS1');
    await user.click(await screen.findByRole('button', { name: 'Practice mode' }));
    await waitFor(async () => expect((await db.kv.get('practice:TSTS1'))?.value).toBe(false));
  });

  it('is for the back office only: a cashier is sent to the bill screen', async () => {
    await login('U1', '1111');
    renderManager();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/bill'));
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
  });
});

describe('stock arrived', () => {
  beforeEach(async () => {
    await db.indents.add({ id: 'INDMYH26000001', storeCode: 'TSTS1', placedAt: '2026-10-26T09:00:00.000Z', status: 'placed', lines: [{ productId: STAG.id, cases: 4 }] });
    await login('U-M', '2222');
  });

  it('enters the invoice for a placed order, counts the door, marks breakage and saves', async () => {
    renderManager('/office/arrived');
    await user.click(await screen.findByRole('button', { name: 'Enter invoice' }));

    await user.type(screen.getByRole('textbox', { name: 'Invoice number' }), 'bad');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/SMYH26/);
    await user.clear(screen.getByRole('textbox', { name: 'Invoice number' }));
    await user.type(screen.getByRole('textbox', { name: 'Invoice number' }), 'smyh26123456');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // 4 cases of 12 are already shown as 48 bottles, and the line starts as matching.
    const row = (await screen.findByText(STAG.shortName)).closest('li') as HTMLElement;
    expect(within(row).getByText('Expected 48 bottles (4 cases)')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-status', 'match');

    const counted = within(row).getByRole('spinbutton', { name: `Counted ${STAG.shortName}` });
    await user.clear(counted);
    await user.type(counted, '24');
    expect(row).toHaveAttribute('data-status', 'short');
    expect(within(row).getByText('24 short')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Breakage' }));
    await user.click(within(row).getByRole('button', { name: 'Breakage' }));
    expect(within(row).getByText('Broken 2')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: `One more ${STAG.shortName}` }));
    await user.click(within(row).getByRole('button', { name: `One more ${STAG.shortName}` }));
    await user.type(counted, '5'); // 265 bottles against 48: extra
    expect(row).toHaveAttribute('data-status', 'extra');
    await user.clear(counted);
    await user.type(counted, '24');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Delivery saved')).toBeInTheDocument();
    expect(await stockOf(STAG.id)).toBe(100 + 22);
    expect(await db.claims.count()).toBe(1);
    expect((await db.grns.toArray())[0]).toMatchObject({ status: 'received', invoiceNo: 'SMYH26123456' });
    expect((await db.indents.get('INDMYH26000001'))?.status).toBe('received');
    // The order has gone from the list.
    expect(screen.queryByRole('button', { name: 'Enter invoice' })).toBeNull();
  });

  it('lists a delivery that is waiting to be counted, and says when nothing is waiting', async () => {
    await db.indents.update('INDMYH26000001', { status: 'received' });
    renderManager('/office/arrived');
    expect(await screen.findByText('No deliveries waiting')).toBeInTheDocument();
    await db.grns.add({
      id: 'GRN-9',
      storeCode: 'TSTS1',
      type: 'ksbcl',
      status: 'draft',
      supplierId: 'SUP-KSBCL',
      invoiceNo: 'SMYH26000009',
      receivedAt: NOON_IST,
      invoiceAmount: 12 * 7000,
      tcs: 0,
      lines: [{ productId: STAG.id, expected: 12, unitPrice: 7000 }],
    });
    await user.click(await screen.findByRole('button', { name: /SMYH26000009/ }));
    expect(await screen.findByText(STAG.shortName)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Delivery saved')).toBeInTheDocument();
    expect(await stockOf(STAG.id)).toBe(112);
    expect(await db.claims.count()).toBe(0);
  });
});

describe('stock arrived: shop picker', () => {
  it('shows the deliveries of the shop picked, and the count of that shop', async () => {
    await db.indents.add({ id: 'INDMYH26000002', storeCode: 'TSTS2', placedAt: '2026-10-26T09:00:00.000Z', status: 'placed', lines: [{ productId: STAG.id, cases: 2 }] });
    await login('U-M', '2222');
    renderManager('/office/arrived');
    expect(await screen.findByText('No deliveries waiting')).toBeInTheDocument(); // the hub has none
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), 'TSTS2');
    expect(await screen.findByRole('button', { name: 'Enter invoice' })).toBeInTheDocument();
    expect(screen.queryByText('No deliveries waiting')).toBeNull();
  });
});

describe('stock arrived: transfers', () => {
  beforeEach(async () => {
    await db.transfers.bulkAdd([
      { id: 'TR-IN-1', fromStore: 'TSTS2', toStore: 'TSTS1', lines: [{ productId: STAG.id, qty: 6 }], permitNo: 'KA-1', status: 'in_transit', dispatchedAt: '2026-10-28T05:00:00.000Z' },
      { id: 'TR-ELSEWHERE', fromStore: 'TSTS1', toStore: 'TSTS2', lines: [{ productId: OC.id, qty: 3 }], permitNo: 'KA-2', status: 'in_transit', dispatchedAt: '2026-10-28T05:00:00.000Z' },
      { id: 'TR-DONE', fromStore: 'TSTS2', toStore: 'TSTS1', lines: [{ productId: OC.id, qty: 2 }], permitNo: 'KA-3', status: 'received', dispatchedAt: '2026-10-20T05:00:00.000Z', receivedAt: '2026-10-21T05:00:00.000Z' },
    ]);
    await login('U-M', '2222');
  });

  it('lists only the transfers on their way to this shop, and Receive puts the stock on the shelf once', async () => {
    renderManager('/office/arrived');
    expect(await screen.findByText(/TR-IN-1/)).toBeInTheDocument();
    expect(screen.queryByText(/TR-ELSEWHERE/)).toBeNull();
    expect(screen.queryByText(/TR-DONE/)).toBeNull();
    expect(screen.queryByText('No deliveries waiting')).toBeNull();

    expect(await stockOf(STAG.id)).toBe(100);
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    await waitFor(async () => expect(await stockOf(STAG.id)).toBe(106));
    expect(await db.transfers.get('TR-IN-1')).toMatchObject({ status: 'received' });
    await waitFor(() => expect(screen.queryByText(/TR-IN-1/)).toBeNull());
    expect(await screen.findByText('No deliveries waiting')).toBeInTheDocument();
  });
});

describe('count shelf', () => {
  it('shows what is expected against what was counted, then saves the difference', async () => {
    await login('U-M', '2222');
    renderManager('/office/count');
    await user.click(await screen.findByRole('button', { name: 'Whisky' }));

    const ocCount = await screen.findByRole('spinbutton', { name: `Counted ${OC.shortName}` });
    const row = ocCount.closest('li') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('System 100')).toBeInTheDocument());
    await user.type(ocCount, '97');
    expect(within(row).getByText('3 bottles short')).toBeInTheDocument();
    const stagRow = screen.getByRole('spinbutton', { name: `Counted ${STAG.shortName}` }).closest('li') as HTMLElement;
    await user.type(within(stagRow).getByRole('spinbutton'), '101');
    expect(within(stagRow).getByText('1 bottle extra')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save count' }));
    expect(await screen.findByText('Count saved')).toBeInTheDocument();
    expect(await stockOf(OC.id)).toBe(97);
    expect(await stockOf(STAG.id)).toBe(101);
    expect(await db.counts.count()).toBe(1);
  });

  it('finds a bottle by search, and offers no save until something is counted', async () => {
    await login('U-M', '2222');
    renderManager('/office/count');
    expect(await screen.findByText('Pick a type or search for a bottle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save count' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Search bottle' }), 'stag');
    const input = await screen.findByRole('spinbutton', { name: `Counted ${STAG.shortName}` });
    expect(screen.queryByRole('spinbutton', { name: `Counted ${OC.shortName}` })).toBeNull();
    await user.type(input, '100');
    expect(await within(input.closest('li') as HTMLElement).findByText('Matches ✓')) // waits for the shelf figure.toBeInTheDocument();
  });
});

describe('close shift', () => {
  it('counts the notes, shows short cash with the UPI and card totals, and locks the day at the last close', async () => {
    await db.shifts.add({ id: 'SH-U1B', storeCode: 'TSTS1', cashierId: 'U1', openedAt: '2026-10-29T05:00:00.000Z', floatPaise: 200000 });
    await sell(20000, 'upi');
    await sell(10000, 'card');
    await login('U-M', '2222');
    renderManager('/office/close');

    // The manager has no shift of their own: only the cashier shifts are listed.
    expect(await screen.findAllByRole('button', { name: /Cashier 1/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Manager/ })).toBeNull();
    await user.click((await screen.findAllByRole('button', { name: /Cashier 1/ }))[0]); // SH-U1, float ₹1,000
    expect(await screen.findByText('Expected cash ₹1,000')).toBeInTheDocument();
    expect(screen.getByText('UPI total ₹200')).toBeInTheDocument();
    expect(screen.getByText('Card total ₹100')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add ₹500 note' }));
    await user.click(screen.getByRole('button', { name: 'Add ₹200 note' }));
    await user.click(screen.getByRole('button', { name: 'Add ₹200 note' }));
    expect(screen.getByText('Counted cash ₹900')).toBeInTheDocument();
    expect(screen.getByText('₹100 short')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove ₹200 note' }));
    expect(screen.getByText('₹300 short')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add ₹200 note' }));
    await user.click(screen.getByRole('button', { name: 'Add ₹200 note' }));
    expect(screen.getByText('₹100 over')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove ₹200 note' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    // Wait for the result view: the live "₹100 short" line above it is replaced by it, so it can't be the thing awaited.
    expect(await screen.findByText('Shift closed')).toBeInTheDocument();
    expect(screen.getByText('₹100 short')).toBeInTheDocument();
    expect(screen.queryByText(/Day locked/)).toBeNull(); // the other Cashier 1 shift is still open
    expect(await db.shifts.get('SH-U1')).toMatchObject({ expected: 100000, counted: 90000, diff: -10000 });

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(await screen.findByRole('button', { name: /Cashier 1/ }));
    await screen.findByText('Expected cash ₹2,000'); // SH-U1B
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Add ₹500 note' }));
    expect(screen.getByText('Matches ✓')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText(/Day locked/)).toBeInTheDocument();
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toBeDefined();
    await expect(sell(100)).rejects.toThrow('day_closed');

    // The manager has no shift, so closing one does not end the session.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(sessionStorage.getItem('session')).not.toBeNull();
    expect(await screen.findByText('No open shifts')).toBeInTheDocument();
  });

  it('lists the open shifts of the shop picked', async () => {
    await db.shifts.add({ id: 'SH-U2', storeCode: 'TSTS2', cashierId: 'U2', openedAt: '2026-10-29T04:00:00.000Z', floatPaise: 100000 });
    await login('U-M', '2222');
    renderManager('/office/close');
    expect(await screen.findByRole('button', { name: /Cashier 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cashier 2/ })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), 'TSTS2');
    expect(await screen.findByRole('button', { name: /Cashier 2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cashier 1/ })).toBeNull();

    // Closing the only open shift of TSTS2 locks TSTS2 and leaves TSTS1 open.
    await user.click(screen.getByRole('button', { name: /Cashier 2/ }));
    await screen.findByText('Expected cash ₹1,000');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText(/Day locked/)).toBeInTheDocument();
    expect(await db.dayCloses.get(['TSTS2', '2026-10-29'])).toBeDefined();
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Done' }));
  });

  it('says there is nothing to close when no shift is open', async () => {
    await db.shifts.clear();
    await login('U-M', '2222');
    renderManager('/office/close');
    expect(await screen.findByText('No open shifts')).toBeInTheDocument();
  });
});

describe('lock day', () => {
  it('offers [Lock day] once every shift of the day was ended by its cashier, and locks through the same path', async () => {
    await db.shifts.update('SH-U1', { closedAt: '2026-10-29T06:00:00.000Z', counted: 100000, expected: 100000, diff: 0 });
    await sell(20000, 'upi');
    await login('U-M', '2222');
    renderManager('/office/close');

    expect(await screen.findByText('No open shifts')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Lock day' }));
    expect(await screen.findByText(/Day locked/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock day' })).toBeNull();
    expect(await db.dayCloses.get(['TSTS1', '2026-10-29'])).toMatchObject({ date: '2026-10-29', lockedAt: NOON_IST });
    await expect(sell(100)).rejects.toThrow('day_closed');
  });

  it('does not offer [Lock day] while a shift is open, or when the day is already locked', async () => {
    await login('U-M', '2222');
    renderManager('/office/close');
    expect(await screen.findByRole('button', { name: /Cashier 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock day' })).toBeNull();

    // Shop 2 has no open shift: the day can be locked there, and only there.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Shop' }), 'TSTS2');
    expect(await screen.findByRole('button', { name: 'Lock day' })).toBeInTheDocument();
    await db.dayCloses.add({ storeCode: 'TSTS2', date: '2026-10-29', lockedAt: NOON_IST, totals: {} });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lock day' })).toBeNull());
  });
});

describe('bills', () => {
  it('lists today\'s bills and shows a bill\'s lines with Reprint', async () => {
    const bill = await sell(30000, 'upi', { qty: 3 });
    await sell(5000, 'cash', { practice: true });
    await login('U-M', '2222');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderManager('/office/bills');

    const list = await screen.findByRole('list', { name: 'Bills' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    const rows = within(list).getAllByRole('listitem');
    const row = rows.find((r) => within(r).queryByText(bill.number))!;
    expect(row).toHaveTextContent('12:00 PM');
    expect(row).toHaveTextContent('Cashier 1');
    expect(row).toHaveTextContent('₹300');
    expect(row).toHaveTextContent('UPI');
    expect(within(list).getByText('PRACTICE')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: new RegExp(bill.number) }));
    const dialog = await screen.findByRole('dialog', { name: `Bill ${bill.number}` });
    expect(await within(dialog).findByText(OC.shortName)).toBeInTheDocument();
    expect(within(dialog).getByText('×3')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reprint' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('voids a bill only after the manager PIN again, and puts the stock back', async () => {
    const bill = await sell(50000, 'cash', { qty: 5 });
    expect(await stockOf(OC.id)).toBe(95);
    await login('U-M', '2222');
    renderManager('/office/bills');

    await user.click(await screen.findByRole('button', { name: new RegExp(bill.number) }));
    const dialog = await screen.findByRole('dialog', { name: `Bill ${bill.number}` });
    await user.click(await within(dialog).findByRole('button', { name: 'Void' }));

    for (const d of '0000') await user.click(within(dialog).getByRole('button', { name: d }));
    expect(await within(dialog).findByText('Wrong PIN')).toBeInTheDocument();
    expect(await stockOf(OC.id)).toBe(95);
    expect((await db.bills.get(bill.number))?.status).toBe('paid');

    for (const d of '1111') await user.click(within(dialog).getByRole('button', { name: d })); // the cashier's PIN is not enough
    expect(await within(dialog).findByText('Wrong PIN')).toBeInTheDocument();
    expect(await stockOf(OC.id)).toBe(95);

    for (const d of '2222') await user.click(within(dialog).getByRole('button', { name: d }));
    await waitFor(async () => expect((await db.bills.get(bill.number))?.status).toBe('void'));
    expect(await stockOf(OC.id)).toBe(100);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Bill ${bill.number}` })).toBeNull());
    expect(await screen.findByText('VOID')).toBeInTheDocument();

    // A voided bill shows no Void button.
    await user.click(screen.getByRole('button', { name: new RegExp(bill.number) }));
    const again = await screen.findByRole('dialog', { name: `Bill ${bill.number}` });
    await within(again).findByText('VOID');
    expect(within(again).queryByRole('button', { name: 'Void' })).toBeNull();
    expect(within(again).getByRole('button', { name: 'Reprint' })).toBeInTheDocument();
  });

  it('shows no Void on a practice bill, or on any bill once the day is locked', async () => {
    const practice = await sell(5000, 'cash', { practice: true });
    const paid = await sell(10000, 'cash');
    await login('U-M', '2222');
    renderManager('/office/bills');

    await user.click(await screen.findByRole('button', { name: new RegExp(practice.number) }));
    let dialog = await screen.findByRole('dialog', { name: `Bill ${practice.number}` });
    await within(dialog).findByText('PRACTICE'); // the receipt has loaded
    expect(within(dialog).queryByRole('button', { name: 'Void' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: new RegExp(paid.number) }));
    dialog = await screen.findByRole('dialog', { name: `Bill ${paid.number}` });
    expect(await within(dialog).findByRole('button', { name: 'Void' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await db.dayCloses.add({ storeCode: 'TSTS1', date: '2026-10-29', lockedAt: NOON_IST, totals: {} });
    await user.click(screen.getByRole('button', { name: new RegExp(paid.number) }));
    dialog = await screen.findByRole('dialog', { name: `Bill ${paid.number}` });
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Void' })).toBeNull());
  });

  it('says so when there are no bills yet today', async () => {
    await login('U-M', '2222');
    renderManager('/office/bills');
    expect(await screen.findByText('No bills yet today')).toBeInTheDocument();
  });
});

describe('cashier end shift', () => {
  it('opens the same count screen for the cashier\'s own shift, then logs out', async () => {
    await login('U1', '1111'); // reuses SH-U1 (float ₹1,000)
    render(<BillScreen />);
    await user.click(await screen.findByRole('button', { name: 'End shift' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close shift' });
    expect(await within(dialog).findByText('Expected cash ₹1,000')).toBeInTheDocument(); // the figures load after the dialog opens
    for (let i = 0; i < 2; i++) await user.click(within(dialog).getByRole('button', { name: 'Add ₹500 note' }));
    expect(within(dialog).getByText('Matches ✓')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await within(dialog).findByText('Shift closed')).toBeInTheDocument();
    expect((await db.shifts.get('SH-U1'))?.closedAt).toBe(NOON_IST);
    expect(within(dialog).queryByText(/Day locked/)).toBeNull(); // a cashier's own close never locks the day
    expect(await db.dayCloses.count()).toBe(0);
    expect(sessionStorage.getItem('session')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(sessionStorage.getItem('session')).toBeNull();
  });

  it('can be cancelled without closing the shift', async () => {
    await login('U1', '1111');
    render(<BillScreen />);
    await user.click(await screen.findByRole('button', { name: 'End shift' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Close shift' })).toBeNull();
    expect((await db.shifts.get('SH-U1'))?.closedAt).toBeUndefined();
  });
});

describe('Kannada', () => {
  it('has the manager home in Kannada', async () => {
    setLang('kn');
    await login('U-M', '2222');
    renderManager();
    expect(await screen.findByRole('link', { name: 'ಸ್ಟಾಕ್ ಬಂತು' })).toBeInTheDocument();
  });
});
