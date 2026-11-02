import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { changePin } from '../../src/db/users';
import { sha256Hex } from '../../src/domain/hash';
import { login, logout } from '../../src/ui/shell/session';

beforeEach(async () => {
  await resetDb();
  sessionStorage.clear();
  logout();
  await db.stores.add({ code: 'TSTS1', number: '01', name: 'Hebbal', branchSlug: null, isHub: true, upiVpa: 'x@upi', licenceNo: 'L1' });
  await db.users.bulkAdd([
    { id: 'U1', name: 'Cashier 1', phone: '1', role: 'cashier', pinHash: sha256Hex('U1:1111'), storeCodes: ['TSTS1'] },
    { id: 'U-M', name: 'Manager', phone: '2', role: 'manager', pinHash: sha256Hex('U-M:2222'), storeCodes: ['TSTS1'] },
  ]);
});

describe('changePin', () => {
  it('stores the same hash login checks, so the new PIN logs in and the old one does not', async () => {
    await changePin('U1', '5678');
    expect((await db.users.get('U1'))?.pinHash).toBe(sha256Hex('U1:5678'));
    expect(await login('U1', '1111')).toBe(false);
    expect(await login('U1', '5678')).toBe(true);
  });

  it('changes only that person', async () => {
    await changePin('U1', '5678');
    expect((await db.users.get('U-M'))?.pinHash).toBe(sha256Hex('U-M:2222'));
  });

  it('refuses anything but four digits, and an unknown person', async () => {
    for (const bad of ['', '123', '12345', 'abcd', '12 4', '١٢٣٤']) await expect(changePin('U1', bad)).rejects.toThrow('bad_pin');
    await expect(changePin('NOBODY', '1234')).rejects.toThrow('user_not_found');
    expect((await db.users.get('U1'))?.pinHash).toBe(sha256Hex('U1:1111'));
  });
});
