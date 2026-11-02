import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SideNav from '../../src/ui/shell/SideNav';

const renderAt = (path: string, role: 'office' | 'manager' | 'cashier' | 'owner') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SideNav role={role} />
    </MemoryRouter>,
  );

const names = (): string[] => within(screen.getByRole('navigation', { name: 'Menu' })).getAllByRole('link').map((a) => a.getAttribute('aria-label') ?? '');
const current = (): string[] => screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('aria-label') ?? '');

describe('SideNav', () => {
  it('shows Office the shared pages in order, and none of the manager ones', () => {
    renderAt('/office', 'office');
    expect(names()).toEqual(['Home', 'Orders', 'Deliveries', 'Stock arrived', 'Count shelf', 'Transfers', 'Stock', 'Losses', 'Suppliers', 'Products', 'Reports']);
  });

  it('adds the manager pages for a manager, after the shared ones', () => {
    renderAt('/office', 'manager');
    expect(names().slice(0, 11)).toEqual(['Home', 'Orders', 'Deliveries', 'Stock arrived', 'Count shelf', 'Transfers', 'Stock', 'Losses', 'Suppliers', 'Products', 'Reports']);
    expect(names().slice(11)).toEqual(['Bills', 'Close shift', 'Offers', 'Shops & staff']);
  });

  it('gives each item an icon and a visible label, and the label as its title', () => {
    renderAt('/office', 'office');
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link).toHaveAttribute('title', 'Orders');
    expect(within(link).getByText('Orders')).toBeInTheDocument();
  });

  it('marks only Home as current on the home, and the page for any route below it', () => {
    renderAt('/office', 'manager');
    expect(current()).toEqual(['Home']);
  });

  it.each([
    ['/office/reports', 'Reports'],
    ['/office/orders/42', 'Orders'],
    ['/office/close', 'Close shift'],
  ])('marks %s as %s only', (path, label) => {
    renderAt(path, 'manager');
    expect(current()).toEqual([label]);
  });

  it.each(['cashier', 'owner'] as const)('renders nothing for a %s', (role) => {
    renderAt('/office', role);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
