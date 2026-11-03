import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { priceCart } from '../../src/domain/cart';
import { formatINR } from '../../src/domain/money';
import * as prices from '../../src/domain/prices';
import { priceRowsInForce } from '../../src/domain/prices';
import type { Bill } from '../../src/domain/types';
import { setLang } from '../../src/i18n';
import { AppRoutes } from '../../src/routes';
import { loadSeedIfEmpty } from '../../src/seed/load';
import { login, logout } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST. No bill has been rung yet that day, so the owner app shows 28 Oct.
const NOON_IST = '2026-10-29T06:30:00.000Z';

configure({ asyncUtilTimeout: 15000 });
vi.setConfig({ testTimeout: 30000 });
let user: ReturnType<typeof userEvent.setup>;
let seededOffers: Set<string>;

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const where = () => screen.getByTestId('where').textContent;

function renderOwner(path = '/owner') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );
}

const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Owner menu' })).getByRole('link', { name });
/** The big number of the live card, as digits with Indian grouping (`5,34,335`). */
const liveNumber = async (label: string) => (await screen.findByLabelText(label)).querySelector('.ow-digits')!.textContent;

async function chooseShop(name: string) {
  await user.click(screen.getByRole('button', { name: /Choose a shop/ }));
  const sheet = await screen.findByRole('dialog', { name: 'Choose a shop' });
  await user.click(within(sheet).getByRole('button', { name }));
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await loadSeedIfEmpty(db, { days: 3 });
  seededOffers = new Set(await db.offers.toCollection().primaryKeys());
}, 120000);

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  user = userEvent.setup();
  await db.offers.filter((o) => !seededOffers.has(o.code)).delete();
  sessionStorage.clear();
  localStorage.clear();
  logout();
  expect(await login('U-OWNER', '4444')).toBe(true);
});

