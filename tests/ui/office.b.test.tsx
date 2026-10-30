import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { setLang } from '../../src/i18n';
import { loadSeedIfEmpty } from '../../src/seed/load';
import OfficeRoutes from '../../src/ui/office/OfficeRoutes';
import { login, logout } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';
const PRODUCT = 'ZZ-TEST-1';

let user: ReturnType<typeof userEvent.setup>;

function renderOffice(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/office/*" element={<OfficeRoutes />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

const mv = (kind: 'opening' | 'purchase' | 'sale' | 'transfer_out', qty: number, at: string, ref: string) => ({
  storeCode: 'TSTS1',
  productId: PRODUCT,
  qty,
  kind,
  ref,
  at,
});

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await loadSeedIfEmpty(db, { days: 3 });
}, 120000);

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  user = userEvent.setup();
  // A 12-bottle-case product with 1,000 + 24 - 5 - 12 = 1,007 bottles at the hub, and entries dated 12 Aug 2026.
  await db.products.put({
    id: PRODUCT, materialType: 'ALC', category: 'IML', subcategory: 'WHISKY', description: 'ZZ TEST WHISKY 750ML', brand: 'ZZ',
    shortName: 'ZZ Test 750', sizeMl: 750, pack: 'BTL', caseSize: 12, hsn: '22083020', taxRateBp: 0, barcode: 'ZZ-0000000001',
  });
  await db.movements.bulkAdd([
    mv('opening', 1000, '2026-07-01T06:30:00.000Z', 'OPEN'),
    mv('purchase', 24, '2026-08-12T06:30:00.000Z', 'GRN-ZZ-1'),
    mv('sale', -5, '2026-08-12T07:30:00.000Z', 'TSTS1/26-27/1'),
    mv('transfer_out', -12, '2026-08-12T08:30:00.000Z', 'TR-ZZ-1'),
  ]);
  sessionStorage.clear();
  logout();
  expect(await login('U-OFFICE', '3333')).toBe(true);
});

afterEach(async () => {
  logout();
  setLang('en');
  await db.movements.filter((m) => m.productId === PRODUCT).delete();
  await db.prices.where('productId').equals(PRODUCT).delete();
  await db.products.delete(PRODUCT);
  await db.losses.filter((l) => l.productId === PRODUCT).delete();
  await db.kv.delete('loyalty');
});

describe('stock', () => {
  it('shows bottles, then 83.92 cases for 1,007 bottles of a 12-bottle case', async () => {
    renderOffice('/office/stock');
    const sheet = (await screen.findByRole('heading', { name: 'Daily Sheet' })).closest('section')!;
    const row = (await within(sheet).findByText('ZZ Test 750')).closest('tr')!;
    expect(within(row).getAllByText('1,007').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Cases' }));
    expect(within(row).getAllByText('83.92').length).toBeGreaterThan(0);
  });

  it('opens the product history with sale, purchase and transfer rows dated like 12 Aug 2026', async () => {
    renderOffice('/office/stock');
    await user.click(await screen.findByText('ZZ Test 750'));
    const history = (await screen.findByRole('heading', { name: 'History: ZZ Test 750' })).closest('section')!;
    for (const kind of ['Sale', 'Purchase', 'Transfer out']) expect(within(history).getByText(kind)).toBeInTheDocument();
    expect(within(history).getAllByText('12 Aug 2026')).toHaveLength(3);
  });
});

describe('shops and staff', () => {
  it('shows Loyalty: OFF when the flag is off, and the note', async () => {
    await db.kv.put({ key: 'loyalty', value: false });
    renderOffice('/office/shops');
    expect(await screen.findByText('Loyalty: OFF')).toBeInTheDocument();
    expect(screen.getByText('Change it in Supabase → app_config')).toBeInTheDocument();
  });

  it('shows Loyalty: ON when the flag is on', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    renderOffice('/office/shops');
    expect(await screen.findByText('Loyalty: ON')).toBeInTheDocument();
  });
});

describe('transfers', () => {
  it('lists the stuck transfer and receiving it moves it out of the waiting list', async () => {
    renderOffice('/office/transfers');
    const waiting = (await screen.findByRole('heading', { name: 'Waiting to be received' })).closest('section')!;
    expect(within(waiting).getByText('TR-PLANT-1')).toBeInTheDocument();
    await user.click(within(waiting).getAllByRole('button', { name: 'Mark received' })[0]);
    await waitFor(() => expect(db.transfers.get('TR-PLANT-1')).resolves.toMatchObject({ status: 'received' }));
    await waitFor(() => expect(screen.queryByText('TR-PLANT-1', { selector: 'strong' })).not.toBeInTheDocument());
    // Put the seed back for the other tests.
    await db.movements.filter((m) => m.ref === 'TR-PLANT-1' && m.kind === 'transfer_in').delete();
    await db.transfers.update('TR-PLANT-1', { status: 'in_transit', receivedAt: undefined });
  });

  it('refuses to dispatch without a permit number and writes nothing', async () => {
    renderOffice('/office/transfers');
    await user.click(await screen.findByRole('button', { name: 'New transfer' }));
    await user.type(screen.getByRole('textbox', { name: 'Find a product' }), 'ZZ Test');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Product' }), PRODUCT);
    await user.type(screen.getByRole('spinbutton', { name: 'Bottles' }), '12');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await user.click(screen.getByRole('button', { name: 'Dispatch' }));
    expect(await screen.findByText('Enter the permit number first.')).toBeInTheDocument();
    expect(await db.transfers.filter((x) => x.lines.some((l) => l.productId === PRODUCT)).count()).toBe(0);
  });
});

describe('losses', () => {
  it('records a loss from the form', async () => {
    renderOffice('/office/losses');
    await user.type(await screen.findByRole('textbox', { name: 'Find a product' }), 'ZZ Test');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Product' }), PRODUCT);
    await user.type(screen.getByRole('spinbutton', { name: 'Bottles' }), '2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reason' }), 'leakage');
    await user.click(screen.getByRole('button', { name: 'Save loss' }));
    expect(await screen.findByText('Loss saved.')).toBeInTheDocument();
    expect(await db.losses.filter((l) => l.productId === PRODUCT).toArray()).toMatchObject([{ qty: 2, reason: 'leakage', by: 'U-OFFICE' }]);
  });
});

describe('products', () => {
  it('pushes a new price effective tomorrow and keeps the history', async () => {
    await db.prices.add({ productId: PRODUCT, mrp: 100000, purchase: 80000, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'x' });
    renderOffice('/office/products');
    await user.type(await screen.findByRole('textbox', { name: 'Find a product' }), 'ZZ Test');
    await user.click(await screen.findByText('ZZ TEST WHISKY 750ML', { selector: 'td' }));
    const mrp = await screen.findByLabelText(/^MRP \(₹\)/);
    await user.clear(mrp);
    await user.type(mrp, '1100');
    await user.click(screen.getByRole('button', { name: 'Add price row' }));
    await user.click(screen.getByRole('button', { name: 'Push to all shops' }));
    expect(await screen.findByText('1 price rows pushed to all shops.')).toBeInTheDocument();
    const rows = await db.prices.where('productId').equals(PRODUCT).toArray();
    expect(rows.map((r) => [r.mrp, r.effectiveFrom])).toEqual([[100000, '2026-04-01'], [110000, '2026-10-30']]);
  });
});

describe('reports', () => {
  it('labels the excise reports Sample format and the valuation as landed cost', async () => {
    renderOffice('/office/reports');
    await user.click(await screen.findByRole('button', { name: 'Excise' }));
    expect(screen.getByText('Sample format')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Excise Litre Statement' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Valuation' }));
    expect(await screen.findByRole('heading', { name: 'Stock valuation (landed cost)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tally export' }));
    expect(screen.getByRole('heading', { name: 'Tally export (stub)' })).toBeInTheDocument();
  });
});
