import { db } from '../../db/db'
import type { Bill, Payment } from '../../domain/types'
import type { ReceiptLine } from './Receipt'

/** A bill with its lines (named) and payments, as the receipt needs them. */
export async function loadReceipt(number: string): Promise<{ bill: Bill; lines: ReceiptLine[]; payments: Payment[] } | undefined> {
  const [bill, lines, payments] = await Promise.all([
    db.bills.get(number),
    db.billLines.where('billNumber').equals(number).toArray(),
    db.payments.where('billNumber').equals(number).toArray(),
  ])
  if (!bill) return undefined
  const products = await db.products.bulkGet(lines.map((l) => l.productId))
  const named: ReceiptLine[] = lines.map((l, i) => ({ ...l, name: products[i]?.shortName ?? l.productId }))
  return { bill, lines: named, payments }
}
