import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../../src/db/db';
import { setLoyaltyClient, type LoyaltyClient } from '../../src/loyalty/client';
import { requestLoyaltyRefresh, resolveLoyalty, useLoyaltyFlag } from '../../src/loyalty/flags';

describe('resolveLoyalty', () => {
  it('is off when nothing was read or saved', () => {
    expect(resolveLoyalty(undefined, undefined)).toBe(false);
  });

  it('uses the saved value when the switch cannot be read', () => {
    expect(resolveLoyalty(undefined, true)).toBe(true);
    expect(resolveLoyalty(undefined, false)).toBe(false);
  });

  it('prefers what the server just said', () => {
    expect(resolveLoyalty(false, true)).toBe(false);
    expect(resolveLoyalty(true, false)).toBe(true);
  });
});

function clientWith(flags: () => Promise<{ loyalty: boolean }>): LoyaltyClient {
  const unused = () => Promise.reject(new Error('not used in this test'));
  return {
    flags,
    memberInfo: unused,
    earn: unused,
    redeem: unused,
    reverse: unused,
    rewards: unused,
  };
}

describe('useLoyaltyFlag', () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => setLoyaltyClient(null));

  it('is off with no client and nothing saved', async () => {
    const { result } = renderHook(() => useLoyaltyFlag());
    await act(async () => {
      await db.kv.get('loyalty');
    });
    expect(result.current).toBe(false);
  });

  it('uses the saved value when there is no client', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    const { result } = renderHook(() => useLoyaltyFlag());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reads the switch from the client and saves it', async () => {
    setLoyaltyClient(clientWith(() => Promise.resolve({ loyalty: true })));
    const { result } = renderHook(() => useLoyaltyFlag());
    await waitFor(() => expect(result.current).toBe(true));
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: true });
  });

  it('falls back to the saved value when the client fails', async () => {
    await db.kv.put({ key: 'loyalty', value: true });
    setLoyaltyClient(clientWith(() => Promise.reject(new Error('network'))));
    const { result } = renderHook(() => useLoyaltyFlag());
    await waitFor(() => expect(result.current).toBe(true));
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: true });
  });

  it('follows a switch that changes on the next read', async () => {
    let on = true;
    setLoyaltyClient(clientWith(() => Promise.resolve({ loyalty: on })));
    const { result } = renderHook(() => useLoyaltyFlag());
    await waitFor(() => expect(result.current).toBe(true));
    on = false;
    await act(async () => {
      requestLoyaltyRefresh();
    });
    await waitFor(() => expect(result.current).toBe(false));
    expect(await db.kv.get('loyalty')).toEqual({ key: 'loyalty', value: false });
  });
});
