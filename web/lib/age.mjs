// The age question at sign-up (social plan, Stage 9). Only the birth month and year are asked and
// kept. Under 13 gets no account (there's no parental consent flow); 13 to 17 counts as a minor.
// The server (POST /auth/age) checks the same thing and deletes an under-13 account.
export const MIN_AGE = 13;
export const ADULT_AGE = 18;
// Remembered on this browser after an under-13 answer, so trying again with another year doesn't help.
export const AGE_BLOCK_KEY = 'cordiaAgeBlock';
// An answer waiting to be sent once there's a session (email sign-up may need confirming first).
export const PENDING_AGE_KEY = 'cordiaPendingAge';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Whole years from the 1st of the birth month to today (never younger than the real age).
export function ageFrom(year, month, today = new Date()) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const nowY = today.getFullYear();
  const nowM = today.getMonth() + 1;
  if (y > nowY || (y === nowY && m > nowM) || y < 1900) return null;
  return nowY - y - (nowM < m ? 1 : 0);
}

export function birthYears(today = new Date(), span = 100) {
  const now = today.getFullYear();
  return Array.from({ length: span }, (_, i) => now - i);
}
