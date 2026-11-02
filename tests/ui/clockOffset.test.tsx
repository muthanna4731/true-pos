import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clock, istDate } from '../../src/domain/time';
import { useClockOffset } from '../../src/ui/useClockOffset';

function Today() {
  useClockOffset();
  return <p data-testid="today">{istDate(clock.now())}</p>;
}

describe('useClockOffset', () => {
  afterEach(() => clock.setOffsetDays(0));

  it('redraws a screen that reads today when the demo clock moves a day', () => {
    render(<Today />);
    const before = screen.getByTestId('today').textContent;
    act(() => clock.setOffsetDays(1));
    expect(screen.getByTestId('today').textContent).not.toBe(before);
    expect(screen.getByTestId('today').textContent).toBe(istDate(clock.now()));
  });
});
