import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

test('a cashier bills 5 bottles for cash in 7 taps or fewer, in under a minute', async ({ page }) => {
  await openApp(page)
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()

  const tiles = page.locator('.top-tiles .tile')
  expect(await tiles.count()).toBeGreaterThanOrEqual(5)
  // OC 90 is one of the best sellers; put it first, then the next top tiles.
  const oc = page.locator('.top-tiles .tile', { hasText: /OC 90/ }).first()
  await expect(oc).toBeVisible()
  const picked = [oc]
  for (let i = 0; i < (await tiles.count()) && picked.length < 5; i++) {
    const tile = tiles.nth(i)
    if ((await tile.textContent())?.includes('OC 90')) continue
    picked.push(tile)
  }
  expect(picked).toHaveLength(5)

  let taps = 0
  const started = Date.now()
  for (const tile of picked) {
    await tile.click()
    taps++
  }
  await page.locator('.pay-buttons .pay-big', { hasText: 'Cash' }).click()
  taps++
  await page.getByRole('button', { name: 'Exact' }).click()
  taps++

  await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
  await expect(page.locator('.receipt .receipt-number')).toContainText('TSTS1')
  expect(taps).toBeLessThanOrEqual(7)
  expect(Date.now() - started).toBeLessThan(60_000)
})
