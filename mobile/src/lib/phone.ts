// Phone numbers: the account identity. The server stores E.164 (+972501234567).

/**
 * Normalizes what a reader typed to E.164.
 * Israeli mobiles: 050-1234567, 0501234567, 501234567, 972501234567, +972 50 123 4567, 00972…
 * Other countries: any number written with + (or 00) and 8–15 digits passes through.
 * Returns null when the input is not a valid number.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s\-().‎‏‪-‮]/g, '');
  if (!/^(\+|00)?\d+$/.test(compact)) return null;
  const international = compact.startsWith('+') || compact.startsWith('00');
  let digits = compact.replace(/^\+|^00/, '');

  if (digits.startsWith('972')) {
    let national = digits.slice(3);
    if (national.startsWith('0')) national = national.slice(1);
    return isIsraeliMobile(national) ? `+972${national}` : null;
  }
  if (international) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

  if (digits.startsWith('0')) digits = digits.slice(1);
  return isIsraeliMobile(digits) ? `+972${digits}` : null;
}

const isIsraeliMobile = (national: string) => /^5\d{8}$/.test(national);

/** "+972501234567" → "050-123-4567". Other numbers are returned with a leading +. */
export function formatPhone(e164: string): string {
  const m = /^\+972(5\d)(\d{3})(\d{4})$/.exec(e164);
  if (m) return `0${m[1]}-${m[2]}-${m[3]}`;
  return e164;
}
