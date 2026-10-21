// What a visual is drawn from. A short highlight alone gives Napkin too little to draw, so it
// leads and the rest of its section follows; a long highlight is enough on its own.
export const ENOUGH_TO_DRAW = 280;
const MAX_VISUAL_TEXT = 2000;

export function visualContent(highlight, section = '') {
  const lead = String(highlight || '').trim();
  if (lead.length >= ENOUGH_TO_DRAW || !section) return lead.slice(0, MAX_VISUAL_TEXT);
  const rest = String(section).split('\n').map(line => line.trim()).filter(line => line && !lead.includes(line) && !line.includes(lead));
  return [lead, ...rest].join('\n').slice(0, MAX_VISUAL_TEXT);
}
