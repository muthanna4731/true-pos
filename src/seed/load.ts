import { resetDb, type TruePosDB } from '../db/db';
import { clock, istDate } from '../domain/time';
import { generateSeed, type SeedData } from './generate';

/** The fixed seed behind the demo data: every fresh browser gets the same shops, stock and bills. */
export const DEMO_SEED = 20261029;

const CLOCK_KEY = 'clockOffsetDays';

/** Read the saved demo clock offset (days) into the app clock. No saved value means no offset. */
export async function restoreClock(db: TruePosDB): Promise<void> {
  const row = await db.kv.get(CLOCK_KEY);
  clock.setOffsetDays(typeof row?.value === 'number' ? row.value : 0);
}

/** Move the demo clock forward by `days` and save it, so a reload keeps the new date. */
export async function advanceClock(db: TruePosDB, days: number): Promise<void> {
  const row = await db.kv.get(CLOCK_KEY);
  const next = (typeof row?.value === 'number' ? row.value : 0) + days;
  await db.kv.put({ key: CLOCK_KEY, value: next });
  clock.setOffsetDays(next);
}

/** Fill an empty database with the dummy seed, dated up to yesterday. A database that has stores is left alone. */
export async function loadSeedIfEmpty(db: TruePosDB, opts: { seed?: number; days?: number } = {}): Promise<void> {
  if (!db.isOpen()) await db.open();
  if ((await db.stores.count()) > 0) {
    await restoreClock(db);
    return;
  }
  clock.setOffsetDays(0);
  const data = generateSeed({ seed: opts.seed ?? DEMO_SEED, today: istDate(clock.now()), days: opts.days });
  await db.transaction('rw', db.tables, async () => {
    if ((await db.stores.count()) > 0) return; // another tab got there first
    for (const table of db.tables) {
      const rows = data[table.name as keyof SeedData] as unknown[];
      if (rows.length > 0) await table.bulkAdd(rows);
    }
  });
}

/** Wipe everything, including the clock offset, and load the seed again. */
export async function resetDemo(db: TruePosDB, opts: { seed?: number; days?: number } = {}): Promise<void> {
  await resetDb(db);
  clock.setOffsetDays(0);
  await loadSeedIfEmpty(db, opts);
}
