import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('gives each item an icon and a visible label, and the label as its accessible name', () => {
    renderAt('/office', 'office');
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link).toHaveAttribute('aria-label', 'Orders');
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

  it('collapses to icons and remembers it', async () => {
    localStorage.removeItem('navCollapsed');
    renderAt('/office', 'office');
    const toggle = screen.getByRole('button', { name: 'Collapse menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getByRole('navigation', { name: 'Menu' })).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('navCollapsed')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(localStorage.getItem('navCollapsed')).toBe('0');
  });

  it.each(['cashier', 'owner'] as const)('renders nothing for a %s', (role) => {
    renderAt('/office', role);
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