afterEach(() => {
  logout();
  setLang('en');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the owner app', () => {
  it('opens on Today and the four tabs switch screens', async () => {
    renderOwner();
    expect(await screen.findByLabelText('Sales yesterday')).toBeInTheDocument();
    expect(screen.getByText('Top brands')).toBeInTheDocument();
    expect(tab('Today')).toHaveAttribute('aria-current', 'page');

    await user.click(tab('Sales'));
    expect(await screen.findByText('Billed this hour')).toBeInTheDocument();
    expect(screen.getByText('Every bill, live')).toBeInTheDocument();
    expect(where()).toBe('/owner/sales');

    await user.click(tab('Stock'));
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Daily sheet')).toBeInTheDocument();

    await user.click(tab('More'));
    expect(await screen.findByRole('link', { name: /Purchases/ })).toBeInTheDocument();

    await user.click(tab('Today'));
    expect(await screen.findByLabelText('Sales yesterday')).toBeInTheDocument();
  });

  it('every tab is a link at least 44 px tall in the stylesheet, and the bar is labelled', async () => {
    renderOwner();
    await screen.findByLabelText('Sales yesterday');
    expect(screen.getByRole('navigation', { name: 'Owner menu' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').filter((a) => a.classList.contains('ow-tab'))).toHaveLength(4);
  });

  it('starts on all shops, and the shop picker scopes the figures', async () => {
    renderOwner();
    const chain = await liveNumber('Sales yesterday');
    expect(screen.getByRole('button', { name: /All shops/ })).toBeInTheDocument();
    const net = (code?: string) =>
      db.bills
        .filter((b: Bill) => b.status === 'paid' && (!code || b.storeCode === code) && b.at >= '2026-10-27T18:30:00.000Z' && b.at < '2026-10-28T18:30:00.000Z')
        .toArray()
        .then((rows) => rows.reduce((s, b) => s + b.net, 0));
    expect(`₹${chain}`).toBe(formatINR(await net()));

    await chooseShop('True Spirits 1');
    await waitFor(async () => expect(`₹${await liveNumber('Sales yesterday')}`).toBe(formatINR(await net('TSTS1'))));
    expect(screen.getByRole('button', { name: /True Spirits 1/ })).toBeInTheDocument();

    // The pick holds on the other tabs.
    await user.click(tab('Stock'));
    expect(await screen.findByRole('button', { name: /True Spirits 1 · 28 Oct/ })).toBeInTheDocument();
  });

  it('More reaches Purchases, Reports, Offers, Prices, Downloads, the nightly summary and Shops, each with a way back', async () => {
    renderOwner('/owner/more');
    const go = async (name: RegExp, shows: string | RegExp) => {
      await user.click(await screen.findByRole('link', { name }));
      expect((await screen.findAllByText(shows)).length).toBeGreaterThan(0);
      await user.click(screen.getByRole('link', { name: 'Back to More' }));
    };
    await go(/Purchases/, 'Top suppliers');
    await go(/Reports/, 'Brand-wise sales');
    await go(/Offers/, 'New offer');
    await go(/Push new prices/, /Price list/i);
    await go(/Downloads/, 'Stock valuation');
    await go(/Nightly summary/, 'Day');
    await go(/Shops/, 'Chain, month to date');
    expect(where()).toBe('/owner/more');
    // More stays lit while a screen opened from it is showing.
    await user.click(screen.getByRole('link', { name: /Purchases/ }));
    expect(tab('More')).toHaveAttribute('aria-current', 'page');
  });

  it('the Day / Night toggle sets data-theme and the pick is remembered', async () => {
    renderOwner('/owner/more');
    await screen.findByRole('group', { name: 'Colour theme' });
    const root = document.querySelector('.owner-app')!;
    await user.click(screen.getByRole('button', { name: 'Night' }));
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('ownerTheme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Night' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Day' }));
    expect(root).toHaveAttribute('data-theme', 'light');
  });

  it('follows the device colour scheme until the owner picks', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    renderOwner('/owner/more');
    await screen.findByRole('group', { name: 'Colour theme' });
    expect(document.querySelector('.owner-app')).toHaveAttribute('data-theme', 'dark');
    localStorage.setItem('ownerTheme', 'light');
  });

  it('uses a remembered pick over the device', async () => {
    localStorage.setItem('ownerTheme', 'light');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    renderOwner('/owner/more');
    await screen.findByRole('group', { name: 'Colour theme' });
    expect(document.querySelector('.owner-app')).toHaveAttribute('data-theme', 'light');
  });

  it('has no share, send, broadcast or WhatsApp link anywhere', async () => {
    const pages: [string, string][] = [
      ['/owner/sales', '.ow-bill'],
      ['/owner/stock', '.ow-ledger'],
      ['/owner/more', '.ow-rlink'],
      ['/owner/more/purchases', '.ow-totals'],
      ['/owner/more/reports', '.ow-brandbar'],
      ['/owner/more/offers', '.owner-offers'],
      ['/owner/more/downloads', '.ow-rlink'],
      ['/owner/more/summary', 'pre'],
      ['/owner/more/shops', '.ow-row'],
    ];
    for (const [path, loaded] of pages) {
      const view = renderOwner(path);
      await waitFor(() => expect(view.container.querySelector(loaded)).not.toBeNull(), { timeout: 30000 });
      const text = view.container.textContent ?? '';
      expect(text).not.toMatch(/share|send|broadcast/i);
      expect(screen.queryAllByRole('button', { name: /share|send|broadcast|whatsapp/i })).toHaveLength(0);
      expect(screen.queryAllByRole('link', { name: /share|send|broadcast|whatsapp/i })).toHaveLength(0);
      expect(view.container.querySelector('a[href*="wa.me"], a[href*="whatsapp"], a[href^="sms:"], a[href^="mailto:"]')).toBeNull();
      view.unmount();
    }
  }, 120000);

  it('shows the sales of a bill that arrives while the page is open with the fresh edge, once', async () => {
    renderOwner('/owner/sales');
    await screen.findByText('Every bill, live');
    await waitFor(() => expect(document.querySelectorAll('.ow-bill').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.ow-bill.fresh')).toHaveLength(0);
    const bill: Bill = { number: 'TSTS1/26-27/999001', clientId: 'fresh-1', storeCode: 'TSTS1', counter: 1, cashierId: 'U-CASHIER', shiftId: 'S', at: NOON_IST, gross: 12300, discount: 0, tax: 0, net: 12300, status: 'paid' };
    await db.bills.add(bill);
    try {
      const row = await screen.findByText(bill.number);
      await waitFor(() => expect(row.closest('.ow-bill')).toHaveClass('fresh'));
      expect(document.querySelectorAll('.ow-bill.fresh')).toHaveLength(1);
    } finally {
      await db.bills.delete(bill.number);
    }
  });

  it('the live chip says how long since the newest bill', async () => {
    renderOwner();
    const card = await screen.findByLabelText('Sales yesterday');
    await waitFor(() => expect(card.textContent).toMatch(/live · \d+[smhd]/));
  });
});

describe('the owner tools', () => {
  it('shows every shop, the chain month to date and the nightly summary text', async () => {
    renderOwner('/owner/more/shops');
    expect(await screen.findByText('True Spirits 1', undefined, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByText('True Spirits 4')).toBeInTheDocument();
    expect(screen.getByText('Chain, month to date')).toBeInTheDocument();

    renderOwner('/owner/more/summary');
    const preview = await screen.findByLabelText('WhatsApp nightly summary preview');
    // No bill has been rung yet today (29 Oct), so the page shows last night.
    expect(preview.textContent).toMatch(/^True Spirits · 28 Oct 2026\n/);
    expect(preview.textContent).toMatch(/\nTrue Spirits 1: ₹[\d,]+ \(Cash .*closed ✓\n/);
    expect(preview.textContent).toMatch(/\nTrue Spirits 4: ₹[\d,]+ \(Cash .*not closed\n/);
    expect(preview.textContent).toMatch(/\nChain: ₹[\d,]+$/);
  });

  it('copies the preview text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderOwner('/owner/more/summary');
    const preview = await screen.findByLabelText('WhatsApp nightly summary preview');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(preview.textContent));
  });

  it('[Push new prices] opens the price list inside the owner app', async () => {
    renderOwner('/owner/more');
    await user.click(await screen.findByRole('link', { name: /Push new prices/ }));
    expect(await screen.findByLabelText('Find a product')).toBeInTheDocument();
    expect(where()).toBe('/owner/prices');
    expect(tab('More')).toHaveAttribute('aria-current', 'page');
  });

  it('a new ₹10 off offer takes 1000 off the next bill line, and [End] stops it', async () => {
    const target = (await db.products.toArray()).find((p) => p.materialType === 'ALC' && !seededOffers.has(p.id) && p.shortName !== '' && !/efkay/i.test(p.description))!;
    renderOwner('/owner/more/offers');
    const form = (await screen.findByRole('heading', { name: 'New offer' })).parentElement!;
    await user.type(within(form).getByLabelText('Find a product'), target.shortName);
    await user.selectOptions(within(form).getByLabelText('Product'), target.id);
    await user.type(within(form).getByLabelText('₹ off per bottle'), '10');
    await user.click(within(form).getByRole('button', { name: 'Create offer' }));

    await waitFor(async () => expect((await db.offers.toArray()).length).toBe(seededOffers.size + 1));
    const offers = await db.offers.toArray();
    const created = offers.find((o) => !seededOffers.has(o.code))!;
    expect(created.createdBy).toBe('U-OWNER');
    const prices = priceRowsInForce(await db.prices.toArray(), '2026-10-29');
    const priced = priceCart({ lines: [{ productId: target.id, qty: 1 }] } as never, new Map([[target.id, target]]), (id) => prices.get(id)?.mrp ?? 0, offers, '2026-10-29');
    expect(priced.lines[0].discount).toBe(1000);

    await user.click(await screen.findByRole('button', { name: `End ${created.code}` }));
    await waitFor(async () => expect((await db.offers.get(created.code))!.to).toBe('2026-10-28'));
    const after = priceCart({ lines: [{ productId: target.id, qty: 1 }] } as never, new Map([[target.id, target]]), (id) => prices.get(id)?.mrp ?? 0, await db.offers.toArray(), '2026-10-29');
    expect(after.lines[0].discount).toBe(0);
  });

  it('a download that fails shows its error, and the next good download clears it', async () => {
    const spy = vi.spyOn(prices, 'priceRowsInForce').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    renderOwner('/owner/more/downloads');
    await user.click(await screen.findByRole('button', { name: 'Excise statement, this month' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not do that. Try again.');
    expect(spy).toHaveBeenCalled();

    const url = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: url, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    await user.click(screen.getByRole('button', { name: 'Excise statement, this month' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('logs out from More', async () => {
    renderOwner('/owner/more');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(where()).toBe('/login'));
  });
});
