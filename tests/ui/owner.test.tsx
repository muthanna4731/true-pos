import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { priceCart } from '../../src/domain/cart';
import { priceRowsInForce } from '../../src/domain/prices';
import { setLang } from '../../src/i18n';
import { loadSeedIfEmpty } from '../../src/seed/load';
import OwnerPage from '../../src/ui/owner/OwnerPage';
import { login, logout } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';

configure({ asyncUtilTimeout: 15000 });
vi.setConfig({ testTimeout: 30000 });
let user: ReturnType<typeof userEvent.setup>;
let seededOffers: Set<string>;

function renderOwner() {
  return render(
    <MemoryRouter initialEntries={['/owner']}>
      <Routes>
        <Route path="/owner" element={<OwnerPage />} />
        <Route path="*" element={<p>other page</p>} />
      </Routes>
    </MemoryRouter>,
  );
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
  logout();
  expect(await login('U-OWNER', '4444')).toBe(true);
});

afterEach(() => {
  logout();
  setLang('en');
  vi.restoreAllMocks();
});

describe('owner page', () => {
  it('shows every shop, the chain month to date and the nightly summary text', async () => {
    renderOwner();
    expect(await screen.findByRole("heading", { name: "True Spirits 1" }, { timeout: 15000 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'True Spirits 4' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chain, month to date' })).toBeInTheDocument();
    const preview = screen.getByLabelText('WhatsApp nightly summary preview');
    // No bill has been rung yet today (29 Oct), so the page shows last night.
    expect(preview.textContent).toMatch(/^True Spirits · 28 Oct 2026\n/);
    expect(preview.textContent).toMatch(/\nTrue Spirits 1: ₹[\d,]+ \(Cash .*closed ✓\n/);
    expect(preview.textContent).toMatch(/\nTrue Spirits 4: ₹[\d,]+ \(Cash .*not closed\n/);
    expect(preview.textContent).toMatch(/\nChain: ₹[\d,]+$/);
  });

  it('copies the preview text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderOwner();
    const preview = await screen.findByLabelText('WhatsApp nightly summary preview');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(preview.textContent));
  });

  it('has no share, send or broadcast control anywhere', async () => {
    renderOwner();
    await screen.findByRole("heading", { name: "True Spirits 1" }, { timeout: 15000 });
    expect(document.body.textContent).not.toMatch(/share|send|broadcast/i);
    expect(screen.queryByRole('button', { name: /share|send|broadcast/i })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('[Push new prices] leaves for the prices screen', async () => {
    renderOwner();
    await user.click(await screen.findByRole('button', { name: 'Push new prices' }));
    expect(await screen.findByText('other page')).toBeInTheDocument();
  });

  it('a new ₹10 off offer takes 1000 off the next bill line, and [End] stops it', async () => {
    const target = (await db.products.toArray()).find((p) => p.materialType === 'ALC' && !seededOffers.has(p.id) && p.shortName !== '' && !/efkay/i.test(p.description))!;
    renderOwner();
    const form = (await screen.findByRole('heading', { name: 'New offer' })).closest('section')!;
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
});
