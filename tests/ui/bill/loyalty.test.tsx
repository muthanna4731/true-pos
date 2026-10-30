import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../../src/db/db';
import { buildProduct } from '../../../src/domain/catalogue';
import { sha256Hex } from '../../../src/domain/hash';
import type { Bill, Product } from '../../../src/domain/types';
import { LoyaltyError, setLoyaltyClient, type LoyaltyClient } from '../../../src/loyalty/client';
import { DemoLoyaltyClient, setLoyaltyEnabled } from '../../../src/loyalty/demoClient';
import BillScreen from '../../../src/ui/bill/BillScreen';
import { RECEIPT_TIMING } from '../../../src/ui/bill/PayButtons';
import DemoPanel from '../../../src/ui/shell/DemoPanel';
import { closeDemoPanel, openDemoPanel } from '../../../src/ui/shell/demoPanelState';
import { login, logout } from '../../../src/ui/shell/session';

const NOON_IST = '2026-10-29T06:30:00.000Z';
const DAY_MS = 86400000;
const daysAgo = (n: number): string => new Date(Date.parse(NOON_IST) - n * DAY_MS).toISOString();
const RAVI = '7K3M9QX2RA';

// Two bottles, both among the shop's best sellers so each has a Top 12 tile.
const FIXTURE: [string, string, number][] = [
  ['WHISKY', 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', 5500],
  ['RUM', 'BACARDI RESERVA OCHO 180 - BTL', 30000],
];
const products: Product[] = FIXTURE.map(([subcategory, description], i) => buildProduct({ subcategory, description, mrpRupees: 0 }, i + 1));
const [OC, BACARDI] = products;

function past(number: string): Bill {
  return {
    number, clientId: `c-${number}`, storeCode: 'TSTS1', counter: 1, cashierId: 'U1', shiftId: 'S0',
    at: daysAgo(2), gross: 0, discount: 0, tax: 0, net: 0, status: 'paid',
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
  await db.movements.bulkAdd(products.map((p) => ({ storeCode: 'TSTS1', productId: p.id, qty: 100, kind: 'opening' as const, ref: 'open', at: daysAgo(30) })));
  for (let i = 0; i < products.length; i++) {
    const n = `TSTS1/26-27/${i + 1}`;
    await db.bills.add(past(n));
    await db.billLines.add({ billNumber: n, productId: products[i].id, qty: 40 - i * 3, mrp: 0, discount: 0, tax: 0, amount: 0 });
  }
  await db.loyaltyMembers.bulkAdd([
    { code: RAVI, name: 'Ravi', phone: '9845014821', createdAt: daysAgo(20) },
    { code: 'B4N8TC5WZ6', name: 'Meena', phone: '9000000002', createdAt: daysAgo(20) },
  ]);
  await db.loyaltyLedger.bulkAdd([
    { memberCode: RAVI, points: 150, kind: 'earn', storeCode: 'TSTS1', fy: '26-27', billRef: 'SEED-1', at: daysAgo(10) },
    { memberCode: RAVI, points: 90, kind: 'earn', storeCode: 'TSTS1', fy: '26-27', billRef: 'SEED-2', at: daysAgo(10) },
  ]);
  await db.rewards.bulkAdd([
    { id: 'R-50', name: '₹50 off next visit', cost: 100, active: true },
    { id: 'R-150', name: '₹150 off next visit', cost: 250, active: true },
  ]);
}

/** Type a code the way a scanner does: every key in the same instant, then Enter. */
function scan(code: string): void {
  act(() => {
    for (const key of code) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

const top = () => screen.getByRole('region', { name: 'Top 12 at this shop' });
const cart = () => screen.getByRole('region', { name: 'Cart' });
const tile = (name: string) => within(top()).getByRole('button', { name });
const customerBox = () => screen.queryByRole('textbox', { name: 'Member code' });
const memberLine = () => screen.queryByText(/R••• ··4821/);

async function renderBill(): Promise<void> {
  render(
    <MemoryRouter>
      <BillScreen />
      <DemoPanel />
    </MemoryRouter>,
  );
  await waitFor(() => expect(within(top()).getAllByRole('button').length).toBeGreaterThan(0));
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  user = userEvent.setup();
  await seedFixture();
  setLoyaltyClient(new DemoLoyaltyClient());
  sessionStorage.clear();
  logout();
  await login('U1', '1111');
});

afterEach(() => {
  closeDemoPanel();
  setLoyaltyClient(null);
  logout();
  vi.useRealTimers();
});

describe('bill screen: loyalty on', () => {
  beforeEach(async () => {
    await setLoyaltyEnabled(true);
  });

  it('shows a customer box, and scanning a member QR shows the masked name and points', async () => {
    await renderBill();
    expect(await screen.findByRole('textbox', { name: 'Member code' })).toBeInTheDocument();
    scan('TS1:7K3M-9QX2RA');
    expect(await screen.findByText('R••• ··4821 · 240 points')).toBeInTheDocument();
    expect(customerBox()).toBeNull();
    expect(screen.getByRole('button', { name: 'Use points' })).toBeInTheDocument();
  });

  it('never treats a member scan as a barcode that was not found', async () => {
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan('TS1:7K3M-9QX2RA');
    scan('B4N8TC5WZ6'); // also without the prefix
    await screen.findByText(/M••• ··0002/);
    expect(screen.queryByText(/Barcode not found/)).toBeNull();
  });

  it('attaches a member typed in the customer box, in any case and with dashes', async () => {
    await renderBill();
    await user.type(await screen.findByRole('textbox', { name: 'Member code' }), '7k3m-9qx2ra');
    await user.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText('R••• ··4821 · 240 points')).toBeInTheDocument();
  });

  it('says so for a member that does not exist, and attaches nobody', async () => {
    await renderBill();
    await user.type(await screen.findByRole('textbox', { name: 'Member code' }), 'ZZZZZZZZZZ');
    await user.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText('No member with that code')).toBeInTheDocument();
    expect(customerBox()).toBeInTheDocument();
  });

  it('still attaches the member when the loyalty server cannot be reached', async () => {
    const base = new DemoLoyaltyClient();
    const offline: LoyaltyClient = { ...base, flags: () => base.flags(), memberInfo: () => Promise.reject(new LoyaltyError('network')), earn: (...a) => base.earn(...a), redeem: (...a) => base.redeem(...a), reverse: (...a) => base.reverse(...a), rewards: () => base.rewards() };
    setLoyaltyClient(offline);
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan('TS1:7K3M-9QX2RA');
    expect(await screen.findByText('Customer added. Points will show when online')).toBeInTheDocument();
  });

  it('lists the rewards under [Use points] and redeems one, then shows the new balance', async () => {
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan(`TS1:${RAVI}`);
    await user.click(await screen.findByRole('button', { name: 'Use points' }));
    const dialog = screen.getByRole('dialog', { name: 'Use points' });
    expect(within(dialog).getByRole('button', { name: /₹150 off next visit/ })).toBeDisabled(); // 250 points needed, 240 held
    await user.click(within(dialog).getByRole('button', { name: /₹50 off next visit/ }));
    expect(await screen.findByText('R••• ··4821 · 140 points')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Use points' })).toBeNull();
    expect(await screen.findByText('₹50 off next visit: 100 points used')).toBeInTheDocument();
    expect((await db.loyaltyLedger.toArray()).filter((r) => r.kind === 'redeem').map((r) => r.points)).toEqual([-100]);
  });

  it('removes the customer from the bill with one tap', async () => {
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan(`TS1:${RAVI}`);
    await user.click(await screen.findByRole('button', { name: 'Remove customer' }));
    expect(memberLine()).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Member code' })).toBeInTheDocument();
  });

  it('keeps ordinary barcodes working', async () => {
    await db.products.update(OC.id, { barcode: '8901234567890' });
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan('8901234567890');
    await within(cart()).findByText(OC.shortName);
  });

  it('earns once for a member when Card is tapped twice quickly: one bill, one ledger row, empty queue', async () => {
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan(`TS1:${RAVI}`);
    await screen.findByText(/R••• ··4821/);
    await user.click(tile(BACARDI.shortName));
    const card = await screen.findByRole('button', { name: 'Card ₹300' });
    await act(async () => {
      card.click();
      card.click();
    });
    await screen.findByRole('dialog', { name: 'Receipt' });
    const bills = await db.bills.filter((b) => b.shiftId !== 'S0').toArray();
    expect(bills).toHaveLength(1);
    expect(bills[0].memberCode).toBe(RAVI);
    await waitFor(async () => expect((await db.loyaltyLedger.toArray()).filter((r) => r.billRef === bills[0].number)).toHaveLength(1));
    await waitFor(async () => expect(await db.loyaltyQueue.count()).toBe(0));
    const earned = (await db.loyaltyLedger.toArray()).filter((r) => r.billRef === bills[0].number);
    expect(earned).toEqual([expect.objectContaining({ memberCode: RAVI, points: 3, kind: 'earn', storeCode: 'TSTS1' })]);
    // The next customer starts with no member.
    expect(memberLine()).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Member code' })).toBeInTheDocument();
  });

  it('keeps the earn queued while the server cannot be reached, and sends it on the next flush', async () => {
    const base = new DemoLoyaltyClient();
    let down = true;
    const flaky: LoyaltyClient = {
      flags: () => base.flags(),
      memberInfo: (c) => base.memberInfo(c),
      earn: (...a) => (down ? Promise.reject(new LoyaltyError('network')) : base.earn(...a)),
      redeem: (...a) => base.redeem(...a),
      reverse: (...a) => base.reverse(...a),
      rewards: () => base.rewards(),
    };
    setLoyaltyClient(flaky);
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    scan(`TS1:${RAVI}`);
    await screen.findByText(/R••• ··4821/);
    await user.click(tile(BACARDI.shortName));
    await user.click(await screen.findByRole('button', { name: 'Card ₹300' }));
    await screen.findByRole('dialog', { name: 'Receipt' });
    await waitFor(async () => expect(await db.loyaltyQueue.count()).toBe(1));
    expect(await db.loyaltyLedger.count()).toBe(2); // only the two seeded rows
    down = false;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => expect(await db.loyaltyQueue.count()).toBe(0));
    expect(await db.loyaltyLedger.count()).toBe(3);
  });
});

describe('bill screen: practice mode', () => {
  it('acts as if loyalty were off: no customer line, member scans ignored without a word, cart unchanged', async () => {
    await setLoyaltyEnabled(true);
    await db.kv.put({ key: 'practice', value: true });
    await renderBill();
    await user.click(tile(OC.shortName));
    await within(cart()).findByText(OC.shortName);
    await screen.findByText(/practice/i);
    const before = cart().innerHTML;
    scan('TS1:7K3M-9QX2RA');
    scan('B4N8TC5WZ6');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(customerBox()).toBeNull();
    expect(memberLine()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use points' })).toBeNull();
    expect(screen.queryByText(/Barcode not found/)).toBeNull();
    expect(screen.queryByText('No member with that code')).toBeNull();
    expect(cart().innerHTML).toBe(before);
  });
});

describe('bill screen: loyalty off', () => {
  it('shows no customer line and ignores a member scan without a word, leaving the cart alone', async () => {
    await renderBill();
    await user.click(tile(OC.shortName));
    await within(cart()).findByText(OC.shortName);
    const before = cart().innerHTML;
    scan('TS1:7K3M-9QX2RA');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(customerBox()).toBeNull();
    expect(memberLine()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use points' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull(); // no notice of any kind
    expect(cart().innerHTML).toBe(before);
    expect(document.body.textContent).not.toMatch(/loyalty|points|customer/i);
  });

  it('is off when the switch was never read and nothing was saved', async () => {
    setLoyaltyClient(null);
    await renderBill();
    expect(customerBox()).toBeNull();
  });

  it('queues nothing when a bill is paid', async () => {
    await renderBill();
    await user.click(tile(BACARDI.shortName));
    await user.click(await screen.findByRole('button', { name: 'Card ₹300' }));
    await screen.findByRole('dialog', { name: 'Receipt' });
    expect(await db.loyaltyQueue.count()).toBe(0);
  });
});

describe('bill screen: the demo panel flips loyalty live', () => {
  it('shows and hides the customer box without a reload, and drops the member when it goes off', async () => {
    await renderBill();
    expect(customerBox()).toBeNull();

    act(() => openDemoPanel());
    const panel = await screen.findByRole('dialog', { name: 'Demo panel' });
    await user.click(within(panel).getByRole('button', { name: 'Loyalty ON' }));
    expect(await screen.findByRole('textbox', { name: 'Member code' })).toBeInTheDocument();
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: true });
    expect(await new DemoLoyaltyClient().flags()).toEqual({ loyalty: true });

    scan(`TS1:${RAVI}`);
    await screen.findByText(/R••• ··4821/);

    await user.click(within(screen.getByRole('dialog', { name: 'Demo panel' })).getByRole('button', { name: 'Loyalty OFF' }));
    await waitFor(() => expect(memberLine()).toBeNull());
    expect(customerBox()).toBeNull();
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: false });
    expect(await new DemoLoyaltyClient().flags()).toEqual({ loyalty: false });
  });

  it('its three member codes still work as scans', async () => {
    await setLoyaltyEnabled(true);
    await renderBill();
    await screen.findByRole('textbox', { name: 'Member code' });
    act(() => openDemoPanel());
    const panel = await screen.findByRole('dialog', { name: 'Demo panel' });
    await user.click(within(panel).getByRole('button', { name: /Meena/ }));
    expect(await screen.findByText(/M••• ··0002/)).toBeInTheDocument();
  });
});

// Keep the receipt from auto-closing under the tests' feet.
RECEIPT_TIMING.ms = 60000;
