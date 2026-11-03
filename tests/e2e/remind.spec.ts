import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

// DEMO.md section 5, step 5: the manager taps Remind on "TS4 did not close yesterday", locks that day, and the to-do clears.
test('Remind opens Close shift on the flagged day, Lock <date> locks it, and the to-do clears', async ({ page }) => {
  await openApp(page)
  await login(page, 'manager')
  const todo = page.getByRole('listitem').filter({ hasText: 'TS4 did not close yesterday' })
  await todo.getByRole('button', { name: 'Remind' }).click()

  await expect(page).toHaveURL(/\/office\/close\?day=\d{4}-\d{2}-\d{2}$/)
  await expect(page.getByRole('combobox', { name: 'Shop' })).toHaveValue('TSTS4')
  await page.getByRole('button', { name: /^Lock \d{1,2} [A-Z][a-z]{2}$/ }).click()
  await expect(page.getByText(/^Day locked\. \d{1,2} [A-Z][a-z]{2}'s figures are final\.$/)).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
  await expect(page.getByText('TS4 did not close yesterday')).toHaveCount(0)
})
