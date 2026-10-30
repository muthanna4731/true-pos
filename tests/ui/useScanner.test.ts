import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScanner } from '../../src/ui/shell/useScanner';

function key(k: string, target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function typeChars(text: string, gapMs: number, target: EventTarget = window): void {
  for (const ch of text) {
    key(ch, target);
    vi.advanceTimersByTime(gapMs);
  }
}

describe('useScanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports 13 fast keys followed by Enter as one scan', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    typeChars('8901234567890', 10);
    key('Enter');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('8901234567890');
  });

  it('ignores slow typing', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    typeChars('8901234567890', 200);
    key('Enter');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores a scan shorter than 6 characters', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    typeChars('12345', 10);
    key('Enter');
    expect(onScan).not.toHaveBeenCalled();
  });

  it('starts a new code after a pause', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    typeChars('999', 200);
    typeChars('8901234567890', 10);
    key('Enter');
    expect(onScan).toHaveBeenCalledWith('8901234567890');
  });

  it('can scan twice in a row', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    typeChars('8901234567890', 10);
    key('Enter');
    vi.advanceTimersByTime(500);
    typeChars('7K3M9QX2RA', 10);
    key('Enter');
    expect(onScan.mock.calls).toEqual([['8901234567890'], ['7K3M9QX2RA']]);
  });

  it('ignores keys held with Ctrl', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    window.dispatchEvent(e);
    typeChars('890123', 10);
    key('Enter');
    expect(onScan).toHaveBeenCalledWith('890123');
  });

  it('takes the scanned characters back out of a focused input', () => {
    const onScan = vi.fn();
    renderHook(() => useScanner(onScan));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.value = 'kf ';
    // The browser would add each character to the input as it is typed.
    for (const ch of '8901234567890') {
      key(ch, input);
      input.value += ch;
      vi.advanceTimersByTime(10);
    }
    key('Enter', input);
    expect(onScan).toHaveBeenCalledWith('8901234567890');
    expect(input.value).toBe('kf ');
    input.remove();
  });

  it('stops listening when unmounted', () => {
    const onScan = vi.fn();
    const { unmount } = renderHook(() => useScanner(onScan));
    unmount();
    typeChars('8901234567890', 10);
    key('Enter');
    expect(onScan).not.toHaveBeenCalled();
  });
});
