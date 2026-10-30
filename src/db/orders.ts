import { INDENT_RE } from '../domain/orders';
import { newId } from '../domain/id';
import { clock } from '../domain/time';
import type { Indent } from '../domain/types';
import { db } from './db';

/** Save a suggested order as a draft: lines with 0 cases are dropped, and an empty order is refused. Returns the draft's id. */
export async function saveDraftIndent(storeCode: string, lines: { productId: string; cases: number }[]): Promise<string> {
  if (lines.some((l) => !Number.isInteger(l.cases) || l.cases < 0)) throw new Error('bad_cases');
  const kept = lines.filter((l) => l.cases > 0);
  if (kept.length === 0) throw new Error('empty_order');
  const id = `DRAFT-${newId().slice(0, 8)}`;
  await db.indents.add({ id, storeCode, placedAt: clock.now(), status: 'draft', lines: kept });
  return id;
}

/** Give a draft its KSBCL indent number and mark it Placed. The number must match the indent format and be new. */
export function placeIndent(draftId: string, indentNo: string): Promise<void> {
  const number = indentNo.trim().toUpperCase();
  if (!INDENT_RE.test(number)) return Promise.reject(new Error('bad_indent'));
  return db.transaction('rw', db.indents, async () => {
    const draft = await db.indents.get(draftId);
    if (!draft || draft.status !== 'draft') throw new Error('not_a_draft');
    if (await db.indents.get(number)) throw new Error('indent_exists');
    await db.indents.delete(draftId);
    await db.indents.add({ ...draft, id: number, status: 'placed', placedAt: clock.now() });
  });
}

const NEXT: Partial<Record<Indent['status'], Indent['status']>> = { placed: 'paid', paid: 'dispatched' };

/** Move a placed order to Paid, or a paid one to Dispatched. Received is set only when the delivery is booked.
 *  `from` is the status the button showed, so a double tap cannot skip a step. */
export function advanceIndent(id: string, from: 'placed' | 'paid'): Promise<void> {
  return db.transaction('rw', db.indents, async () => {
    const indent = await db.indents.get(id);
    if (!indent) throw new Error('indent_not_found');
    const next = NEXT[indent.status];
    if (!next || indent.status !== from) throw new Error('cannot_advance');
    await db.indents.update(id, { status: next });
  });
}
