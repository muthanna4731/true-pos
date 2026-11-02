import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

test('closing the shift locks the day, and the next day opens billing again', async ({ page }) => {
  await openApp(page)

  // The cashier opens a shift and walks away without ending it.
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()

  // The manager is one chain-wide admin: no shift of their own, the shop picker starts on the hub. They count the drawer and close: the day locks.
  await login(page, 'manager')
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Manager' })).toBeVisible()
  await page.getByRole('region', { name: 'Manager' }).getByRole('button', { name: 'Close shift' }).click()
  await expect(page.getByRole('combobox', { name: 'Shop' })).toHaveValue('TSTS1')
  await expect(page.locator('.shift-row')).toHaveCount(1)
  await page.locator('.shift-row').first().click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText("Day locked. Today's figures are final.")).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click() // the manager has no shift, so the session goes on

  // Back on the home, today's report shows locked figures.
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Who is working?' })).toBeVisible()
  await login(page, 'manager')
  await expect(page.getByText('Closed day: locked figures')).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()

  // The cashier of the same shop gets a message, not the pay buttons.
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()
  await page.locator('.top-tiles .tile').first().click()
  await expect(page.getByText('Day closed for today. Ask your manager.')).toBeVisible()
  await expect(page.locator('.pay-buttons .pay-big')).toHaveCount(0)

  // The demo panel moves the clock to the next day: billing works again.
  await page.keyboard.press('Control+Shift+D')
  await page.getByRole('button', { name: 'Next day' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('Day closed for today. Ask your manager.')).toHaveCount(0)
  await expect(page.locator('.pay-buttons .pay-big', { hasText: 'Cash' })).toBeVisible()
})
