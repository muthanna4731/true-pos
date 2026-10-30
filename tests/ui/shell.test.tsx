import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedGate } from '../../src/App';
import { db, resetDb } from '../../src/db/db';
import { clock } from '../../src/domain/time';
import kn from '../../src/i18n/kn.json';
import { getLang, setLang } from '../../src/i18n';
import { AppRoutes } from '../../src/routes';
import { loadSeedIfEmpty } from '../../src/seed/load';
import { closeDemoPanel } from '../../src/ui/shell/demoPanelState';
import { login, logout } from '../../src/ui/shell/session';
import { useScanner } from '../../src/ui/shell/useScanner';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const scans: string[] = [];
function ScanProbe() {
  useScanner((code) => scans.push(code));
  return null;
}

function renderAt(path: string) {
  return render(
    <SeedGate seed={{ days: 3 }}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Where />
        <ScanProbe />
      </MemoryRouter>
    </SeedGate>,
  );
}

const where = () => screen.getByTestId('where').textContent;

async function loginAs(user: ReturnType<typeof userEvent.setup>, tile: RegExp, pin: string) {
  await user.click(await screen.findByRole('button', { name: tile }));
  for (const digit of pin) await user.click(screen.getByRole('button', { name: digit }));
}

beforeAll(async () => {
  await resetDb();
  await loadSeedIfEmpty(db, { days: 3 });
});

beforeEach(async () => {
  scans.length = 0;
  sessionStorage.clear();
  logout();
  await db.kv.clear();
  await db.shifts.filter((s) => s.closedAt === undefined).delete();
});

afterEach(() => {
  closeDemoPanel();
  setLang('en');
  localStorage.clear();
  clock.setOffsetDays(0);
});

describe('loading', () => {
  it('shows "Loading shop…" until the seed is in, then the login screen', async () => {
    renderAt('/login');
    expect(screen.getByText('Loading shop…')).toBeInTheDocument();
    expect(await screen.findByText('Who is working?')).toBeInTheDocument();
  });
});

describe('login', () => {
  it('lands the cashier on /bill after PIN 1111', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    expect(screen.getByRole('heading', { name: 'Bill' })).toBeInTheDocument();
  });

  it('shows "Wrong PIN" and stays on /login for a wrong PIN', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '9999');
    expect(await screen.findByText('Wrong PIN')).toBeInTheDocument();
    expect(where()).toBe('/login');
  });

  it('shows only one shop\'s people when a store is preselected', async () => {
    renderAt('/login?store=TSTS2');
    expect(await screen.findByRole('button', { name: /^Cashier 2 / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cashier 3 / })).not.toBeInTheDocument();
  });

  it('lists the demo PINs under "Demo"', async () => {
    renderAt('/login');
    const demo = await screen.findByText('Demo');
    expect(demo.parentElement).toHaveTextContent('1111');
    expect(demo.parentElement).toHaveTextContent('4444');
  });

  it('sends each role to its home', async () => {
    const homes: [RegExp, string, string][] = [
      [/^Manager 1 /, '2222', '/manager'],
      [/^Office /, '3333', '/office'],
      [/^Owner /, '4444', '/owner'],
    ];
    for (const [tile, pin, home] of homes) {
      const user = userEvent.setup();
      const view = renderAt('/login');
      await loginAs(user, tile, pin);
      await waitFor(() => expect(where()).toBe(home));
      view.unmount();
      logout();
    }
  });

  it('opens one shift for a cashier, and reuses it on the next login', async () => {
    const user = userEvent.setup();
    const first = renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    first.unmount();
    logout();

    const second = renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    second.unmount();

    const open = await db.shifts.filter((s) => s.cashierId === 'U-C01' && s.closedAt === undefined).toArray();
    expect(open).toHaveLength(1);
    expect(open[0].storeCode).toBe('TSTS1');
    expect(open[0].floatPaise).toBe(200000);
  });

  it('opens no shift for office or owner', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Office /, '3333');
    await waitFor(() => expect(where()).toBe('/office'));
    expect(await db.shifts.filter((s) => s.cashierId === 'U-OFFICE').count()).toBe(0);
  });

  it('keeps the session in sessionStorage across a reload', async () => {
    const user = userEvent.setup();
    const first = renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    first.unmount();
    expect(sessionStorage.getItem('session')).toContain('U-C01');
    expect(sessionStorage.getItem('session')).not.toMatch(/pinHash":"[0-9a-f]/);

    renderAt('/login');
    await waitFor(() => expect(where()).toBe('/bill'));
  });
});

describe('roles', () => {
  it('shows the cashier no Office links', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('sends a cashier who opens /office back to the bill screen', async () => {
    await login('U-C01', '1111');
    renderAt('/office');
    await waitFor(() => expect(where()).toBe('/bill'));
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });

  it('shows Office its links', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Office /, '3333');
    expect(await screen.findByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
  });

  it('sends a logged-out visitor to /login', async () => {
    renderAt('/owner');
    await waitFor(() => expect(where()).toBe('/login'));
  });

  it('logs out from the header', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Owner /, '4444');
    await waitFor(() => expect(where()).toBe('/owner'));
    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(where()).toBe('/login'));
  });

  it('puts the language toggle and the sync badge on every role screen', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Manager 1 /, '2222');
    await waitFor(() => expect(where()).toBe('/manager'));
    expect(screen.getByRole('button', { name: 'ಕನ್ನಡ / EN' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('● Online');
  });
});

