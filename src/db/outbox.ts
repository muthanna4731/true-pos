import { syncConfig, currentDevice } from '../sync/client';
import { syncNow } from '../sync/engine';
import { db } from './db';

/** Bill writes (new bills and voids) still waiting to reach the cloud: the number on the sync badge. */
export function pendingCount(): Promise<number> {
  return db.outbox.where('synced').equals(0).filter((r) => r.table === 'bills').count();
}

/**
 * Send what waits. A connected device syncs with the cloud (rejecting if that fails). The demo, or a device not
 * connected yet, has no cloud: online just drops what waits, offline does nothing.
 */
export async function flushOutbox(online: boolean): Promise<void> {
  if (!online) return;
  if (syncConfig() && (await currentDevice())) return syncNow();
  await db.outbox.where('synced').equals(0).delete();
}
