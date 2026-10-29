import type { ExciseGroup, Product } from './types';

export interface DailySheetRow {
  subcategory: string;
  description: string;
  mrpRupees: number;
}

type Pack = Product['pack'];

const MAX_SHORT_NAME = 16;

// S No, subcategory, description, then seven stock figures (OB, purchase, inward,
// outward, total, sales, closing), then MRP (group 11) and sales value (group 12).
const LINE =
  /^\s*(\d+)\s+([A-Z]+)\s+(.+?)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/;

const SIZE_TAIL = /(\d+)\s*-\s*(BTL|CAN|PET|TPACK)$/;

// A wrapped description continues on the next line as single-spaced text.
// Column headers have wide gaps and the page stamp has colons, so neither matches.
// Column headings repeat on every page, and a wrapped row can straddle the break.
const PAGE_HEADING = /^\s*S No\b|^\s+Stock\s+Qty\b/;

const CONTINUATION = /^\s+([A-Z0-9&'./%-]+(?: [A-Z0-9&'./%-]+)*)\s*$/;

export function parseDailySheetLine(line: string): DailySheetRow | null {
  const m = LINE.exec(line);
  if (!m) return null;
  return { subcategory: m[2]!, description: m[3]!, mrpRupees: Number(m[11]) };
}

/** Parses the whole sheet, re-joining descriptions the PDF wrapped onto a second line. */
export function parseDailySheet(text: string): DailySheetRow[] {
  const rows: DailySheetRow[] = [];
  let last: DailySheetRow | null = null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseDailySheetLine(line);
    if (parsed) {
      rows.push(parsed);
      last = parsed;
      continue;
    }
    if (PAGE_HEADING.test(line)) continue;
    const cont = last && CONTINUATION.exec(line);
    if (last && cont) last.description += ` ${cont[1]}`;
    else last = null;
  }
  return rows;
}

const ALCOHOLIC_IML = new Set([
  'WHISKY', 'BRANDY', 'RUM', 'GIN', 'VODKA', 'TEQUILA', 'LIQUEUR', 'RTD',
]);

export function categoryOf(sub: string): Product['category'] {
  if (sub === 'BEER') return 'BEER';
  if (sub === 'WINE') return 'WINE';
  if (ALCOHOLIC_IML.has(sub)) return 'IML';
  return 'NALC';
}

export function exciseGroup(p: Product): ExciseGroup | null {
  if (p.category === 'BEER') return 'BEER';
  if (p.category === 'IML' || p.category === 'WINE') return 'IML';
  return null;
}

export function brandOf(desc: string): string {
  return desc.replace(SIZE_TAIL, '').trim();
}

export function sizeOf(desc: string): { sizeMl: number | null; pack: Pack } {
  const m = SIZE_TAIL.exec(desc.trim());
  if (!m) return { sizeMl: null, pack: null };
  return { sizeMl: Number(m[1]), pack: m[2] as NonNullable<Pack> };
}

export function caseSizeFor(sizeMl: number | null, pack: Pack): number {
  if (sizeMl === null || pack === null) return 1;
  switch (sizeMl) {
    case 60: return 150;
    case 90: return 96;
    case 180: return 48;
    case 375: return 24;
    case 330:
    case 500: return 24;
    default: return 12; // 1000, 750, 650 and anything unusual
  }
}

export const SHORT_NAME_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['ORIGINAL CHOICE', 'OC'],
  ['HAYWARDS', 'Hay'],
  ['KINGFISHER', 'KF'],
  ['MCDOWELLS NO 1', 'MC'],
  ['BLACK & WHITE', 'B&W'],
  ['OLD ADMIRAL', 'OA'],
  ['IMPERIAL BLUE', 'IB'],
  ['BUDWEISER', 'Bud'],
  ['HOEGAARDEN', 'Hoe'],
  ['CORONA', 'Cor'],
  ['UB EXPORT', 'UB'],
  ['OLD MONK', 'Monk'],
  ['ROYAL STAG', 'Royal'],
  ['8 PM', '8PM'],
];

