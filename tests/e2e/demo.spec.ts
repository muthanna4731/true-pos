import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

// Follows DEMO.md steps 1, 2 and 4 in order: the cashier bills and logs out (the shift stays open),
// then the manager has to close both shifts before the day locks.
test('the demo script locks the day: cashier bills and logs out, manager closes both shifts', async ({ page }) => {
  await openApp(page)

  // Steps 1-2: the cashier bills a bottle for cash, then logs out without ending the shift.
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()
  await page.locator('.top-tiles .tile').first().click()
  await page.locator('.pay-buttons .pay-big', { hasText: 'Cash' }).click()
  await page.getByRole('button', { name: 'Exact' }).click()
  await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Receipt' }).click() // tap the slip to close it
  await page.getByRole('button', { name: 'Log out' }).click()

  // Step 4: the manager sees two open shifts. Closing the cashier's does not lock the day.
  await login(page, 'manager')
  await page.getByRole('button', { name: 'Close shift' }).click()
  await expect(page.locator('.shift-row')).toHaveCount(2)
  await page.locator('.shift-row', { hasText: 'Cashier 1' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText('Shift closed')).toBeVisible()
  await expect(page.getByText("Day locked. Today's figures are final.")).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()

  // Their own shift is the last one open: closing it locks the day.
  await expect(page.locator('.shift-row')).toHaveCount(1)
  await page.locator('.shift-row').click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByText("Day locked. Today's figures are final.")).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // Step 4.4-4.5: manager's figures are locked, the cashier gets the day-closed message.
  await expect(page.getByRole('heading', { name: 'Who is working?' })).toBeVisible()
  await login(page, 'manager')
  await expect(page.getByText('Closed day: locked figures')).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()
  await page.locator('.top-tiles .tile').first().click()
  await expect(page.getByText('Day closed for today. Ask your manager.')).toBeVisible()
  await expect(page.locator('.pay-buttons .pay-big')).toHaveCount(0)
})
