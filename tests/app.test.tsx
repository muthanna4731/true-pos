import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
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
})
