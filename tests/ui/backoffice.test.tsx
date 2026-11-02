import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { buildProduct } from '../../src/domain/catalogue';
import { sha256Hex } from '../../src/domain/hash';
import { setLang } from '../../src/i18n';
import { AppRoutes } from '../../src/routes';
import { resetWorkShop } from '../../src/ui/office/ShopScope';
import { login, logout, useSession } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';

const product = buildProduct({ subcategory: 'WHISKY', description: 'ROYAL STAG DELUXE WHISKY 750 - BTL', mrpRupees: 0 }, 1);

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const where = () => screen.getByTestId('where').textContent;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );
}

/** The header links of the signed-in role. */
const headerLinks = (): string[] => within(screen.getByRole('navigation', { name: 'Menu' })).getAllByRole('link').map((a) => a.textContent ?? '');

const MANAGER_ONLY_LINKS = ['Close shift', 'Bills', 'Offers', 'Shops & staff'];
const SHARED_LINKS = ['Orders', 'Deliveries', 'Transfers', 'Stock', 'Stock arrived', 'Count shelf', 'Losses', 'Suppliers', 'Products', 'Reports'];
const MANAGER_ONLY_PATHS = ['/office/shops', '/office/close', '/office/bills', '/office/offers'];

let user: ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  user = userEvent.setup();
  await resetDb();
  await db.stores.bulkAdd([
    { code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' },
    { code: 'TSTS2', number: '02', name: 'Yelahanka', branchSlug: null, isHub: false, upiVpa: 'y@upi', licenceNo: 'L2' },
  ]);
  await db.users.bulkAdd([
    { id: 'U1', name: 'Cashier 1', phone: '1', role: 'cashier', pinHash: sha256Hex('U1:1111'), storeCodes: ['TSTS1'] },
    { id: 'U2', name: 'Cashier 2', phone: '2', role: 'cashier', pinHash: sha256Hex('U2:1111'), storeCodes: ['TSTS2'] },
    { id: 'U-M', name: 'Manager', phone: '99999001', role: 'manager', pinHash: sha256Hex('U-M:2222'), storeCodes: ['TSTS1', 'TSTS2'] },
    { id: 'U-OFFICE', name: 'Office', phone: '3', role: 'office', pinHash: sha256Hex('U-OFFICE:3333'), storeCodes: ['TSTS1', 'TSTS2'] },
    { id: 'U-OWNER', name: 'Owner', phone: '4', role: 'owner', pinHash: sha256Hex('U-OWNER:4444'), storeCodes: ['TSTS1', 'TSTS2'] },
  ]);
  await db.products.add(product);
  await db.prices.add({ productId: product.id, mrp: 10000, purchase: 7000, aroed: 0, cess: 0, effectiveFrom: '2026-04-01', pushedBy: 'seed' });
  sessionStorage.clear();
  logout();
  resetWorkShop();
});

