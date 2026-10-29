import { db } from './db';

export function pendingCount(): Promise<number> {
  return db.outbox.where('synced').equals(0).count();
}

/** The demo has no server: online just marks everything sent, offline does nothing. */
export async function flushOutbox(online: boolean): Promise<void> {
  if (!online) return;
  await db.outbox.where('synced').equals(0).modify({ synced: 1 });
}
