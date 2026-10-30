import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { getLoyaltyClient } from './client';

const REREAD_MS = 5 * 60 * 1000;

/**
 * The switch: what the server just said wins, then the last saved value, and with neither loyalty is off.
 * Writers of `kv.loyalty` use `{ key: 'loyalty', value: true | false }` and readers test `value === true`.
 */
export function resolveLoyalty(fetched: boolean | undefined, cached: boolean | undefined): boolean {
  return fetched ?? cached ?? false;
}

/** Ask the client for the switch. `undefined` when there is no client or the call fails. */
async function fetchLoyaltyFlag(): Promise<boolean | undefined> {
  const client = getLoyaltyClient();
  if (!client) return undefined;
  try {
    return (await client.flags()).loyalty === true;
  } catch {
    return undefined;
  }
}

const refreshers = new Set<() => Promise<void>>();

/** Re-read the switch now (after login, at shift start, or when the demo panel flips it). */
export function requestLoyaltyRefresh(): void {
  for (const refresh of refreshers) void refresh();
}

/**
 * Is loyalty on. Re-reads when it mounts, on `requestLoyaltyRefresh()` and every 5 minutes,
 * and saves what it read in `kv.loyalty` for when the POS is offline.
 */
export function useLoyaltyFlag(): boolean {
  const [fetched, setFetched] = useState<boolean | undefined>(undefined);
  const row = useLiveQuery(async () => (await db.kv.get('loyalty')) ?? null, []);
  const cached = row ? row.value === true : undefined;

  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      const value = await fetchLoyaltyFlag();
      if (!alive) return;
      setFetched(value);
      if (value === undefined) return;
      try {
        if ((await db.kv.get('loyalty'))?.value !== value) await db.kv.put({ key: 'loyalty', value });
      } catch {
        // The saved copy is only a fallback; the value just read still applies.
      }
    };
    refreshers.add(refresh);
    void refresh();
    const timer = setInterval(() => void refresh(), REREAD_MS);
    return () => {
      alive = false;
      refreshers.delete(refresh);
      clearInterval(timer);
    };
  }, []);

  return resolveLoyalty(fetched, cached);
}
