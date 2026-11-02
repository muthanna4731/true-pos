import { expect, test } from '@playwright/test'
import { login, openApp, waitForServiceWorkerControl } from './helpers'

test('a bill made with the network off is kept, and the badge follows the network', async ({ page, context }) => {
  await openApp(page)
  await waitForServiceWorkerControl(page)
  await login(page, 'cashier')
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '● Online' })).toBeVisible()

  // Reload with no network: the installed app has to open from its own cache, and the shift carries on.
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.top-tiles .tile').first()).toBeVisible({ timeout: 30_000 })
  const badge = page.locator('.sync-badge')
  await expect(badge).toHaveText('● Offline')

  await page.locator('.top-tiles .tile').first().click()
  await page.locator('.pay-buttons .pay-big', { hasText: 'Cash' }).click()
  await page.getByRole('button', { name: 'Exact' }).click()
  await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
  await expect(badge).toHaveText('● Offline · 1 bill will sync')

  await context.setOffline(false)
  await expect(badge).toHaveText('● Online')
})