// Words skipped at the front of a name so "THE GLENLIVET" becomes "Glenlivet".
const LEADING_ARTICLES = new Set(['THE', 'A']);
// A second word cut shorter than this reads as noise, so the name drops to one word.
const MIN_SECOND_WORD = 3;

const QUALIFIERS = new Set(['STRONG', 'ULTRA', 'PREMIUM']);

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** Finds the override whose key sits on word boundaries anywhere in the brand (earliest, then longest). */
function findOverride(brand: string): { abbr: string; after: string } | null {
  const padded = ` ${brand} `;
  let best: { at: number; key: string; abbr: string } | null = null;
  for (const [key, abbr] of SHORT_NAME_OVERRIDES) {
    const at = padded.indexOf(` ${key} `);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && key.length > best.key.length)) best = { at, key, abbr };
  }
  return best && { abbr: best.abbr, after: brand.slice(best.at + best.key.length) };
}

/** First two words in Title Case, the second one shortened to fit `room` characters. */
function fitTwoWords(words: string[], room: number): string {
  const first = titleCase(words[0] ?? '');
  const second = words[1];
  if (second === undefined) return first.slice(0, room);
  if (first.length + 1 + second.length <= room) return `${first} ${titleCase(second)}`;
  const avail = room - first.length - 1;
  if (avail < MIN_SECOND_WORD) return first.slice(0, room);
  return `${first} ${titleCase(second).slice(0, avail)}`;
}

/** Compact name for tiles and receipt lines, e.g. "KF Strong 650". Always 16 characters or fewer. */
export function shortNameOf(desc: string): string {
  const brand = brandOf(desc);
  const { sizeMl } = sizeOf(desc);
  const suffix = sizeMl === null ? '' : ` ${sizeMl}`;
  const room = MAX_SHORT_NAME - suffix.length;

  let base: string;
  let rest: string[];
  const override = findOverride(brand);
  if (override) {
    base = override.abbr;
    rest = override.after.split(/\s+/).filter(Boolean);
  } else {
    let words = brand.split(/\s+/).filter(Boolean);
    if (words.length > 2 && LEADING_ARTICLES.has(words[0]!)) words = words.slice(1);
    base = fitTwoWords(words, room);
    rest = words.slice(2);
  }
  if (base.length > room) base = base.slice(0, room);

  let name = base;
  for (const w of rest) {
    if (!QUALIFIERS.has(w)) continue;
    const next = `${name} ${titleCase(w)}`;
    if (next.length <= room) name = next;
  }
  return name + suffix;
}

function hsnOf(sub: string): string {
  switch (sub) {
    case 'BEER': return '2203';
    case 'WINE': return '2204';
    case 'WATER': return '2201';
    case 'SOFTDRINKS': return '2202';
    case 'SNACKS': return '2106';
    case 'BAG': return '3923';
    default: return '2208'; // spirits, liqueurs and ready-to-drink
  }
}

/** EAN-13: prefix 890, index as 9 digits, then the check digit. */
function barcodeFor(index: number): string {
  const body = `890${String(index).padStart(9, '0')}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + ((10 - (sum % 10)) % 10);
}

/** `index` is 1-based and gives the product its id (P0001) and barcode. */
export function buildProduct(row: DailySheetRow, index: number): Product {
  const { subcategory, description } = row;
  const category = categoryOf(subcategory);
  const { sizeMl, pack } = sizeOf(description);
  return {
    id: `P${String(index).padStart(4, '0')}`,
    materialType: category === 'NALC' ? 'NALC' : 'ALC',
    category,
    subcategory,
    description,
    brand: brandOf(description),
    shortName: shortNameOf(description),
    sizeMl,
    pack,
    caseSize: caseSizeFor(sizeMl, pack),
    hsn: hsnOf(subcategory),
    taxRateBp: 0,
    barcode: barcodeFor(index),
  };
}
