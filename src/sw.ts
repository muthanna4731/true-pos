/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { BACKGROUND_SYNC_TAG, syncNow } from './sync/engine';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// Same behaviour as the generated worker before it: every built file is cached, so the app opens with no network.
void self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

// The browser wakes the worker when the network is back, even with the app closed (Chrome and Edge).
// A rejection makes the browser try again later.
self.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag === BACKGROUND_SYNC_TAG) event.waitUntil(syncNow());
}) as EventListener);
