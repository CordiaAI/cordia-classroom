// Class covers in Library's card view: one of eight soft colours and up to three subject icons.
// The icons come from this list only (the AI picks from it; the page draws only these), so a
// cover is never text, never an image from elsewhere, and looks right in both themes.
export const COVER_COLORS = 8;
export const COVER_ICONS = [
  'Music', 'Piano', 'Guitar', 'Mic', 'Headphones', 'Palette', 'Brush', 'PenTool', 'Camera', 'Film', 'Drama',
  'BookOpen', 'Library', 'Scroll', 'Feather', 'Quote', 'PenLine', 'Newspaper', 'Languages', 'Globe', 'Earth', 'Map', 'Compass',
  'Landmark', 'Church', 'Cross', 'Crown', 'Swords', 'Shield', 'Hourglass', 'Flag', 'Vote', 'Scale', 'Gavel',
  'Briefcase', 'Handshake', 'ChartLine', 'ChartPie', 'DollarSign', 'PiggyBank', 'Building2', 'Store', 'Megaphone', 'Users',
  'Brain', 'Smile', 'HeartPulse', 'Heart', 'Stethoscope', 'Pill', 'Syringe', 'Activity', 'Bone', 'Eye', 'Baby',
  'Dna', 'Microscope', 'FlaskConical', 'Atom', 'Flame', 'Droplet', 'Zap', 'Leaf', 'Sprout', 'TreePine', 'Bird', 'Fish',
  'Sun', 'Moon', 'Star', 'Telescope', 'Rocket', 'CloudSun', 'Mountain', 'Waves',
  'Calculator', 'Sigma', 'Pi', 'Ruler', 'Puzzle', 'Cpu', 'Code', 'Database', 'Laptop', 'Wrench', 'Hammer', 'Cog',
  'Trophy', 'Dumbbell', 'Apple', 'Utensils', 'Shirt', 'House', 'Bus', 'Plane',
  'GraduationCap', 'Lightbulb', 'Award',
];
const KNOWN = new Set(COVER_ICONS);

// Words in a class name or its material that point at icons, for an instant first cover (and
// whenever the AI can't be reached). Checked in order; the first three distinct icons win.
const KEYWORDS = [
  [/music|song|lied|piano|symphon|opera|composer|melod|chord|romantic era/i, ['Music', 'Piano', 'Headphones']],
  [/art\b|art history|paint|drawing|design|sculpt|museum/i, ['Palette', 'Brush', 'Landmark']],
  [/theat|drama|acting|film|cinema/i, ['Drama', 'Film', 'Camera']],
  [/english|literat|composition|writing|poet|novel|rhetoric|essay/i, ['BookOpen', 'Feather', 'PenLine']],
  [/spanish|french|german|language|linguist|chinese|japanese|latin/i, ['Languages', 'Globe', 'BookOpen']],
  [/histor|civiliz|ancient|medieval|war\b|empire|revolution/i, ['Landmark', 'Scroll', 'Hourglass']],
  [/relig|theolog|bible|testament|church|faith|scripture/i, ['Church', 'Scroll', 'BookOpen']],
  [/philosoph|ethic|logic/i, ['Brain', 'Scale', 'Lightbulb']],
  [/law|legal|court|constitution/i, ['Scale', 'Gavel', 'Landmark']],
  [/politic|government|civic/i, ['Vote', 'Landmark', 'Flag']],
  [/business|management|manag|entrepreneur|marketing|professional|prof experience|internship|career|resume/i, ['Briefcase', 'Handshake', 'ChartLine']],
  [/account|financ|econom|budget|invest|bank/i, ['DollarSign', 'ChartPie', 'PiggyBank']],
  [/psych|mind|behavio|cognit/i, ['Brain', 'Smile', 'Users']],
  [/sociol|anthropolog|communit|fratern|soror|pledge|chapter meeting/i, ['Users', 'Handshake', 'Award']],
  [/nurs|pharmac|medic|clinical|patient|health|anatomy|physiolog|pathophys/i, ['Stethoscope', 'HeartPulse', 'Pill']],
  [/biolog|\bbio\b|cell|genetic|dna|organism|ecolog|zoolog|botan/i, ['Dna', 'Microscope', 'Leaf']],
  [/chem|molecul|reaction|organic/i, ['FlaskConical', 'Atom', 'Droplet']],
  [/physic|mechanic|electric|energy|quantum/i, ['Atom', 'Zap', 'Rocket']],
  [/astro|space|planet|cosmo/i, ['Telescope', 'Moon', 'Star']],
  [/geolog|earth science|environment|climate|geograph/i, ['Earth', 'Mountain', 'CloudSun']],
  [/math|calculus|algebra|statistic|geometry|trigonom|\bstat\b/i, ['Sigma', 'Calculator', 'Pi']],
  [/computer|\bcis\b|\bcs\b|program|software|coding|data|database|cyber|\bit\b/i, ['Laptop', 'Code', 'Database']],
  [/engineer|mechanical|civil|electrical|robot/i, ['Cog', 'Wrench', 'Cpu']],
  [/sport|kinesiol|fitness|exercise|athlet|physical education/i, ['Dumbbell', 'Trophy', 'Activity']],
  [/nutrition|food|culinar|diet/i, ['Apple', 'Utensils', 'Leaf']],
  [/educat|teach|pedagog/i, ['GraduationCap', 'Lightbulb', 'BookOpen']],
];

export function keywordIcons(name, titles = []) {
  const text = [name, ...titles].join(' ');
  const picked = [];
  for (const [pattern, icons] of KEYWORDS) {
    if (!pattern.test(text)) continue;
    for (const icon of icons) if (!picked.includes(icon)) picked.push(icon);
    if (picked.length >= 3) break;
  }
  return (picked.length ? picked : ['BookOpen', 'Lightbulb', 'GraduationCap']).slice(0, 3);
}

// The same class always gets the same colour until the student picks another.
export function colorFor(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % COVER_COLORS;
}

export function cleanIcons(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(icon => KNOWN.has(icon)))].slice(0, 3);
}

// The cover to draw: the saved design, or one made at once from the name and material.
export function coverFor(folder, titles = []) {
  const saved = folder?.cover;
  if (saved?.kind === 'design' && cleanIcons(saved.icons).length) {
    return { color: Number.isInteger(saved.color) ? saved.color % COVER_COLORS : colorFor(folder.name), icons: cleanIcons(saved.icons), saved: true };
  }
  return { color: colorFor(folder?.name), icons: keywordIcons(folder?.name || '', titles), saved: false };
}
