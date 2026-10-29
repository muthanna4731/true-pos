// Local only: turns the text of the Daily Sheet PDF into src/seed/catalogue.json.
//   pdftotext -layout "<Daily Sheet>.pdf" <dailySheet>.txt
//   npx tsx scripts/import-catalogue.mts <dailySheet>.txt
// The text file holds real stock figures; keep it out of the repo.
// Only product fields and MRP (rupees) are written.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildProduct, parseDailySheet } from '../src/domain/catalogue.ts';
import type { Product } from '../src/domain/types.ts';

const input = process.argv[2];
if (!input) {
  console.error('usage: npx tsx scripts/import-catalogue.mts <dailySheet.txt>');
  process.exit(1);
}

const rows = parseDailySheet(readFileSync(input, 'utf8'));
const seen = new Set<string>();
const products: Product[] = [];
const mrp: Record<string, number> = {};
for (const row of rows) {
  if (seen.has(row.description)) continue;
  seen.add(row.description);
  const product = buildProduct(row, products.length + 1);
  products.push(product);
  mrp[product.id] = row.mrpRupees;
}

const out = new URL('../src/seed/catalogue.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ products, mrp }, null, 2)}\n`);
console.log(`${rows.length} rows, ${products.length} products written`);
