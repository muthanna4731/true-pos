import type { Paise } from './types';

/** UPI deep link for a QR code. The VPA stays unencoded (`@` is legal in a query value). */
export function upiUri(vpa: string, payee: string, amount: Paise, billNo: string): string {
  const am = (amount / 100).toFixed(2);
  return `upi://pay?pa=${vpa}&pn=${encodeURIComponent(payee)}&am=${am}&cu=INR&tn=${encodeURIComponent(billNo)}`;
}
