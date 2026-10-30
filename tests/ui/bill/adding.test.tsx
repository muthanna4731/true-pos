import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../../src/db/db';
import { buildProduct } from '../../../src/domain/catalogue';
import { sha256Hex } from '../../../src/domain/hash';
import type { Bill, Product } from '../../../src/domain/types';
import { login, logout } from '../../../src/ui/shell/session';
import BillScreen from '../../../src/ui/bill/BillScreen';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const DAY_MS = 86400000;
const daysAgo = (n: number): string => new Date(Date.parse(NOON_IST) - n * DAY_MS).toISOString();

// The first twelve are the shop's best sellers, best first. The rest sold nothing in the last 14 days.
const SOLD: [string, string, number][] = [
  ['WHISKY', 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', 5500],
  ['WHISKY', 'HAYWARDS FINE WHISKY 90 - TPACK', 6000],
  ['WHISKY', 'BLACK & WHITE WHISKY 60 - PET', 4500],
  ['WHISKY', 'MCDOWELLS NO1 CELEBRATION WHISKY 180 - BTL', 21000],
  ['WHISKY', 'IMPERIAL BLUE WHISKY 90 - TPACK', 6500],
  ['WHISKY', 'OLD MONK RUM 90 - TPACK', 7000],
  ['WHISKY', 'ROYAL STAG DELUXE WHISKY 90 - TPACK', 7500],
  ['WHISKY', 'SIGNATURE RARE WHISKY 90 - TPACK', 8000],
  ['WHISKY', 'BAGPIPER DELUXE WHISKY 90 - TPACK', 5000],
  ['WHISKY', 'DSP BLACK WHISKY 90 - TPACK', 5200],
  ['RUM', 'BACARDI RESERVA OCHO 180 - BTL', 30000],
  ['BEER', 'BUDWEISER MAGNUM BEER 500 - CAN', 22000],
];
const UNSOLD: [string, string, number][] = [
  ['BEER', 'KINGFISHER STRONG PREMIUM BEER 650 - BTL', 18000],
  ['BEER', 'KINGFISHER ULTRA MAX PREMIUM STRONG BEER 500 - CAN', 20000],
  ['WHISKY', 'ANTIQUITY BLUE WHISKY 750 - BTL', 150000],
  ['WINE', 'ALTANO DOURO DOC RED WINE 750 - BTL', 90000],
  ['TEQUILA', 'SAUZA GOLD TEQUILA 750 - BTL', 300000],
  ['WATER', 'AQUAFINA WATER 1000 - PET', 2000],
];
const ALL = [...SOLD, ...UNSOLD];
const products: Product[] = ALL.map(([subcategory, description], i) => buildProduct({ subcategory, description, mrpRupees: 0 }, i + 1));
const byName = (shortName: string): Product => {
  const p = products.find((x) => x.shortName === shortName);
  if (!p) throw new Error(`no fixture product ${shortName}`);
  return p;
};

function bill(number: string, over: Partial<Bill> = {}): Bill {
  return {
    number,
    clientId: `c-${number}`,
    storeCode: 'TSTS1',
    counter: 1,
    cashierId: 'U1',
    shiftId: 'S1',
    at: daysAgo(2),
    gross: 0,
    discount: 0,
    tax: 0,
    net: 0,
    status: 'paid',
    ...over,
  };
}

async function seedFixture(): Promise<void> {
  await resetDb();
  await db.stores.add({ code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' });
  await db.stores.add({ code: 'TSTS2', number: '02', name: 'Yelahanka', branchSlug: null, isHub: false, upiVpa: 'y@upi', licenceNo: 'L2' });
  await db.users.add({ id: 'U1', name: 'Asha', phone: '9000000001', role: 'cashier', pinHash: sha256Hex('U1:1111'), storeCodes: ['TSTS1'] });
  await db.products.bulkAdd(products);
  await db.prices.bulkAdd(
    products.map((p, i) => ({
      productId: p.id,
      mrp: ALL[i][2],
      purchase: 0,
      aroed: 0,
      cess: 0,
      effectiveFrom: '2026-04-01',
      pushedBy: 'seed',
    })),
  );
  // Everything is in stock except the Antiquity.
  const antiquity = byName('Antiquity 750');
  await db.movements.bulkAdd(
    products
      .filter((p) => p.id !== antiquity.id)
      .map((p) => ({ storeCode: 'TSTS1', productId: p.id, qty: 100, kind: 'opening' as const, ref: 'open', at: daysAgo(30) })),
  );

  // Paid bills in the last 14 days make the ranking: OC 90 sells 40, then 37, 34, ...
  for (let i = 0; i < SOLD.length; i++) {
    await db.bills.add(bill(`TSTS1/26-27/${i + 1}`));
    await db.billLines.add({ billNumber: `TSTS1/26-27/${i + 1}`, productId: products[i].id, qty: 40 - i * 3, mrp: 0, discount: 0, tax: 0, amount: 0 });
  }
  // These must not count: a practice bill, a void bill, a bill 20 days old, and another shop's bill.
  const kf = byName('KF Strong 650');
  const skipped: [string, Partial<Bill>][] = [
    ['PRACTICE', { status: 'practice' }],
    ['VOID', { status: 'void' }],
    ['OLD', { at: daysAgo(20) }],
    ['OTHER', { storeCode: 'TSTS2' }],
  ];
  for (const [n, over] of skipped) {
    await db.bills.add(bill(n, over));
    await db.billLines.add({ billNumber: n, productId: kf.id, qty: 500, mrp: 0, discount: 0, tax: 0, amount: 0 });
  }
}

const top = () => screen.getByRole('region', { name: 'Top 12 at this shop' });
const grid = () => screen.getByRole('region', { name: 'All bottles' });
const cart = () => screen.getByRole('region', { name: 'Cart' });
const searchBox = () => screen.getByRole('textbox', { name: /scan or type/i });

async function renderBill() {
  const user = userEvent.setup();
  render(<BillScreen />);
  await waitFor(() => expect(within(top()).getAllByRole('button').length).toBeGreaterThan(0));
  return user;
}

/** A barcode scanner: keys a few ms apart, then Enter. The test clock is frozen, so every gap reads as 0 ms. */
function scan(code: string): void {
  for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await seedFixture();
  sessionStorage.clear();
  logout();
  await login('U1', '1111');
});

afterEach(() => {
  logout();
  vi.useRealTimers();
});

describe('bill screen: adding items', () => {
  it('shows the 12 best sellers of this shop in the last 14 days, best first', async () => {
    await renderBill();
    const tiles = within(top()).getAllByRole('button');
    expect(tiles).toHaveLength(12);
    expect(tiles[0]).toHaveAccessibleName('OC 90');
    expect(tiles[1]).toHaveAccessibleName('Hay 90');
    // Practice, void, old and other-shop sales don't count.
    expect(within(top()).queryByRole('button', { name: 'KF Strong 650' })).toBeNull();
  });

  it('adds one bottle per tap on a Top 12 tile', async () => {
    const user = await renderBill();
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    expect(within(cart()).getByText('OC 90')).toBeInTheDocument();
    expect(within(cart()).getByText('×2')).toBeInTheDocument();
    expect(screen.getByText('TOTAL ₹110')).toBeInTheDocument();
  });

  it('opens a keypad from the cart quantity and sets the typed quantity', async () => {
    const user = await renderBill();
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    await user.click(within(cart()).getByRole('button', { name: /change quantity/i }));
    const keypad = screen.getByRole('dialog', { name: 'Quantity' });
    await user.click(within(keypad).getByRole('button', { name: '5' }));
    await user.click(within(keypad).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(cart()).getByText('×5')).toBeInTheDocument();
    expect(screen.getByText('TOTAL ₹275')).toBeInTheDocument();
  });

  it('lets the + and − buttons change the quantity, and − on one bottle removes the line', async () => {
    const user = await renderBill();
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    await user.click(within(cart()).getByRole('button', { name: 'One more OC 90' }));
    expect(within(cart()).getByText('×2')).toBeInTheDocument();
    await user.click(within(cart()).getByRole('button', { name: 'One less OC 90' }));
    await user.click(within(cart()).getByRole('button', { name: 'One less OC 90' }));
    expect(within(cart()).queryByText('OC 90')).toBeNull();
  });

  it('narrows the grid to Kingfisher 650 when "kf 650" is typed', async () => {
    const user = await renderBill();
    expect(within(grid()).getByRole('button', { name: 'OC 90' })).toBeInTheDocument();
    await user.type(searchBox(), 'kf 650');
    expect(within(grid()).getByRole('button', { name: 'KF Strong 650' })).toBeInTheDocument();
    expect(within(grid()).queryByRole('button', { name: 'OC 90' })).toBeNull();
    expect(within(grid()).queryByRole('button', { name: 'KF Ultra 500' })).toBeNull();
  });

  it('hides whisky tiles on the Beer tab', async () => {
    const user = await renderBill();
    await user.click(screen.getByRole('button', { name: 'Beer' }));
    expect(within(grid()).getByRole('button', { name: 'KF Strong 650' })).toBeInTheDocument();
    expect(within(grid()).queryByRole('button', { name: 'OC 90' })).toBeNull();
    expect(within(grid()).queryByRole('button', { name: 'Altano Douro 750' })).toBeNull();
  });

  it('puts everything else, including NALC, on the Other tab', async () => {
    const user = await renderBill();
    await user.click(screen.getByRole('button', { name: 'Other' }));
    expect(within(grid()).getByRole('button', { name: byName('Sauza Gold 750').shortName })).toBeInTheDocument();
    expect(within(grid()).getByRole('button', { name: byName('Aquafina 1000').shortName })).toBeInTheDocument();
    expect(within(grid()).queryByRole('button', { name: 'OC 90' })).toBeNull();
  });

  it('shows "No match" and a Clear button when nothing is found, and Clear brings everything back', async () => {
    const user = await renderBill();
    await user.type(searchBox(), 'zzzz');
    expect(screen.getByText('No match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('No match')).toBeNull();
    expect(searchBox()).toHaveValue('');
    expect(within(grid()).getByRole('button', { name: 'OC 90' })).toBeInTheDocument();
  });

  it('still adds a bottle with no stock, with a yellow note for the manager', async () => {
    const user = await renderBill();
    await user.click(within(grid()).getByRole('button', { name: 'Antiquity 750' }));
    expect(within(cart()).getByText('Antiquity 750')).toBeInTheDocument();
    expect(await within(cart()).findByText('System shows 0 left, tell your manager')).toBeInTheDocument();
  });

  it('shows no stock note for a bottle that is in stock', async () => {
    const user = await renderBill();
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    expect(within(cart()).getByText('OC 90')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50)); // let the stock lookup finish
    expect(screen.queryByText(/System shows 0 left/)).toBeNull();
  });

  it('adds a scanned product without anything being focused', async () => {
    await renderBill();
    expect(document.body).toHaveFocus();
    scan(byName('KF Strong 650').barcode);
    expect(await within(cart()).findByText('KF Strong 650')).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('says so when a scanned barcode is not a product', async () => {
    await renderBill();
    scan('8909999999999');
    expect(await screen.findByText('Barcode not found: 8909999999999')).toBeInTheDocument();
    expect(within(cart()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows a ✕ when a cart line is tapped, and it removes the line with no confirm dialog', async () => {
    const user = await renderBill();
    await user.click(within(top()).getByRole('button', { name: 'OC 90' }));
    expect(within(cart()).queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(within(cart()).getByRole('button', { name: 'OC 90' }));
    await user.click(within(cart()).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(cart()).queryByText('OC 90')).toBeNull();
    expect(within(cart()).getByText('Tap a bottle to start the bill')).toBeInTheDocument();
  });

  it('keeps a slot for the pay buttons', async () => {
    await renderBill();
    expect(document.querySelector('[data-slot="pay"]')).not.toBeNull();
  });
});
