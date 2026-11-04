import { expect, test, type Page } from '@playwright/test'
import { login, openApp, waitForServiceWorkerControl } from './helpers'

// Real cloud round trip. Runs only against a build made with the Supabase settings, and with two test-device
// logins of a test tenant (never the shop's own):
//   E2E_DEVICE_A=email:password E2E_DEVICE_B=email:password npx playwright test cloud
const A = process.env.E2E_DEVICE_A
const B = process.env.E2E_DEVICE_B
test.skip(!A || !B, 'needs E2E_DEVICE_A and E2E_DEVICE_B')

async function connect(page: Page, login: string): Promise<void> {
  const [email, password] = login.split(/:(.*)/s)
  await page.getByRole('button', { name: 'Connect this device' }).click()
  await page.getByLabel('Device email').fill(email)
  await page.getByLabel('Device password').fill(password)
  await page.getByRole('form', { name: 'Connect this device' }).getByRole('button', { name: 'Connect this device' }).click()
  await expect(page.getByText(/^This device: /)).toBeVisible()
}

/** A bill row straight from the page's IndexedDB. */
function billIn(page: Page, number: string): Promise<boolean> {
  return page.evaluate(
    (n) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('true-pos')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('bills').objectStore('bills').get(n)
          get.onsuccess = () => resolve(get.result !== undefined)
          get.onerror = () => reject(get.error)
        }
      }),
    number,
  )
}

test('a bill made offline on one device reaches the cloud when online, and another device gets it', async ({ browser }) => {
  test.setTimeout(240_000)
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  await openApp(a)
  await waitForServiceWorkerControl(a)
  await connect(a, A as string)
  await login(a, 'cashier')
  await expect(a.locator('.top-tiles .tile').first()).toBeVisible()

  await ctxA.setOffline(true)
  await a.locator('.top-tiles .tile').first().click()
  await a.locator('.pay-buttons .pay-big', { hasText: 'Cash' }).click()
  await a.getByRole('button', { name: 'Exact' }).click()
  const receipt = a.getByRole('dialog', { name: 'Receipt' })
  await expect(receipt).toBeVisible()
  const number = (await receipt.locator('.receipt-number').textContent())?.trim() ?? ''
  expect(number).toMatch(/^TSTS1\/\d{2}-\d{2}\/\d+$/) // counter 1 of the test tenant
  const badge = a.locator('.sync-badge')
  await expect(badge).toHaveText('● Offline · 1 bill will sync')

  await ctxA.setOffline(false)
  await expect(badge).toHaveText('● Online', { timeout: 30_000 })
  await expect.poll(() => a.evaluate(() => new Promise<number>((resolve) => {
    const open = indexedDB.open('true-pos')
    open.onsuccess = () => {
      const req = open.result.transaction('outbox').objectStore('outbox').count()
      req.onsuccess = () => resolve(req.result)
    }
  })), { timeout: 30_000 }).toBe(0)

  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  await openApp(b)
  expect(await billIn(b, number)).toBe(false)
  await connect(b, B as string)
  await expect.poll(() => billIn(b, number), { timeout: 60_000 }).toBe(true)

  await ctxA.close()
  await ctxB.close()
})
