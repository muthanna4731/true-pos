import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../src/db/db'
import { SeedGate } from '../src/App'
import { AppRoutes } from '../src/routes'

describe('App', () => {
  it('shows the product name on the login screen', async () => {
    render(
      <SeedGate seed={{ days: 3 }}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </SeedGate>,
    )
    expect(screen.getByText('Loading shop…')).toBeInTheDocument()
    expect(await screen.findByText('Who is working?', {}, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getAllByText('True POS').length).toBeGreaterThan(0)
  }, 20000)

  it('offers Retry when the shop data cannot be loaded', async () => {
    vi.spyOn(db.stores, 'count').mockRejectedValueOnce(new Error('blocked'))
    render(
      <SeedGate seed={{ days: 3 }}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </SeedGate>,
    )
    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 15000 })
    expect(screen.getByText(/could not be opened/)).toBeInTheDocument()
    await userEvent.setup().click(retry)
    expect(await screen.findByText('Who is working?', {}, { timeout: 15000 })).toBeInTheDocument()
    vi.restoreAllMocks()
  }, 40000)
})
