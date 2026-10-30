import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../src/domain/id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when it exists', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id' });
    expect(newId()).toBe('fixed-id');
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (http on a LAN address)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0xff) });
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(0) });
    expect(newId()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('gives a valid, different id each time with the real crypto', () => {
    const a = newId();
    expect(a).toMatch(V4);
    expect(newId()).not.toBe(a);
  });
});
