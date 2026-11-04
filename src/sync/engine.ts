import Dexie from 'dexie';
import { db, type OutboxRow } from '../db/db';
import { AuthError, currentDevice, rpc, syncConfig } from './client';
import { SYNCED_TABLES, syncedKvKey, untracked, type SyncOp } from './track';

const CURSOR_KEY = 'sync:cursor';
/** The Background Sync tag the app registers and the service worker answers. */
export const BACKGROUND_SYNC_TAG = 'true-pos-sync';
/** Most outbox rows read per push; a transaction is never split across two pushes. */
const PUSH_ROWS = 400;
const PULL_ROWS = 500;

export interface SyncStatus {
  /** `local`: the demo, or a device not connected yet. Nothing is sent. */
  state: 'local' | 'idle' | 'syncing' | 'error';
  error?: string;
  lastOkAt?: string;
}

let status: SyncStatus = { state: 'local' };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  for (const l of listeners) l();
}

export function syncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface Change {
  id: string;
  at: string;
  ops: SyncOp[];
}

/** The oldest waiting transactions, whole. */
async function nextBatch(): Promise<{ changes: Change[]; rowIds: number[] }> {
  const rows = await db.outbox.where('synced').equals(0).limit(PUSH_ROWS).toArray();
  rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  if (rows.length === PUSH_ROWS) {
    // The last transaction may go on past the limit: leave it for the next push, unless it is all there is.
    const last = rows[rows.length - 1].tx;
    const head = rows.filter((r) => r.tx !== last);
    if (head.length > 0) rows.splice(0, rows.length, ...head);
    else rows.splice(0, rows.length, ...(await db.outbox.where('tx').equals(last).toArray()));
  }
  const byTx = new Map<string, Change>();
  for (const r of rows) {
    const c = byTx.get(r.tx) ?? { id: r.tx, at: r.at, ops: [] };
    c.ops.push(...r.ops);
    byTx.set(r.tx, c);
  }
  return { changes: [...byTx.values()], rowIds: rows.map((r) => r.id as number) };
}

async function push(): Promise<void> {
  for (;;) {
    const { changes, rowIds } = await nextBatch();
    if (changes.length === 0) return;
    await rpc<number>('push_changes', { batch: changes });
    // The cloud has them (a resend is ignored there), so the device can forget them.
    await db.outbox.bulkDelete(rowIds);
  }
}

const keyPaths = new Map(db.tables.map((t) => [t.name, t.schema.primKey.keyPath]));
const keyOf = (tb: string, v: Record<string, unknown>): unknown => Dexie.getByKeyPath(v, keyPaths.get(tb) as string | string[]);
const slot = (tb: string, key: unknown): string => `${tb}|${JSON.stringify(key)}`;

/** Rows this device changed and has not sent yet: a pulled older value must not overwrite them. */
async function pendingSlots(): Promise<Set<string>> {
  const rows: OutboxRow[] = await db.outbox.where('synced').equals(0).toArray();
  const slots = new Set<string>();
  for (const r of rows) {
    for (const op of r.ops) {
      if (op.t === 'put') slots.add(slot(op.tb, keyOf(op.tb, op.v)));
      if (op.t === 'del') slots.add(slot(op.tb, op.k));
    }
  }
  return slots;
}

const SYNCED = new Set<string>(SYNCED_TABLES);

/**
 * Apply pulled changes in cloud order, so every device ends up with the same rows: the last change to reach the
 * cloud wins. A device's own `put`s come back too and are applied again in that order; its own appended rows are
 * already here and are skipped. The cursor moves in the same transaction, so a change is never applied twice.
 */
export async function applyChanges(rows: { seq: number; mine: boolean; ops: SyncOp[] }[]): Promise<void> {
  if (rows.length === 0) return;
  const tables = [...SYNCED_TABLES.map((n) => db.table(n)), db.outbox];
  await db.transaction('rw', tables, async () => {
    untracked();
    const pending = await pendingSlots();
    for (const row of rows) {
      for (const op of row.ops) {
        if (!SYNCED.has(op.tb)) continue;
        const table = db.table(op.tb);
        if (op.t === 'ins') {
          if (!row.mine) await table.add(op.v);
        } else if (op.t === 'put') {
          if (op.tb === 'kv' && !syncedKvKey(op.v.key)) continue;
          if (!pending.has(slot(op.tb, keyOf(op.tb, op.v)))) await table.put(op.v);
        } else if (op.tb !== 'kv' || syncedKvKey(op.k)) {
          if (!pending.has(slot(op.tb, op.k))) await table.delete(op.k as never);
        }
      }
    }
    await db.kv.put({ key: CURSOR_KEY, value: rows[rows.length - 1].seq });
  });
}

async function pull(): Promise<void> {
  for (;;) {
    const since = ((await db.kv.get(CURSOR_KEY))?.value as number | undefined) ?? 0;
    const rows = await rpc<{ seq: number; mine: boolean; ops: SyncOp[] }[]>('pull_changes', { since, lim: PULL_ROWS });
    await applyChanges(rows);
    if (rows.length < PULL_ROWS) return;
  }
}

/** One sync at a time across tabs and the service worker; a tab without Web Locks just runs. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  return locks ? (locks.request('true-pos-sync', fn) as Promise<T>) : fn();
}

let running: Promise<void> | null = null;
let again = false;

async function runOnce(): Promise<void> {
  if (!syncConfig() || !(await currentDevice())) {
    setStatus({ state: 'local' });
    return;
  }
  setStatus({ ...status, state: 'syncing' });
  try {
    await exclusive(async () => {
      await push();
      await pull();
    });
    setStatus({ state: 'idle', lastOkAt: new Date().toISOString() });
  } catch (e) {
    const error = e instanceof AuthError ? e.message : e instanceof Error ? e.message : 'sync_failed';
    setStatus({ ...status, state: 'error', error });
    throw e;
  }
}

/**
 * Send what waits, then fetch what other devices sent. Asked while a sync runs, it runs once more afterwards, so a
 * write made during a sync is not left behind. Rejects when the cloud can't be reached or refuses the device.
 */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}
