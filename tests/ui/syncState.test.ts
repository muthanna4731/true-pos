import { describe, expect, it } from 'vitest';
import { syncState } from '../../src/ui/shell/syncState';

describe('syncState', () => {
  it('says Online when connected', () => {
    expect(syncState(true, 0)).toEqual({ tone: 'ok', text: '● Online' });
  });

  it('says how many bills wait while offline', () => {
    expect(syncState(false, 12)).toEqual({ tone: 'offline', text: '● Offline · 12 bills will sync' });
    expect(syncState(false, 1)).toEqual({ tone: 'offline', text: '● Offline · 1 bill will sync' });
  });

  it('says just Offline when nothing waits', () => {
    expect(syncState(false, 0)).toEqual({ tone: 'offline', text: '● Offline' });
  });

  it('reports a sync problem while online', () => {
    expect(syncState(true, 3, 'x')).toEqual({ tone: 'problem', text: '● Sync problem, tell the manager' });
  });
});
