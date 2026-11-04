import { db } from '../db/db';

/**
 * The cloud the device syncs with. Both values are public (the anon key only lets a signed-in device call the two
 * sync functions); without them the app is the local demo and nothing leaves the device.
 */
export interface SyncConfig {
  url: string;
  anonKey: string;
}

let config: SyncConfig | null = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey } : null;
})();

export function syncConfig(): SyncConfig | null {
  return config;
}

/** Tests point the client at a fake cloud, or at none. */
export function setSyncConfig(next: SyncConfig | null): void {
  config = next;
}

/** Who this device is, from its login (set by `scripts/add-device.mts`, never by the device). */
export interface Device {
  id: string;
  email: string;
  tenant: string;
  store: string;
  counter: number;
  label: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** Seconds since the epoch. */
  expiresAt: number;
  device: Device;
}

const SESSION_KEY = 'sync:session';

/** A login or token the cloud refused: the device must be connected again, retrying won't help. */
export class AuthError extends Error {
  constructor(message = 'not_connected') {
    super(message);
    this.name = 'AuthError';
  }
}

interface TokenReply {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  user: { id: string; email?: string; app_metadata?: Record<string, unknown> };
}

function need(): SyncConfig {
  if (!config) throw new Error('sync_not_configured');
  return config;
}

function toSession(r: TokenReply): Session {
  const m = r.user.app_metadata ?? {};
  const tenant = typeof m.tenant === 'string' ? m.tenant : '';
  const store = typeof m.store === 'string' ? m.store : '';
  const counter = typeof m.counter === 'number' ? m.counter : 0;
  if (!tenant || !store || !Number.isInteger(counter) || counter < 1 || counter > 9) throw new AuthError('not_a_device');
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in,
    device: { id: r.user.id, email: r.user.email ?? '', tenant, store, counter, label: typeof m.label === 'string' ? m.label : store },
  };
}

async function token(grant: 'password' | 'refresh_token', body: object): Promise<Session> {
  const { url, anonKey } = need();
  const res = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new AuthError(grant === 'password' ? 'bad_login' : 'not_connected');
  if (!res.ok) throw new Error(`auth_${res.status}`);
  return toSession((await res.json()) as TokenReply);
}

async function save(s: Session | null): Promise<void> {
  if (s) await db.kv.put({ key: SESSION_KEY, value: s });
  else await db.kv.delete(SESSION_KEY);
}

async function load(): Promise<Session | null> {
  const row = await db.kv.get(SESSION_KEY);
  return (row?.value as Session | undefined) ?? null;
}

/** Connect this device with the login made for it. Throws `AuthError('bad_login')` for a wrong email or password. */
export async function connectDevice(email: string, password: string): Promise<Device> {
  const s = await token('password', { email: email.trim(), password });
  await db.transaction('rw', db.kv, db.outbox, async () => {
    await save(s);
    // Anything queued before was made on an unconnected device (demo data): it never goes to the cloud.
    await db.outbox.clear();
  });
  return s.device;
}

export async function disconnectDevice(): Promise<void> {
  await save(null);
}

/** The connected device, or null. Works offline: it reads the saved login. */
export async function currentDevice(): Promise<Device | null> {
  return config ? ((await load())?.device ?? null) : null;
}

let refreshing: Promise<Session> | null = null;

/** A valid access token, refreshed when it has under a minute left. */
async function accessToken(): Promise<string> {
  const s = await load();
  if (!s) throw new AuthError();
  if (s.expiresAt - 60 > Date.now() / 1000) return s.accessToken;
  refreshing ??= token('refresh_token', { refresh_token: s.refreshToken })
    .then(async (next) => {
      await save(next);
      return next;
    })
    .finally(() => {
      refreshing = null;
    });
  return (await refreshing).accessToken;
}

/** Call one of the sync functions in the database. */
export async function rpc<T>(name: 'push_changes' | 'pull_changes', args: object): Promise<T> {
  const { url, anonKey } = need();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (!res.ok) throw new Error(`${name}_${res.status}`);
  return (await res.json()) as T;
}
