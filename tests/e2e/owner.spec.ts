import { expect, test } from '@playwright/test'
import { login, openApp } from './helpers'

// The owner's own app: a centred phone column on a laptop, live figures from the till, tabs, shop picker, day / night.
test('the owner sees a bill from the till in a centred phone column, and moves around the app', async ({ page }) => {
  await openApp(page)

  // The cashier rings one bottle for cash and logs out.
  await login(page, 'cashier')
  await page.locator('.top-tiles .tile').first().click()
  await page.locator('.pay-buttons .pay-big', { hasText: 'Cash' }).click()
  await page.getByRole('button', { name: 'Exact' }).click()
  await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Receipt' }).click()
  await page.getByRole('button', { name: 'Log out' }).click()

  await login(page, 'owner')
  await expect(page.getByLabel('Sales today')).toBeVisible()
  await expect(page.getByText(/^live · \d+[smhd]$/)).toBeVisible()

  // The amber pour orbits the live card's border, and stops for a reader who asks for less motion.
  const pour = () => page.locator('.ow-live').evaluate((el) => getComputedStyle(el, '::before').animationName)
  expect(await pour()).not.toBe('none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await pour()).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // The sync badge sits in the header.
  await expect(page.getByRole('status')).toContainText('Online')

  // A phone column, about 392 to 420 px wide, centred on the laptop screen.
  const col = await page.locator('.ow-col').boundingBox()
  expect(col!.width).toBeGreaterThanOrEqual(392)
  expect(col!.width).toBeLessThanOrEqual(420)
  expect(Math.abs(col!.x + col!.width / 2 - 640)).toBeLessThan(2)

  // The tabs, each a link of at least 44 px.
  const nav = page.getByRole('navigation', { name: 'Owner menu' })
  for (const tab of ['Today', 'Stock', 'Sales', 'More']) {
    const box = await nav.getByRole('link', { name: tab }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await nav.getByRole('link', { name: 'Sales' }).click()
  await expect(page.getByText('Every bill, live')).toBeVisible()
  await expect(page.locator('.ow-bill').first()).toBeVisible()

  // The shop picker: the cashier's shop shows its own bill.
  await page.getByRole('button', { name: /Choose a shop/ }).click()
  await page.getByRole('dialog', { name: 'Choose a shop' }).getByRole('button', { name: 'True Spirits 1' }).click()
  await expect(page.getByRole('button', { name: /True Spirits 1/ })).toBeVisible()

  await nav.getByRole('link', { name: 'Stock' }).click()
  await expect(page.getByText('Needs attention')).toBeVisible()

  // More: a report screen with a way back, then day / night.
  await nav.getByRole('link', { name: 'More' }).click()
  await page.getByRole('link', { name: /Purchases/ }).click()
  await expect(page.getByText('Top suppliers')).toBeVisible()
  await page.getByRole('link', { name: 'Back to More' }).click()
  await page.getByRole('button', { name: 'Night' }).click()
  await expect(page.locator('.owner-app')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Who is working?' })).toBeVisible()
})
