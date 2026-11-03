import { db } from '../../db/db'
import { istDayRange } from '../../db/dayData'
import { priceRowsInForce } from '../../domain/prices'
import { discountsReport, exciseLitreStatement, valuation } from '../../domain/reports'
import { istDayStart } from '../../domain/time'
import { t } from '../../i18n'
import { downloadCsv, type Column } from '../common/ReportTable'

/* The owner's CSV downloads. Each one reads what it needs for the IST `day` (the month so far, for the month reports). */

const monthStartOf = (day: string): string => `${day.slice(0, 8)}01`

async function priced(day: string) {
  return priceRowsInForce(await db.prices.toArray(), day)
}

const nameMap = (products: { id: string; shortName: string; description: string }[]) => new Map(products.map((p) => [p.id, p.shortName || p.description]))

/** Excise statement (opening, received, issued, closing in bottles, litres and rupees), every shop, the month so far. */
export async function downloadExcise(day: string): Promise<void> {
  const [stores, products, movements, prices] = await Promise.all([db.stores.toArray(), db.products.toArray(), db.movements.toArray(), priced(day)])
  const name = nameMap(products)
  const purchase = (id: string) => prices.get(id)?.purchase ?? 0
  const qla = (k: string, label: string): Column[] => [
    { key: `${k}Q`, label: `${label} ${t('del.qty')}`, kind: 'number' },
    { key: `${k}L`, label: `${label} ${t('rep.litres')}`, kind: 'litres' },
    { key: `${k}A`, label: `${label} ₹`, kind: 'money' },
  ]
  const out = stores.flatMap((s) =>
    exciseLitreStatement(movements, products, purchase, s.code, monthStartOf(day), day).map((r) => ({
      shop: s.name,
      product: name.get(r.productId) ?? r.productId,
      ...Object.fromEntries((['opening', 'received', 'issued', 'closing'] as const).flatMap((k) => [[`${k}Q`, r[k].qty], [`${k}L`, r[k].litres], [`${k}A`, r[k].amount]])),
    })),
  )
  downloadCsv(t('rep.exciseTitle'), [{ key: 'shop', label: t('owner.shop') }, { key: 'product', label: t('del.product') }, ...qla('opening', t('office.opening')), ...qla('received', t('office.received')), ...qla('issued', t('office.issued')), ...qla('closing', t('office.closing'))], out)
}

/** Stock valuation at landed cost, every shop, for the day. */
export async function downloadValuation(day: string): Promise<void> {
  const [stores, products, movements, prices] = await Promise.all([db.stores.toArray(), db.products.toArray(), db.movements.toArray(), priced(day)])
  const name = nameMap(products)
  const landed = (id: string) => (prices.get(id)?.purchase ?? 0) + (prices.get(id)?.aroed ?? 0)
  const mrp = (id: string) => prices.get(id)?.mrp ?? 0
  const out = stores.flatMap((s) => valuation(movements, products, landed, mrp, s.code, day).map((r) => ({ ...r, shop: s.name, product: name.get(r.productId) ?? r.productId })))
  downloadCsv(
    t('rep.valuationTitle'),
    [
      { key: 'shop', label: t('owner.shop') },
      { key: 'product', label: t('del.product') },
      { key: 'opening', label: t('office.opening'), kind: 'number' },
      { key: 'openingValue', label: `${t('office.opening')} ₹`, kind: 'money' },
      { key: 'returns', label: t('owner.returns'), kind: 'number' },
      { key: 'returnsValue', label: `${t('owner.returns')} ₹`, kind: 'money' },
      { key: 'sales', label: t('stock.sales'), kind: 'number' },
      { key: 'salesCost', label: `${t('stock.sales')} ₹`, kind: 'money' },
      { key: 'closing', label: t('office.closing'), kind: 'number' },
      { key: 'closingValue', label: `${t('office.closing')} ₹`, kind: 'money' },
      { key: 'mrpAmount', label: t('owner.mrpAmount'), kind: 'money' },
    ],
    out,
  )
}

/** The month's bills of every shop. */
async function monthBills(day: string) {
  const from = istDayStart(monthStartOf(day))
  const to = istDayRange(day)[1]
  const stores = await db.stores.toArray()
  return (await Promise.all(stores.map((s) => db.bills.where('[storeCode+at]').between([s.code, from], [s.code, to], true, false).toArray()))).flat()
}

/** Bill lines that carried an offer, with the discount each gave, the month so far. */
export async function downloadDiscounts(day: string): Promise<void> {
  const bills = await monthBills(day)
  const [products, offers, lines] = await Promise.all([db.products.toArray(), db.offers.toArray(), db.billLines.where('billNumber').anyOf(bills.map((b) => b.number)).toArray()])
  downloadCsv(
    t('owner.discountsTitle'),
    [
      { key: 'brand', label: t('owner.brand') },
      { key: 'offerCode', label: t('owner.offer') },
      { key: 'product', label: t('del.product') },
      { key: 'billNumber', label: t('owner.bill') },
      { key: 'qty', label: t('del.qty'), kind: 'number' },
      { key: 'freeQty', label: t('owner.freeBottles'), kind: 'number' },
      { key: 'discount', label: t('owner.discount'), kind: 'money' },
    ],
    discountsReport(lines, bills, offers, products, monthStartOf(day), day),
  )
}

/** Every paid bill of the month so far, one row each. */
export async function downloadInvoices(day: string): Promise<void> {
  const [bills, stores] = await Promise.all([monthBills(day), db.stores.toArray()])
  const shop = new Map(stores.map((s) => [s.code, s.name]))
  const rows = bills
    .filter((b) => b.status === 'paid')
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((b) => ({ number: b.number, at: b.at, shop: shop.get(b.storeCode) ?? b.storeCode, counter: b.counter, gross: b.gross, discount: b.discount, net: b.net }))
  downloadCsv(
    t('ow.invoiceTitle'),
    [
      { key: 'number', label: t('ow.billNo') },
      { key: 'at', label: t('ow.when'), kind: 'date' },
      { key: 'shop', label: t('owner.shop') },
      { key: 'counter', label: t('ow.counterLabel'), kind: 'number' },
      { key: 'gross', label: t('ow.gross'), kind: 'money' },
      { key: 'discount', label: t('owner.discount'), kind: 'money' },
      { key: 'net', label: t('ow.netLabel'), kind: 'money' },
    ],
    rows,
  )
}

/** Every product with the MRP in force on the day. */
export async function downloadPriceList(day: string): Promise<void> {
  const [products, prices] = await Promise.all([db.products.toArray(), priced(day)])
  const rows = products.map((p) => ({ product: p.description, shortName: p.shortName, mrp: prices.get(p.id)?.mrp ?? 0 }))
  downloadCsv(t('ow.priceTitle'), [{ key: 'product', label: t('del.product') }, { key: 'shortName', label: t('prod.shortName') }, { key: 'mrp', label: t('ow.mrpLabel'), kind: 'money' }], rows)
}

/** Closing stock at MRP for the stock tab's [Export]: the valuation file. */
export const downloadStock = downloadValuation
