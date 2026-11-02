import { sha256Hex } from '../domain/hash';
import { db } from './db';

/**
 * Give someone a new 4-digit PIN. It is stored the way login checks it, `sha256Hex("<id>:<pin>")`, so the new PIN
 * works at the next login. Throws `bad_pin` for anything but four digits and `user_not_found` for an unknown id.
 */
export async function changePin(userId: string, pin: string): Promise<void> {
  if (!/^[0-9]{4}$/.test(pin)) throw new Error('bad_pin');
  const updated = await db.users.update(userId, { pinHash: sha256Hex(`${userId}:${pin}`) });
  if (updated === 0) throw new Error('user_not_found');
}
