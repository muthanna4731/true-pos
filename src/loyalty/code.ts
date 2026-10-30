/**
 * Member code as the app writes it: no `TS1:` prefix, spaces or dashes, upper case,
 * and the letters people misread fixed (O is 0, I and L are 1).
 */
export function normalizeCode(raw: string): string {
  return raw
    .trim()
    .replace(/^TS1:/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const MEMBER_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** True when the text, once normalised, has the shape of a member code (so a scan is a member, not a bottle). */
export function isMemberCode(s: string): boolean {
  return MEMBER_CODE.test(normalizeCode(s));
}

/** The app's `mask()`: first letter and the last 4 digits of the phone, `R••• ··4821`. */
export function maskName(name: string, phone: string): string {
  const first = Array.from(name.trim())[0] ?? '•';
  return `${first}••• ··${phone.replace(/\D/g, '').slice(-4)}`;
}
