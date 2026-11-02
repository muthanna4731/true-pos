import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

test('closing the shift locks the day, and the next day opens billing again', async ({ page }) => {
  await openApp(page)

  // The manager counts the drawer and closes: the day locks.
  await login(page, 'manager')
  await expect(page.getByRole('heading', { name: 'Shop manager' })).toBeVisible()
  await page.getByRole('button', { name: 'Close shift' }).click()
  await page.locator('.shift-row').first().click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText("Day locked. Today's figures are final.")).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click() // closing your own shift ends the session

  // Back in as the manager, today's report shows locked figures.
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
