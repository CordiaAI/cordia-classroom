// "Sky follows the time" (VISUAL-POLISH V3, a Make it yours option): the Clouds backdrop changes with the device's
// local time. Plain JS, no React, no colour literals: the four skies are token variants in styles/tokens.css
// (<html data-sky>); this file only decides which period it is and whether the sky follows the time at all.
//
// Morning 6 to 11 (the sky a little brighter), day 11 to 17 (the sky as it is), evening 17 to 20 (a soft peach wash
// from the bottom), night 20 to 6 (a blue-grey night with a few faint stars). Each period starts on its hour.

export const SKY_PERIODS = ['morning', 'day', 'evening', 'night'];
// The hour each period starts, in order through the day (night runs past midnight to 6).
export const SKY_STARTS = { morning: 6, day: 11, evening: 17, night: 20 };
// A period change while the page is open crossfades over this long (instant under reduced motion).
export const SKY_FADE_MS = 3000;

const HOUR_MS = 3600000;

// The period for a time: a Date (its local hours), or an hour of the day (0 to 23, fractions allowed).
export function skyPeriod(time = new Date()) {
  const hour = time instanceof Date ? time.getHours() + time.getMinutes() / 60 : Number(time);
  if (!Number.isFinite(hour)) return 'day';
  const h = ((hour % 24) + 24) % 24;
  if (h >= SKY_STARTS.night || h < SKY_STARTS.morning) return 'night';
  if (h >= SKY_STARTS.evening) return 'evening';
  if (h >= SKY_STARTS.day) return 'day';
  return 'morning';
}

// Milliseconds from `now` to the start of the next period (local time), never less than one second.
export function msUntilNextPeriod(now = new Date()) {
  const starts = Object.values(SKY_STARTS).sort((a, b) => a - b);
  const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600 + now.getMilliseconds() / HOUR_MS;
  const next = starts.find(start => start > hour) ?? starts[0] + 24;
  return Math.max(1000, Math.round((next - hour) * HOUR_MS));
}

// What the saved settings alone allow: the option is on, the background is Clouds, no full look (Paper & Clay is
// plain paper) and the glass is not Solid. The device can still turn it off (skyActive).
export function skyAllowed(settings) {
  return Boolean(settings && settings.skyTime !== false && settings.bg === 'clouds' && (settings.look || 'none') === 'none' && settings.glass !== 'solid');
}

// Why the option is off right now, for the sheet's hint: null when it is free to follow the time.
export function skyBlockedBy(settings, { reducedTransparency = false, canFrost = true } = {}) {
  if (!settings) return 'background';
  if ((settings.look || 'none') !== 'none') return 'look';
  if (settings.bg !== 'clouds') return 'background';
  if (settings.glass === 'solid') return 'solid';
  if (reducedTransparency || !canFrost) return 'transparency';
  return null;
}

// True when the sky follows the time: allowed by the settings, and the device neither asks for less transparency
// nor lacks a frost (glass is solid then, whatever was picked).
export function skyActive(settings, { reducedTransparency = false, canFrost = true } = {}) {
  return skyAllowed(settings) && !reducedTransparency && canFrost !== false;
}

// The period to draw (null when the sky does not follow the time).
export function skyFor(settings, { period = skyPeriod(), reducedTransparency = false, canFrost = true } = {}) {
  return skyActive(settings, { reducedTransparency, canFrost }) ? period : null;
}

// Dark mode follows the night only for Match device: a page that loads at night turns dark, while a student who
// chose Light or Dark keeps it. Only the period at page load counts (lib/theme.js): the clock never flips light and
// dark while a page is open.
export function nightIsDark(appearance, sky) {
  return appearance === 'system' && sky === 'night';
}
