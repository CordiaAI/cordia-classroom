// Dates for tool output: ISO 8601 in the student's time zone (user_profiles.timezone; UTC until the
// app has saved one).
export function zoneOf(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function parts(date, timeZone) {
  const out = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)) out[type] = value;
  return out;
}

const pad = (number, size = 2) => String(Math.abs(number)).padStart(size, '0');

// '2026-10-30T09:12:00-05:00' for a timestamp, or null.
export function zonedIso(value, timeZone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offset = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offset < 0 ? '-' : '+';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

// The student's local calendar day, 'YYYY-MM-DD'.
export function localDay(now, timeZone) {
  const p = parts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

// A Date whose local fields are the student's today (for the shared day-based rules, which read a
// Date's local calendar day).
export function localDate(now, timeZone) {
  const [year, month, day] = localDay(now, timeZone).split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
