const MAX_LEN = 20;
const ALLOWED = /^[A-Z0-9/-]{1,20}$/;
const PARSE = /^([A-Z0-9]+?)(?:-(\d+))?\/(\d{2}-\d{2})\/(\d+)$/;

/** `{store}/{fy}/{seq}`; counter 2+ becomes `{store}-{n}` with seq padded to 6. */
export function billNumber(store: string, counter: number, fy: string, seq: number): string {
  const head = counter > 1 ? `${store}-${counter}` : store;
  const tail = counter > 1 ? String(seq).padStart(6, '0') : String(seq);
  const n = `${head}/${fy}/${tail}`;
  if (n.length > MAX_LEN || !ALLOWED.test(n)) throw new Error('bill_number_too_long');
  return n;
}

/** Practice bill: `{store}P` (plus the counter after 1) in place of the store, seq always padded to 6. */
export function practiceBillNumber(store: string, counter: number, fy: string, seq: number): string {
  const n = `${store}P${counter > 1 ? counter : ''}/${fy}/${String(seq).padStart(6, '0')}`;
  if (n.length > MAX_LEN || !ALLOWED.test(n)) throw new Error('bill_number_too_long');
  return n;
}

export function parseBillNumber(n: string): { store: string; counter: number; fy: string; seq: number } {
  const m = PARSE.exec(n);
  if (!m) throw new Error('bad_bill_number');
  return { store: m[1], counter: m[2] ? Number(m[2]) : 1, fy: m[3], seq: Number(m[4]) };
}
