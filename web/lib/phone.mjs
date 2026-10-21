// Phone numbers for SMS sign-in, in the E.164 form Supabase Auth expects (+15551234567).
// A 10-digit number is read as US/Canada; anything else needs its country code.
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  let e164 = '';
  if (raw.startsWith('+')) e164 = '+' + digits;
  else if (digits.length === 10) e164 = '+1' + digits;
  else if (digits.length === 11 && digits.startsWith('1')) e164 = '+' + digits;
  else if (digits.length > 11) e164 = '+' + digits;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : '';
}

// +15551234567 -> +1 (555) 123-4567; other countries keep their E.164 form.
export function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return '+' + digits;
}
