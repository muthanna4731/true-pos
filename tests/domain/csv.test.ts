import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/domain/csv';

const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];

describe('toCsv', () => {
  it('quotes commas and doubles quotes', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"' }], cols)).toBe('A,B\r\n"x,y","say ""hi"""');
  });
  it('quotes embedded newlines', () => {
    expect(toCsv([{ a: 'l1\nl2', b: 1 }], cols)).toBe('A,B\r\n"l1\nl2",1');
  });
  it('renders null/undefined as empty and joins rows with CRLF', () => {
    expect(toCsv([{ a: null }, { b: 0 }], cols)).toBe('A,B\r\n,\r\n,0');
  });
  it('header only for no rows', () => {
    expect(toCsv([], cols)).toBe('A,B');
  });
});
