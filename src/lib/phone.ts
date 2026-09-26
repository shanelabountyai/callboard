/** Normalizes what people type into E.164, US by default. Null when it is not a phone number. */
export function toE164(raw: string, defaultCountry = '1'): string | null {
  const s = raw.trim();
  if (s.startsWith('+')) {
    const d = `+${s.slice(1).replace(/\D/g, '')}`;
    return /^\+[1-9]\d{7,14}$/.test(d) ? d : null;
  }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+${defaultCountry}${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