describe('language toggle', () => {
  it('switches the screen to Kannada and back, and remembers the choice', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await screen.findByText('Who is working?');
    await user.click(screen.getByRole('button', { name: 'ಕನ್ನಡ / EN' }));

    expect(screen.getByText(kn['login.pickUser'])).toBeInTheDocument();
    expect(screen.queryByText('Who is working?')).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('kn');
    expect(localStorage.getItem('lang')).toBe('kn');
    expect(getLang()).toBe('kn');

    await user.click(screen.getByRole('button', { name: 'ಕನ್ನಡ / EN' }));
    expect(screen.getByText('Who is working?')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');
  });
});

describe('sync badge', () => {
  async function badgeAtOwnerScreen() {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Owner /, '4444');
    await waitFor(() => expect(where()).toBe('/owner'));
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.outbox.clear();
  });

  it('shows how many bills wait while offline, and sends them when back online', async () => {
    await badgeAtOwnerScreen();
    expect(screen.getByRole('status')).toHaveTextContent('● Online');

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await db.outbox.add({ kind: 'bill', ref: 'B1', at: clock.now(), synced: 0 });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('● Offline · 1 bill will sync'));
    await db.outbox.add({ kind: 'bill', ref: 'B2', at: clock.now(), synced: 0 });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('● Offline · 2 bills will sync'));

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('● Online'));
    await waitFor(async () => expect(await db.outbox.where('synced').equals(0).count()).toBe(0));
  });
});

describe('demo panel', () => {
  async function openWithKeys() {
    renderAt('/login');
    await screen.findByText('Who is working?');
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    return screen.findByRole('dialog', { name: 'Demo panel' });
  }

  it('is hidden until Ctrl+Shift+D', async () => {
    renderAt('/login');
    await screen.findByText('Who is working?');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Demo panel' })).toBeInTheDocument();
  });

  it('opens with three taps on the logo, but not with two', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await screen.findByText('Who is working?');
    const logo = screen.getAllByText('True POS')[0];
    await user.click(logo);
    await user.click(logo);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(logo);
    expect(await screen.findByRole('dialog', { name: 'Demo panel' })).toBeInTheDocument();
  });

  it('flips the loyalty switch in kv.loyalty as { key, value: boolean }', async () => {
    const user = userEvent.setup();
    const panel = await openWithKeys();
    await user.click(within(panel).getByRole('button', { name: 'Loyalty ON' }));
    await waitFor(async () => expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: true }));
    expect(within(panel).getByRole('button', { name: 'Loyalty ON' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(panel).getByRole('button', { name: 'Loyalty OFF' }));
    await waitFor(async () => expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: false }));
  });

  it('lists the top 12 barcodes and 3 member codes, and a click scans one', async () => {
    const user = userEvent.setup();
    const panel = await openWithKeys();
    const group = within(panel).getByRole('group', { name: 'Simulate a scan' });
    await waitFor(() => expect(within(group).getAllByRole('button')).toHaveLength(15), { timeout: 5000 });

    await user.click(within(group).getByRole('button', { name: /Ravi/ }));
    expect(scans).toEqual(['TS1:7K3M9QX2RA']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    const again = within(await screen.findByRole('dialog')).getByRole('group', { name: 'Simulate a scan' });
    await waitFor(() => expect(within(again).getAllByRole('button')).toHaveLength(15), { timeout: 5000 });
    const bottle = within(again).getAllByRole('button')[3];
    const barcode = bottle.textContent!.split(' ').at(-1)!;
    await user.click(bottle);
    expect(scans.at(-1)).toBe(barcode);
    expect(barcode).toMatch(/^\d{8,}$/);
  });

  it('moves the demo clock forward a day and remembers it', async () => {
    const user = userEvent.setup();
    const panel = await openWithKeys();
    const before = clock.now();
    await user.click(within(panel).getByRole('button', { name: 'Next day' }));
    await waitFor(() => expect(Date.parse(clock.now()) - Date.parse(before)).toBeGreaterThanOrEqual(86400000));
    expect((await db.kv.get('clockOffsetDays'))?.value).toBe(1);
  });

  it('resets the demo data, logs out and goes to /login', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await loginAs(user, /^Cashier 1 /, '1111');
    await waitFor(() => expect(where()).toBe('/bill'));
    await db.kv.put({ key: 'loyalty', value: true });
    await db.bills.clear();

    fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });
    const panel = await screen.findByRole('dialog', { name: 'Demo panel' });
    await user.click(within(panel).getByRole('button', { name: 'Reset demo data' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 20000 });
    expect(where()).toBe('/login');
    expect(await db.bills.count()).toBeGreaterThan(0);
    expect(await db.kv.get('loyalty')).toBeUndefined();
  }, 30000);
});
