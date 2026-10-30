import type { Product } from './types';

const MAX_QUERY = 40;
const LOOSE_MIN_LEN = 5;

/** Counter shorthand → what the shop sells it as. Whole tokens only. */
const ALIASES: Record<string, string> = {
  kf: 'kingfisher',
  oc: 'original choice',
  mc: 'mcdowells',
  '8pm': '8 pm',
  monk: 'old monk',
  bud: 'budweiser',
  hay: 'haywards',
  ib: 'imperial blue',
  bw: 'black & white',
};

/** True when `a` and `b` differ by at most one insert, delete or replace. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // one is a prefix of the other, length differs by <= 1
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const isNumeric = (t: string): boolean => /^[0-9]+$/.test(t);

function matchesWord(token: string, word: string, loose: boolean): boolean {
  if (word.startsWith(token)) return true;
  return loose && (withinOneEdit(token, word) || withinOneEdit(token, word.slice(0, token.length)));
}

/**
 * Counter search. Every token of the query must match: a number matches the size exactly or the start of a
 * word, a text token the start of a word in the short name or description (after alias expansion, and
 * forgiving one typo when the token has 5+ letters). Best sellers first (`rank`), then A to Z.
 * A blank query returns everything; a query with no letters or digits returns nothing.
 */
export function searchProducts(query: string, products: Product[], rank: Map<string, number>): Product[] {
  const q = query.slice(0, MAX_QUERY).toLowerCase();
  const byRank = (a: Product, b: Product): number =>
    (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0) || (a.description < b.description ? -1 : a.description > b.description ? 1 : 0);

  if (q.trim() === '') return [...products].sort(byRank);
  if (!/[a-z0-9]/.test(q)) return [];

  // Each query token becomes the list of word-prefixes that must all be found.
  const tokens = q
    .split(/\s+/)
    .map((raw) => raw.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .map((t) => {
      const alias = ALIASES[t];
      if (alias) return { parts: wordsOf(alias), loose: false, numeric: false };
      return { parts: [t], loose: t.length >= LOOSE_MIN_LEN, numeric: isNumeric(t) };
    });

  return products
    .filter((p) => {
      const words = wordsOf(`${p.shortName} ${p.description}`);
      return tokens.every((t) =>
        t.parts.every(
          (part) =>
            (t.numeric && p.sizeMl === Number(part)) || words.some((w) => matchesWord(part, w, t.loose)),
        ),
      );
    })
    .sort(byRank);
}
