import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { saveDraftIndent } from '../../src/db/orders';
import { setLang } from '../../src/i18n';
import { loadSeedIfEmpty } from '../../src/seed/load';
import OfficeRoutes from '../../src/ui/office/OfficeRoutes';
import { login, logout } from '../../src/ui/shell/session';

// 29 Oct 2026, 12:00 IST.
const NOON_IST = '2026-10-29T06:30:00.000Z';

let user: ReturnType<typeof userEvent.setup>;

function renderOffice(path = '/office') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/office/*" element={<OfficeRoutes />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

// The seed is slow to build, so it is loaded once; each test starts by putting back what the last one added.
let seededIndents: Set<string>;
let seededGrns: Set<string>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOON_IST));
  await resetDb();
  await loadSeedIfEmpty(db, { days: 3 });
  seededIndents = new Set(await db.indents.toCollection().primaryKeys());
  seededGrns = new Set(await db.grns.toCollection().primaryKeys());
}, 120000);

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  user = userEvent.setup();
  await db.claims.clear();
  await db.indents.filter((i) => !seededIndents.has(i.id)).delete();
  await db.grns.filter((g) => !seededGrns.has(g.id)).delete();
  sessionStorage.clear();
  logout();
  expect(await login('U-OFFICE', '3333')).toBe(true);
});

afterEach(() => {
  logout();
  setLang('en');
  vi.restoreAllMocks();
});

describe('office home', () => {
  it('lists the planted problems with their actions, and the litres tile and tabs', async () => {
    renderOffice();
    expect(await screen.findByText(/Transfer TR-PLANT-1 not received/)).toBeInTheDocument();
    expect(screen.getByText('TS1 delivery: 2 cases short')).toBeInTheDocument();
    expect(screen.getByText(/at TS5 expires in 20 days/)).toBeInTheDocument();
    expect(screen.getByText('TS4 did not close yesterday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Call shop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise claim' })).toBeInTheDocument();

    // Many shops can be low on stock; only the first few are listed until the user asks.
    expect(screen.getAllByRole('button', { name: 'Make order' }).length).toBeLessThanOrEqual(5);
    await user.click(screen.getByRole('button', { name: /Show all \d+ low-stock items/ }));
    expect(screen.getAllByRole('button', { name: 'Make order' }).length).toBeGreaterThan(5);

    const tile = screen.getByRole('heading', { name: 'Litres, last 7 days' }).closest('section')!;
    for (const head of ['Opening', 'Received', 'Issued', 'Closing']) expect(within(tile).getByText(head)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Today' });
    for (const name of ['Orders', 'Deliveries', 'Transfers', 'Stock']) expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    expect(within(nav).getByText('More ▾')).toBeInTheDocument();
  });

  it('opens Deliveries from [Raise claim]', async () => {
    renderOffice();
    await user.click(await screen.findByRole('button', { name: 'Raise claim' }));
    expect(await screen.findByRole('heading', { name: /GRN-\d{8}-1 · S/ })).toBeInTheDocument();
  });
});

describe('orders', () => {
  it('suggests an order for the hub, copies it for the KSBCL portal as description and cases', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderOffice('/office/orders');
    expect(await screen.findByText(/is the hub: this order includes what the other shops need/)).toBeInTheDocument();
    const first = (await screen.findAllByRole('spinbutton'))[0] as HTMLInputElement;
    await user.clear(first);
    await user.type(first, '9');
    await user.click(screen.getByRole('button', { name: 'Copy for KSBCL portal' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    const lines = (write.mock.calls[0][0] as string).split('\n');
    expect(lines[0]).toMatch(/^.+ - (BTL|CAN|PET|TPACK)?.*\t9$|^.+\t9$/);
    for (const line of lines) expect(line).toMatch(/\t[1-9]\d*$/);
    expect(await screen.findByText('Copied. Paste it into the KSBCL portal.')).toBeInTheDocument();
  });

  it('refuses an indent number that does not look right, then places a draft with a good one and walks it to Dispatched', async () => {
    const product = (await db.products.toArray())[0];
    await saveDraftIndent('TSTS1', [{ productId: product.id, cases: 3 }]);
    renderOffice('/office/orders');
    const number = await screen.findByLabelText('Indent number');
    await user.type(number, '123');
    await user.click(screen.getByRole('button', { name: 'Place' }));
    expect(await screen.findByText('Indent number looks wrong (e.g. INDMYH26009468)')).toBeInTheDocument();
    expect(await db.indents.where('status').equals('draft').count()).toBe(1);

    await user.clear(number);
    await user.type(number, 'INDMYH26009468');
    await user.click(screen.getByRole('button', { name: 'Place' }));
    const row = async () => (await screen.findByText('INDMYH26009468')).closest('li')!;
    await user.click(within(await row()).getByRole('button', { name: 'Mark paid' }));
    await user.click(await within(await row()).findByRole('button', { name: 'Mark dispatched' }));
    await waitFor(async () => expect((await db.indents.get('INDMYH26009468'))?.status).toBe('dispatched'));
    // Received is never set by hand.
    expect(screen.queryByRole('button', { name: /received/i })).not.toBeInTheDocument();
  });
});

describe('deliveries', () => {
  it('lists KSBCL deliveries with indent, invoice, AROED, TCS and total, and opens one with its short quantity', async () => {
    renderOffice('/office/deliveries');
    const table = await screen.findByRole('table');
    for (const head of ['GRN no', 'Date', 'Shop', 'Indent', 'KSBCL invoice', 'Amount', 'AROED', 'TCS', 'Total']) {
      expect(within(table).getByRole('columnheader', { name: head })).toBeInTheDocument();
    }
    const yesterdays = within(table).getAllByRole('row').find((r) => within(r).queryByText('28 Oct 2026'))!;
    await user.click(within(yesterdays).getByRole('button', { name: /^GRN-/ }));
    expect(await screen.findByRole('columnheader', { name: 'Short' })).toBeInTheDocument();
    const kf = screen.getByRole('cell', { name: 'KF Strong 650' }).closest('tr')!;
    expect(within(kf).getAllByRole('cell')[4]).toHaveTextContent('24');
  });

  it('[Raise claim] creates a claim row and shows a printable note', async () => {
    expect(await db.claims.count()).toBe(0);
    renderOffice('/office/deliveries');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    const yesterdays = rows.find((r) => within(r).queryByText('28 Oct 2026'))!;
    await user.click(within(yesterdays).getByRole('button', { name: /^GRN-/ }));
    await user.click(await screen.findByRole('button', { name: 'Raise claim' }));
    const note = await screen.findByRole('region', { name: 'Claim note' });
    expect(within(note).getByRole('button', { name: 'Print note' })).toBeInTheDocument();
    const claims = await db.claims.toArray();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: 'filed', qty: 24, storeCode: 'TSTS1' });
    expect(screen.queryByRole('button', { name: 'Raise claim' })).not.toBeInTheDocument();
  });

  it('adds a new KSBCL delivery for the pending order only with a well-formed invoice number', async () => {
    renderOffice('/office/deliveries');
    const invoice = await screen.findByLabelText('KSBCL invoice');
    await user.type(invoice, '26008779.00');
    await user.click(screen.getByRole('button', { name: 'Add delivery' }));
    expect(await screen.findByText('Invoice number looks wrong (e.g. SMYH26009086)')).toBeInTheDocument();
    expect(await db.grns.where('status').equals('draft').count()).toBe(0);

    await user.clear(invoice);
    await user.type(invoice, 'SMYH26009086');
    await user.click(screen.getByRole('button', { name: 'Add delivery' }));
    await waitFor(async () => expect(await db.grns.where('status').equals('draft').count()).toBe(1));
  });

  it('has Returns and Local suppliers tabs', async () => {
    renderOffice('/office/deliveries');
    await user.click(await screen.findByRole('tab', { name: 'Returns' }));
    expect(await screen.findByRole('heading', { name: 'Returned to KSBCL' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Local suppliers' }));
    expect(await screen.findByRole('heading', { name: 'Local suppliers' })).toBeInTheDocument();
  });
});

// Last on purpose: it empties the seed to reach the all-clear.
describe('office home, all clear', () => {
  it('shows the all-clear when nothing needs the office', async () => {
    await db.transfers.where('id').equals('TR-PLANT-1').modify({ status: 'received', receivedAt: NOON_IST });
    await db.dayCloses.clear();
    await db.bills.clear(); // no bills yesterday, so no day left unclosed
    await db.grns.toCollection().modify((g) => {
      for (const l of g.lines) {
        l.short = 0;
        l.broken = 0;
      }
    });
    await db.movements.clear(); // no stock, so nothing low, negative or near expiry
    renderOffice();
    expect(await screen.findByText('✓ Nothing needs you today')).toBeInTheDocument();
  }, 30000);
});
