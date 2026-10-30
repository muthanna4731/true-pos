import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportTable from '../../src/ui/common/ReportTable'
import { printAs } from '../../src/ui/common/print'

const columns = [
  { key: 'name', label: 'Product' },
  { key: 'on', label: 'Date', kind: 'date' as const },
  { key: 'qty', label: 'Qty', kind: 'number' as const },
  { key: 'amount', label: 'Amount', kind: 'money' as const },
  { key: 'litres', label: 'Litres', kind: 'litres' as const },
]
const rows = [
  { name: 'Hay, 90', on: '2026-03-31T18:30:00Z', qty: 1234, amount: 17727, litres: 16.11 },
  { name: 'Water', on: '2026-08-12', qty: 2, amount: 100000, litres: 2 },
]
const asOf = { now: '2026-08-12T09:01:00Z' }

let blobs: Blob[] = []
beforeEach(() => {
  blobs = []
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b)
    return 'blob:x'
  })
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

describe('ReportTable', () => {
  it('shows the title, the as-of stamp, IST dates and formatted figures', () => {
    render(<ReportTable title="Daily sheet" columns={columns} rows={rows} asOf={asOf} totals={{ name: 'Total', qty: 1236 }} />)
    expect(screen.getByRole('heading', { name: 'Daily sheet' })).toBeInTheDocument()
    expect(screen.getByText('as of 2:31 PM')).toBeInTheDocument()
    expect(screen.getByText('1 Apr 2026')).toBeInTheDocument() // 31 Mar 18:30 UTC is 1 April in IST
    expect(screen.getByText('12 Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('₹177.27')).toBeInTheDocument()
    expect(screen.getByText('₹1,000')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('16.11')).toBeInTheDocument()
    const foot = screen.getAllByRole('row').at(-1)!
    expect(within(foot).getByText('Total')).toBeInTheDocument()
  })

  it('says a closed day shows locked figures', () => {
    render(<ReportTable title="T" columns={columns} rows={[]} asOf={{ now: asOf.now, dayClose: { lockedAt: asOf.now } }} />)
    expect(screen.getByText('Closed day: locked figures')).toBeInTheDocument()
  })

  it('downloads a CSV that starts with the column labels, after a UTF-8 BOM, with IST dates and rupee amounts', async () => {
    const user = userEvent.setup()
    render(<ReportTable title="Daily sheet" columns={columns} rows={rows} asOf={asOf} />)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(click).toHaveBeenCalledTimes(1)
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text.startsWith('﻿Product,Date,Qty,Amount,Litres\r\n')).toBe(true)
    expect(text).toContain('"Hay, 90",1 Apr 2026,1234,177.27,16.11')
    expect(text).toContain('Water,12 Aug 2026,2,1000,2')
  })

  it('prints through the report mode', async () => {
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.documentElement.classList.contains('print-report')).toBe(true)
    })
    render(<ReportTable title="Daily sheet" columns={columns} rows={rows} asOf={asOf} />)
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
  })
})

describe('printAs', () => {
  it('sets the mode class and page size while printing, and clears both on afterprint', () => {
    const seen: string[] = []
    vi.spyOn(window, 'print').mockImplementation(() => {
      seen.push(document.documentElement.className, document.head.querySelector('style[data-print-page]')?.textContent ?? '')
    })
    printAs('receipt')
    expect(seen[0]).toContain('print-receipt')
    expect(seen[1]).toMatch(/size:\s*80mm 200mm/)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.documentElement.classList.contains('print-receipt')).toBe(false)
    expect(document.head.querySelector('style[data-print-page]')).toBeNull()

    printAs('report')
    expect(seen[2]).toContain('print-report')
    expect(seen[3]).toMatch(/size:\s*A4 portrait/)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.documentElement.className).not.toContain('print-')
  })
})
