import { describe, expect, it } from 'vitest';
import { searchProducts } from '../../src/domain/search';
import type { Product } from '../../src/domain/types';
import catalogue from '../../src/seed/catalogue.json';

const products = catalogue.products as Product[];
const none = new Map<string, number>();
const byDesc = (d: string) => products.find((p) => p.description === d)!;

describe('searchProducts', () => {
  it("'oc 90' puts OC 90 first", () => {
    const r = searchProducts('oc 90', products, none);
    expect(r[0]).toBe(byDesc('ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK'));
  });

  it("'kf 650' returns only Kingfisher 650s", () => {
    const r = searchProducts('kf 650', products, none);
    expect(r.length).toBeGreaterThan(0);
    for (const p of r) {
      expect(p.sizeMl).toBe(650);
      expect(p.description).toMatch(/KINGFISHER/);
    }
  });

  it("'kingfsher' (one letter missing) still finds Kingfisher", () => {
    const r = searchProducts('kingfsher', products, none);
    expect(r.some((p) => p.description.startsWith('KINGFISHER'))).toBe(true);
  });

  it('does not forgive typos in short tokens', () => {
    expect(searchProducts('kx', products, none)).toEqual([]);
  });

  it('expands the other aliases', () => {
    expect(searchProducts('monk', products, none).every((p) => /OLD MONK/.test(p.description))).toBe(true);
    expect(searchProducts('monk', products, none).length).toBeGreaterThan(0);
    expect(searchProducts('mc', products, none).length).toBeGreaterThan(0);
    expect(searchProducts('ib', products, none).length).toBeGreaterThan(0);
    expect(searchProducts('bud', products, none).length).toBeGreaterThan(0);
    expect(searchProducts('hay', products, none).length).toBeGreaterThan(0);
  });

  it('matches case-insensitively and needs every token', () => {
    const all = searchProducts('KF', products, none);
    const narrowed = searchProducts('Kf   650', products, none);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);
  });

  it('numeric tokens match the size exactly or a word start', () => {
    const r = searchProducts('90', products, none);
    expect(r.some((p) => p.sizeMl === 90)).toBe(true);
  });

  it('orders by rank, then description', () => {
    const base = searchProducts('kf 650', products, none);
    expect(base.map((p) => p.description)).toEqual([...base.map((p) => p.description)].sort());
    const last = base[base.length - 1]!;
    const ranked = searchProducts('kf 650', products, new Map([[last.id, 50]]));
    expect(ranked[0]).toBe(last);
  });

  it("'' and spaces return every product, ranked", () => {
    expect(searchProducts('', products, none)).toHaveLength(products.length);
    const rank = new Map([[products[10]!.id, 9]]);
    const r = searchProducts('   ', products, rank);
    expect(r).toHaveLength(products.length);
    expect(r[0]).toBe(products[10]);
  });

  it("'%' returns nothing", () => {
    expect(searchProducts('%', products, none)).toEqual([]);
  });

  it('Kannada text returns nothing and does not throw', () => {
    expect(searchProducts('ಕಿಂಗ್', products, none)).toEqual([]);
  });

  it('a 200 character string does not throw', () => {
    expect(() => searchProducts('kingfisher '.repeat(20).slice(0, 200), products, none)).not.toThrow();
    expect(() => searchProducts('x'.repeat(200), products, none)).not.toThrow();
  });

  it('cuts long queries to 40 characters', () => {
    const q = 'kf 650' + ' '.repeat(34) + 'zzzzzzzz';
    expect(q.length).toBeGreaterThan(40);
    expect(searchProducts(q, products, none)).toEqual(searchProducts('kf 650', products, none));
  });
});
