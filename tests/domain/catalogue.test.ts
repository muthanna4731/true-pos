import { describe, expect, it } from 'vitest';
import {
  brandOf,
  buildProduct,
  caseSizeFor,
  categoryOf,
  exciseGroup,
  parseDailySheet,
  parseDailySheetLine,
  shortNameOf,
  sizeOf,
} from '../../src/domain/catalogue';
import type { Product } from '../../src/domain/types';
import catalogue from '../../src/seed/catalogue.json';

const row = (subcategory: string, description: string, mrpRupees = 100) => ({
  subcategory,
  description,
  mrpRupees,
});

function eanIsValid(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const sum = digits.slice(0, 12).reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

describe('parseDailySheetLine', () => {
  it('reads subcategory, description and MRP from a data row', () => {
    const line =
      '320    WHISKY        ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK                     2462    0          0              0               2462    179     2283      55     9845';
    expect(parseDailySheetLine(line)).toEqual({
      subcategory: 'WHISKY',
      description: 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK',
      mrpRupees: 55,
    });
  });

  it('returns null for subtotal rows', () => {
    expect(parseDailySheetLine('BEER- Sub Total   3783 0 0 0 3783 42 3741 0 6765')).toBeNull();
  });

  it('returns null for headers and blank lines', () => {
    expect(parseDailySheetLine('S No   SubCategory   Material Description   OB   Purchase')).toBeNull();
    expect(parseDailySheetLine('')).toBeNull();
  });

  it('accepts negative stock figures', () => {
    const line = '12   BEER   TEST BEER 650 - BTL   -3   0   0   0   -3   0   -3   150   0';
    expect(parseDailySheetLine(line)?.mrpRupees).toBe(150);
  });
});

describe('parseDailySheet', () => {
  it('joins a description that wrapped onto the next line', () => {
    const text = [
      'S No   SubCategory   Material Description     OB      Purchase',
      '                                               Stock   Qty',
      '245   WHISKY   ABERFELDY HIGHLAND SINGLE MALT SCOTCH WHISKY 21 YEARS 750 -   1   0   0   0   1   0   1   9000   0',
      '                BTL',
      '246   WHISKY   ABERLOUR SPEYSIDE SINGLE MALT WHISKY 12 YEARS OLD 700 - BTL   3   0   0   0   3   0   3   6500   0',
      'WHISKY- Sub Total   4 0 0 0 4 0 4 0 0',
    ].join('\n');
    expect(parseDailySheet(text)).toEqual([
      row('WHISKY', 'ABERFELDY HIGHLAND SINGLE MALT SCOTCH WHISKY 21 YEARS 750 - BTL', 9000),
      row('WHISKY', 'ABERLOUR SPEYSIDE SINGLE MALT WHISKY 12 YEARS OLD 700 - BTL', 6500),
    ]);
  });

  it('joins a description whose tail sits past a page break', () => {
    const text = [
      '367   WHISKY   SOMETHING SPECIAL SPECIALLY SELECTED BLENDED SCOTCH WHISKY   25   0   0   0   25   0   25   2000   0',
      'S No   SubCategory   Material Description     OB      Purchase',
      '                                               Stock   Qty',
      '                  375 - BTL',
    ].join('\n');
    expect(parseDailySheet(text)).toEqual([
      row('WHISKY', 'SOMETHING SPECIAL SPECIALLY SELECTED BLENDED SCOTCH WHISKY 375 - BTL', 2000),
    ]);
  });

  it('joins a bare pack tail', () => {
    const text = [
      '178   WINE   QUINTA DA FONTE RED WINE 750 -   3   0   0   0   3   0   3   1500   0',
      '                BTL',
    ].join('\n');
    expect(parseDailySheet(text)[0]!.description).toBe('QUINTA DA FONTE RED WINE 750 - BTL');
  });

  it('does not treat a column header fragment as a continuation', () => {
    const text = [
      '1   BEER   BUDWEISER MAGNUM BEER 650 - BTL   334   0   0   0   334   0   334   250   0',
      '                                      Stock   Qty        Qty',
    ].join('\n');
    expect(parseDailySheet(text)[0]!.description).toBe('BUDWEISER MAGNUM BEER 650 - BTL');
  });
});

describe('sizeOf', () => {
  it('reads size and pack from the tail', () => {
    expect(sizeOf('UB EXPORT PREMIUM LAGER BEER 500 - CAN')).toEqual({ sizeMl: 500, pack: 'CAN' });
  });
  it('has no size when the tail is missing', () => {
    expect(sizeOf('BISLERI 1000ML')).toEqual({ sizeMl: null, pack: null });
  });
});

describe('categoryOf and exciseGroup', () => {
  it('maps subcategories', () => {
    expect(categoryOf('WHISKY')).toBe('IML');
    expect(categoryOf('TEQUILA')).toBe('IML');
    expect(categoryOf('BEER')).toBe('BEER');
    expect(categoryOf('WINE')).toBe('WINE');
    expect(categoryOf('WATER')).toBe('NALC');
    expect(categoryOf('SOFTDRINKS')).toBe('NALC');
  });

  it('groups wine with IML, beer alone, and non-alcoholic nowhere', () => {
    const p = (sub: string): Product => buildProduct(row(sub, `X ${sub} 750 - BTL`), 1);
    expect(exciseGroup(p('WINE'))).toBe('IML');
    expect(exciseGroup(p('BEER'))).toBe('BEER');
    expect(exciseGroup(p('WHISKY'))).toBe('IML');
    expect(exciseGroup(p('WATER'))).toBeNull();
  });
});

describe('caseSizeFor', () => {
  it.each([
    [750, 'BTL', 12],
    [1000, 'PET', 12],
    [375, 'BTL', 24],
    [180, 'TPACK', 48],
    [90, 'TPACK', 96],
    [60, 'PET', 150],
    [650, 'BTL', 12],
    [500, 'CAN', 24],
    [330, 'BTL', 24],
    [700, 'BTL', 12],
    [null, null, 1],
  ] as const)('%s %s is %s', (size, pack, expected) => {
    expect(caseSizeFor(size, pack)).toBe(expected);
  });
});

describe('brandOf', () => {
  it('strips the size tail', () => {
    expect(brandOf('BACARDI CARTA BLANCA SUPERIOR WHITE RUM 750 - BTL')).toBe(
      'BACARDI CARTA BLANCA SUPERIOR WHITE RUM',
    );
  });
  it('leaves a description without a tail alone', () => {
    expect(brandOf('BAG 20RS')).toBe('BAG 20RS');
  });
});

describe('shortNameOf', () => {
  it('uses the override map', () => {
    expect(shortNameOf('ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK')).toBe('OC 90');
    expect(shortNameOf('KINGFISHER STRONG PREMIUM BEER 650 - BTL')).toBe('KF Strong 650');
    expect(shortNameOf('BLACK & WHITE FINEST BLENDED SCOTCH WHISKY AGED 12 YEARS 180 - BTL')).toBe('B&W 180');
    expect(shortNameOf('8 PM SPECIAL WHISKY BLEND 750 - PET')).toBe('8PM 750');
    expect(shortNameOf('MCDOWELLS NO 1 CELEBRATION DELUXE RUM 750 - BTL')).toBe('MC 750');
  });

  it('does not match an override inside a longer word', () => {
    expect(shortNameOf('CORONADO WHISKY 750 - BTL')).toBe('Coronado 750');
    expect(shortNameOf('CORONA EXTRA BEER 330 - BTL')).toBe('Cor 330');
  });

  it('falls back to the first two words in Title Case', () => {
    expect(shortNameOf('PAUL JOHN MITHUNA INDIAN SINGLE MALT WHISKY 750 - BTL')).toBe('Paul John 750');
  });

  it('drops to one word when two words plus size would not fit', () => {
    expect(shortNameOf('BACARDI CARTA BLANCA SUPERIOR WHITE RUM 750 - BTL')).toBe('Bacardi 750');
  });

  it('keeps a qualifier only if it still fits in 16 characters', () => {
    expect(shortNameOf('UB EXPORT PREMIUM LAGER BEER 500 - CAN')).toBe('UB Premium 500');
    expect(shortNameOf('KINGFISHER ULTRA PREMIUM LAGER BEER 650 - BTL')).toBe('KF Ultra 650');
  });

  it('has no size suffix when the product has no size', () => {
    expect(shortNameOf('BAG 20RS')).toBe('Bag 20rs');
  });

  it('never exceeds 16 characters', () => {
    const long = 'EXTRAORDINARILYLONGBRANDNAME ANOTHERVERYLONGWORD SPECIAL WHISKY 750 - BTL';
    expect(shortNameOf(long).length).toBeLessThanOrEqual(16);
  });

  it('is at most 16 characters across the whole imported catalogue', () => {
    const { products } = catalogue as { products: Product[] };
    const tooLong = products.filter((p) => p.shortName.length > 16 || p.shortName.length === 0);
    expect(tooLong.map((p) => p.shortName)).toEqual([]);
    // the stored short name is what shortNameOf gives today
    for (const p of products) expect(shortNameOf(p.description)).toBe(p.shortName);
  });
});

describe('buildProduct', () => {
  const p = buildProduct(row('WHISKY', 'ORIGINAL CHOICE DELUXE WHISKY 90 - TPACK', 55), 7);

  it('builds an EAN-13 with prefix 890 and the index', () => {
    expect(p.barcode.startsWith('890000000007')).toBe(true);
    expect(eanIsValid(p.barcode)).toBe(true);
  });

  it('gives valid check digits for many indexes', () => {
    for (let i = 1; i <= 600; i++) expect(eanIsValid(buildProduct(row('RUM', 'X RUM 750 - BTL'), i).barcode)).toBe(true);
  });

  it('fills the product fields', () => {
    expect(p).toMatchObject({
      id: 'P0007',
      materialType: 'ALC',
      category: 'IML',
      subcategory: 'WHISKY',
      brand: 'ORIGINAL CHOICE DELUXE WHISKY',
      shortName: 'OC 90',
      sizeMl: 90,
      pack: 'TPACK',
      caseSize: 96,
      taxRateBp: 0,
    });
    expect(p.hsn).toBe('2208');
  });

  it('marks non-alcoholic products NALC with no excise', () => {
    const w = buildProduct(row('WATER', 'BISLERI 1000ML', 20), 3);
    expect(w).toMatchObject({ materialType: 'NALC', category: 'NALC', sizeMl: null, pack: null, caseSize: 1 });
  });
});

describe('catalogue.json', () => {
  const { products, mrp } = catalogue as { products: Product[]; mrp: Record<string, number> };

  it('has a price for every product and nothing else', () => {
    expect(products.length).toBeGreaterThanOrEqual(540);
    expect(Object.keys(mrp).sort()).toEqual(products.map((x) => x.id).sort());
    for (const v of Object.values(mrp)) expect(v).toBeGreaterThan(0);
  });

  it('has unique ids, descriptions and valid barcodes', () => {
    expect(new Set(products.map((x) => x.id)).size).toBe(products.length);
    expect(new Set(products.map((x) => x.description)).size).toBe(products.length);
    for (const x of products) expect(eanIsValid(x.barcode)).toBe(true);
  });

  it('carries only product fields', () => {
    const allowed = new Set([
      'id', 'materialType', 'category', 'subcategory', 'description', 'brand', 'shortName',
      'sizeMl', 'pack', 'caseSize', 'hsn', 'taxRateBp', 'barcode', 'image',
    ]);
    for (const x of products) for (const k of Object.keys(x)) expect(allowed.has(k)).toBe(true);
  });
});
