import { useSyncExternalStore } from 'react'
import { db } from '../../db/db'
import { currentShift, openShift } from '../../db/shifts'
import { sha256Hex } from '../../domain/hash'
import type { Role, Store, User } from '../../domain/types'
import { requestLoyaltyRefresh } from '../../loyalty/flags'

export interface SessionData {
  user: User | null
  store: Store | null
  counter: number
  shiftId: string | null
  /** The shop the back office is looking at (office and manager). It lives in the session, so every login starts on the hub. */
  workShop: string
}

export interface Session extends SessionData {
  login(userId: string, pin: string): Promise<boolean>
  logout(): void
}

const KEY = 'session'
/** Where office and manager start; the choice then holds from screen to screen until log out. */
export const HUB_SHOP = 'TSTS1'
const EMPTY: SessionData = { user: null, store: null, counter: 1, shiftId: null, workShop: HUB_SHOP }

function load(): SessionData {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return EMPTY
    const data = JSON.parse(raw) as Partial<SessionData>
    return data.user ? { ...EMPTY, ...data } : EMPTY
  } catch {
    return EMPTY
  }
}

let state: SessionData = load()
const listeners = new Set<() => void>()

function setState(next: SessionData): void {
  state = next
  try {
    if (next.user) sessionStorage.setItem(KEY, JSON.stringify(next))
    else sessionStorage.removeItem(KEY)
  } catch {
    // The session just won't survive a reload.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Only a cashier works at one counter of one shop; manager, office and owner see all shops. */
function worksAtCounter(role: Role): boolean {
  return role === 'cashier'
}

/**
 * Check the PIN and start the session. A cashier also gets a shift at their shop, unless they already have one open. Returns false for an unknown user or a wrong PIN.
 */
export async function login(userId: string, pin: string): Promise<boolean> {
  const user = await db.users.get(userId)
  if (!user || user.pinHash !== sha256Hex(`${user.id}:${pin}`)) return false

  let store: Store | null = null
  let shiftId: string | null = null
  if (worksAtCounter(user.role) && user.storeCodes[0]) {
    store = (await db.stores.get(user.storeCodes[0])) ?? null
    if (store) {
      const code = store.code
      shiftId = await db.transaction('rw', db.shifts, async () => {
        const open = await currentShift(code, user.id)
        return open ? open.id : openShift(code, user.id)
      })
    }
  }
  // The PIN hash has done its job; it doesn't need to sit in sessionStorage.
  setState({ user: { ...user, pinHash: '' }, store, counter: 1, shiftId, workShop: HUB_SHOP })
  requestLoyaltyRefresh()
  return true
}

export function logout(): void {
  setState(EMPTY)
}

/** Choose the shop the back office shows. */
export function setWorkShop(code: string): void {
  if (state.user && state.workShop !== code) setState({ ...state, workShop: code })
}

export function useSession(): Session {
  const data = useSyncExternalStore(subscribe, () => state)
  return { ...data, login, logout }
}
