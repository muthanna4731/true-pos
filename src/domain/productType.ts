import type { Product } from './types';

export type ProductType = 'beer' | 'whisky' | 'rum' | 'brandy' | 'vodka' | 'gin' | 'wine' | 'other';

/** Which type tab, and which tile colour, a product belongs to. Everything unlisted (liqueur, tequila, NALC) is "other". */
export function typeOf(p: Product): ProductType {
  if (p.category === 'BEER') return 'beer';
  if (p.category === 'WINE') return 'wine';
  if (p.category === 'IML') {
    switch (p.subcategory) {
      case 'WHISKY':
        return 'whisky';
      case 'RUM':
        return 'rum';
      case 'BRANDY':
        return 'brandy';
      case 'VODKA':
        return 'vodka';
      case 'GIN':
        return 'gin';
    }
  }
  return 'other';
}
