function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV: header row from labels, CRLF between rows, no trailing newline. */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(','));
  return lines.join('\r\n');
}