afterEach(() => {
  logout();
  setLang('en');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('manager login', () => {
  it('opens no shift and has no shop: the header says just "Manager"', async () => {
    expect(await login('U-M', '2222')).toBe(true);
    let session: ReturnType<typeof useSession> | undefined;
    function Probe() {
      session = useSession();
      return null;
    }
    renderAt('/office');
    render(<Probe />);
    expect(session?.user?.role).toBe('manager');
    expect(session?.store).toBeNull();
    expect(session?.shiftId).toBeNull();
    expect(await db.shifts.count()).toBe(0);
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(screen.getByText('Manager', { selector: '.who' })).toBeInTheDocument();
  });

  it('lands on the back-office home, and the cashier still gets a shift', async () => {
    renderAt('/login');
    await user.click(await screen.findByRole('button', { name: /^Manager / }));
    for (const d of '2222') await user.click(screen.getByRole('button', { name: d }));
    await waitFor(() => expect(where()).toBe('/office'));

    logout();
    expect(await login('U1', '1111')).toBe(true);
    expect(await db.shifts.where('cashierId').equals('U1').count()).toBe(1);
  });
});

describe('office', () => {
  beforeEach(async () => {
    await login('U-OFFICE', '3333');
  });

  it('sees the shared back-office links and none of the manager-only ones', async () => {
    renderAt('/office');
    await screen.findByRole('navigation', { name: 'Menu' });
    const links = headerLinks();
    for (const name of SHARED_LINKS) expect(links).toContain(name);
    for (const name of MANAGER_ONLY_LINKS) expect(links).not.toContain(name);
  });

  it('has no manager row on the home, and no manager buttons anywhere on it', async () => {
    renderAt('/office');
    await screen.findByRole('heading', { name: 'Today' });
    expect(screen.queryByRole('region', { name: 'Manager' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Today at a glance' })).toBeNull();
    for (const name of ['Close shift', 'Bills', 'Shops & staff', 'Practice mode', 'Prices']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // The shared screens are still one tap away.
    const tabs = screen.getByRole('navigation', { name: 'Today' });
    for (const name of ['Stock arrived', 'Count shelf']) expect(within(tabs).getByRole('button', { name })).toBeInTheDocument();
  });

  it.each(MANAGER_ONLY_PATHS)('is sent home from %s by a direct URL', async (path) => {
    renderAt(path);
    await waitFor(() => expect(where()).toBe('/office'));
    expect(screen.queryByRole('heading', { name: 'Shops & staff' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Close shift' })).toBeNull();
  });

  it('views Products but sees no way to edit a price or a short name', async () => {
    renderAt('/office/products');
    const row = await screen.findByText(product.description);
    await user.click(row);
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add price row' })).toBeNull();
    expect(screen.queryByRole('button', { name: /push/i })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Short name' })).toBeNull();
  });

  it('can open Stock arrived and Count shelf for any shop, hub first', async () => {
    renderAt('/office/arrived');
    const pick = await screen.findByRole('combobox', { name: 'Shop' });
    expect(pick).toHaveValue('TSTS1');
    await user.selectOptions(pick, 'TSTS2');
    expect(screen.getByRole('combobox', { name: 'Shop' })).toHaveValue('TSTS2');
  });
});

describe('manager', () => {
  beforeEach(async () => {
    await login('U-M', '2222');
  });

  it('sees every shared link and every manager-only link', async () => {
    renderAt('/office');
    await screen.findByRole('navigation', { name: 'Menu' });
    const links = headerLinks();
    for (const name of [...SHARED_LINKS, ...MANAGER_ONLY_LINKS]) expect(links).toContain(name);
  });

  it('has the Manager row of quick actions under the to-do home', async () => {
    renderAt('/office');
    const row = await screen.findByRole('region', { name: 'Manager' });
    for (const name of ['Close shift', 'Bills', 'Prices', 'Shops & staff']) expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument(); // the office to-do home is still there
    expect(screen.getByRole('region', { name: 'Today at a glance' })).toBeInTheDocument();
    expect(within(row).getByRole('combobox', { name: 'Shop' })).toHaveValue('TSTS1');
    await user.click(within(row).getByRole('button', { name: 'Shops & staff' }));
    await waitFor(() => expect(where()).toBe('/office/shops'));
  });

  it.each([
    ['/office/shops', 'Shops & staff'],
    ['/office/close', 'Close shift'],
    ['/office/bills', 'Bills'],
    ['/office/offers', 'Offers'],
    ['/office/products', 'Products'],
    ['/office/arrived', 'Stock arrived'],
    ['/office/count', 'Count shelf'],
  ])('opens %s', async (path, heading) => {
    renderAt(path);
    expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0);
    expect(where()).toBe(path);
  });

  it('edits prices and short names on Products', async () => {
    renderAt('/office/products');
    await user.click(await screen.findByText(product.description));
    expect(await screen.findByRole('button', { name: 'Save name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add price row' })).toBeInTheDocument();
  });

  it('sends the old /manager URLs to the back-office home', async () => {
    for (const path of ['/manager', '/manager/stock', '/manager/close']) {
      const view = renderAt(path);
      await waitFor(() => expect(where()).toBe('/office'));
      view.unmount();
    }
  });

  it('is not on the bill screen: that is for cashiers only', async () => {
    renderAt('/bill');
    await waitFor(() => expect(where()).toBe('/office'));
  });
});

describe('cashier and owner', () => {
  it('a cashier cannot open the back office', async () => {
    await login('U1', '1111');
    renderAt('/office/products');
    await waitFor(() => expect(where()).toBe('/bill'));
  });

  it('an owner is sent to the owner home, not the back office', async () => {
    await login('U-OWNER', '4444');
    renderAt('/office');
    await waitFor(() => expect(where()).toBe('/owner'));
  });
});

describe('Change PIN', () => {
  async function openStaff() {
    renderAt('/office/shops');
    const staff = (await screen.findByRole('heading', { name: 'Staff' })).closest('section')!;
    return within(staff).getAllByRole('row').find((r) => within(r).queryByText('Cashier 1'))!;
  }

  it('saves a new PIN entered twice, and login then accepts only the new one', async () => {
    await login('U-M', '2222');
    const row = await openStaff();
    await user.click(within(row).getByRole('button', { name: 'Change PIN' }));
    const dialog = await screen.findByRole('dialog', { name: 'New PIN for Cashier 1' });
    await user.type(within(dialog).getByLabelText('New PIN (4 digits)'), '5678');
    await user.type(within(dialog).getByLabelText('New PIN again'), '5678');
    await user.click(within(dialog).getByRole('button', { name: 'Save PIN' }));

    expect(await screen.findByText('PIN changed for Cashier 1')).toBeInTheDocument();
    expect((await db.users.get('U1'))?.pinHash).toBe(sha256Hex('U1:5678'));
    logout();
    expect(await login('U1', '1111')).toBe(false);
    expect(await login('U1', '5678')).toBe(true);
  });

  it('refuses two PINs that differ, or fewer than four digits, and changes nothing', async () => {
    await login('U-M', '2222');
    const row = await openStaff();
    await user.click(within(row).getByRole('button', { name: 'Change PIN' }));
    const dialog = await screen.findByRole('dialog', { name: 'New PIN for Cashier 1' });
    await user.type(within(dialog).getByLabelText('New PIN (4 digits)'), '5678');
    await user.type(within(dialog).getByLabelText('New PIN again'), '5679');
    await user.click(within(dialog).getByRole('button', { name: 'Save PIN' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The two PINs are not the same');

    await user.clear(within(dialog).getByLabelText('New PIN (4 digits)'));
    await user.clear(within(dialog).getByLabelText('New PIN again'));
    await user.type(within(dialog).getByLabelText('New PIN (4 digits)'), '12');
    await user.type(within(dialog).getByLabelText('New PIN again'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Save PIN' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Use exactly 4 digits');
    expect((await db.users.get('U1'))?.pinHash).toBe(sha256Hex('U1:1111'));
  });

  it('can be cancelled', async () => {
    await login('U-M', '2222');
    const row = await openStaff();
    await user.click(within(row).getByRole('button', { name: 'Change PIN' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
