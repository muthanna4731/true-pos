// Nightly backup of the True POS change log (Supabase free plan has no backups) into Workers KV.
// Each run copies the changes after the saved cursor, 1,000 per gzipped JSON file, keyed by their seq range.
// The daily read also keeps the free Supabase project from pausing after 7 idle days.

interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: ArrayBuffer | string): Promise<void>;
}

interface Env {
  BACKUP: KV;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const PAGE = 1000;
/** KV allows 1,000 writes a day on the free plan; a night's run stays far below. */
const MAX_PAGES = 50;

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function backup(env: Env): Promise<number> {
  let cursor = Number((await env.BACKUP.get('cursor')) ?? 0);
  let copied = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/changes?seq=gt.${cursor}&order=seq&limit=${PAGE}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new Error(`changes ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as { seq: number }[];
    if (rows.length === 0) break;
    const first = rows[0].seq;
    const last = rows[rows.length - 1].seq;
    await env.BACKUP.put(`changes/${String(first).padStart(12, '0')}-${String(last).padStart(12, '0')}.json.gz`, await gzip(JSON.stringify(rows)));
    // Only after the file is stored: a failed run starts again from the same place.
    await env.BACKUP.put('cursor', String(last));
    cursor = last;
    copied += rows.length;
    if (rows.length < PAGE) break;
  }
  await env.BACKUP.put('lastRun', JSON.stringify({ at: new Date().toISOString(), copied, cursor }));
  return copied;
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(backup(env));
  },
};
