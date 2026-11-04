import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreTable, type Middleware } from 'dexie';
import { newId } from '../domain/id';

/**
 * Tables that are the same on every device of the chain. Everything else stays on the device: `counters` (each
 * device numbers its own bills), the outbox itself, the loyalty queue and the demo loyalty tables.
 */
export const SYNCED_TABLES = [
  'products', 'prices', 'stores', 'users', 'movements', 'bills', 'billLines', 'payments', 'shifts', 'dayCloses',
  'offers', 'indents', 'grns', 'transfers', 'counts', 'losses', 'claims', 'suppliers', 'supplierPayments', 'kv',
] as const;
const SYNCED = new Set<string>(SYNCED_TABLES);

/** Of `kv`, only the shop practice switches are shared; the clock, the sync session and the cursor are per device. */
export const syncedKvKey = (key: unknown): boolean => typeof key === 'string' && key.startsWith('practice:');

/**
 * One change to a row. `ins` adds a row to an append-only table with a local auto-increment key (stock movements,
 * bill lines...): the key differs per device, so it is left out. `put` and `del` carry the row's own key.
 */
export type SyncOp =
  | { tb: string; t: 'ins'; v: Record<string, unknown> }
  | { tb: string; t: 'put'; v: Record<string, unknown> }
  | { tb: string; t: 'del'; k: unknown };

/** What the transaction marks look like on the IndexedDB transaction object. */
interface TxMarks {
  syncTx?: string;
  syncOff?: boolean;
}

let tracking = true;
let onWrite: () => void = () => {};

/**
 * Record changes in the outbox (on by default). The demo records too, so its badge can count waiting bills; it has no
 * cloud, and connecting a device drops what was queued before. Tests switch it off to check the writes alone.
 */
export function setTracking(on: boolean): void {
  tracking = on;
}

export function isTracking(): boolean {
  return tracking;
}

/** Called after each tracked write (the sync engine uses it to send soon). */
export function onTrackedWrite(fn: () => void): void {
  onWrite = fn;
}

/**
 * Keep the current transaction's writes on this device: practice bills, the demo seed, and changes being applied
 * from the cloud. Call it first thing inside `db.transaction(...)`.
 */
export function untracked(): void {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error('untracked_outside_transaction');
  (tx.idbtrans as unknown as TxMarks).syncOff = true;
}

function stripKey(value: unknown, keyPath: string): Record<string, unknown> {
  const { [keyPath]: _key, ...rest } = value as Record<string, unknown>;
  void _key;
  return rest;
}

function opsOf(name: string, table: DBCoreTable, req: DBCoreMutateRequest): SyncOp[] {
  const pk = table.schema.primaryKey;
  const keep = (v: unknown): boolean => name !== 'kv' || syncedKvKey((v as { key?: unknown }).key);
  if (req.type === 'add' || req.type === 'put') {
    const values = req.values.filter(keep);
    if (pk.autoIncrement) {
      // Only ever appended (see SYNCED_TABLES); an in-place put of such a row has no meaning on another device.
      if (req.type === 'put') return [];
      return values.map((v) => ({ tb: name, t: 'ins' as const, v: stripKey(v, pk.keyPath as string) }));
    }
    return values.map((v) => ({ tb: name, t: 'put' as const, v: v as Record<string, unknown> }));
  }
  if (req.type === 'delete' && !pk.autoIncrement) {
    return req.keys.filter((k) => name !== 'kv' || syncedKvKey(k)).map((k) => ({ tb: name, t: 'del' as const, k }));
  }
  // deleteRange is a table clear: only the demo reset does that, and it is never shared.
  return [];
}

/**
 * Dexie middleware: every write to a synced table also adds an outbox row in the same IndexedDB transaction, so the
 * change and its outbox row commit together or not at all. Rows of one transaction share a `tx` id, and the cloud
 * keeps one change per `tx`.
 */
export const trackChanges: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'true-pos-sync',
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const widen = mode === 'readwrite' && !stores.includes('outbox') && stores.some((s) => SYNCED.has(s));
        return down.transaction(widen ? [...stores, 'outbox'] : stores, mode, options);
      },
      table(name) {
        const table = down.table(name);
        if (!SYNCED.has(name)) return table;
        return {
          ...table,
          async mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
            const res = await table.mutate(req);
            const marks = req.trans as unknown as TxMarks;
            if (!tracking || marks.syncOff || res.numFailures > 0) return res;
            const ops = opsOf(name, table, req);
            if (ops.length === 0) return res;
            marks.syncTx ??= newId();
            await down.table('outbox').mutate({
              type: 'add',
              trans: req.trans,
              values: [{ tx: marks.syncTx, table: name, ops, at: new Date().toISOString(), synced: 0 }],
            });
            onWrite();
            return res;
          },
        };
      },
    };
  },
};
