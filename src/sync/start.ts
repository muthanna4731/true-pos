import { currentDevice, syncConfig } from './client';
import { BACKGROUND_SYNC_TAG, syncNow } from './engine';
import { onTrackedWrite } from './track';

/** How long after a write to send it: a bill's few writes go together. */
const AFTER_WRITE_MS = 2000;
const EVERY_MS = 60000;

const quiet = (p: Promise<void>): void => {
  p.catch(() => {
    // The badge shows the problem; the next trigger tries again.
  });
};

/** Ask the service worker to sync once the network is back, even with the tab closed (Chrome and Edge only). */
function requestBackgroundSync(): void {
  if (!('serviceWorker' in navigator)) return;
  quiet(
    navigator.serviceWorker.ready.then(async (reg) => {
      const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
      await sync?.register(BACKGROUND_SYNC_TAG);
    }),
  );
}

let stop: (() => void) | null = null;

/**
 * Start syncing when this device is connected: after each write, when the network comes back, when the app comes
 * to the front, and every minute. Nothing happens in the demo or before the device is connected. Safe to call again
 * after connecting.
 */
export async function startSync(): Promise<void> {
  stop?.();
  stop = null;
  const device = syncConfig() ? await currentDevice() : null;
  if (!device) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  onTrackedWrite(() => {
    clearTimeout(timer);
    timer = setTimeout(() => quiet(syncNow()), AFTER_WRITE_MS);
    if (!navigator.onLine) requestBackgroundSync();
  });
  const now = (): void => quiet(syncNow());
  const visible = (): void => {
    if (document.visibilityState === 'visible') now();
  };
  window.addEventListener('online', now);
  document.addEventListener('visibilitychange', visible);
  const every = setInterval(now, EVERY_MS);
  now();

  stop = () => {
    clearTimeout(timer);
    clearInterval(every);
    window.removeEventListener('online', now);
    document.removeEventListener('visibilitychange', visible);
    onTrackedWrite(() => {});
  };
}
