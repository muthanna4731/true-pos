import { expect, type Page } from '@playwright/test'

export type DemoRole = 'cashier' | 'manager' | 'office' | 'owner'

const PINS: Record<DemoRole, string> = { cashier: '1111', manager: '2222', office: '3333', owner: '4444' }

/** The very first visit seeds about 37,000 bills, so it gets a generous wait. */
export const FIRST_LOAD_MS = 90_000

/** Open the app and wait for the real login screen (not a fixed sleep). Returns ms from navigation to ready. */
export async function openApp(page: Page): Promise<number> {
  const started = Date.now()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Who is working?' })).toBeVisible({ timeout: FIRST_LOAD_MS })
  return Date.now() - started
}

/** Pick the first person of the role and type their PIN on the pad. Returns once the pad has been used. */
export async function login(page: Page, role: DemoRole): Promise<void> {
  await page.locator(`.user-tile.role-${role}`).first().click()
  for (const digit of PINS[role]) await page.locator('.pin-key', { hasText: new RegExp(`^${digit}$`) }).click()
}

/** The service worker is installed, active and controlling this page: only then can a reload work offline. */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  // A page loaded before the worker took over has no controller; autoUpdate claims clients, but wait for it.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true)
}
