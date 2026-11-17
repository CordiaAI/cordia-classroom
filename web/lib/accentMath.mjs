// Accent maths for "Make it yours" (DESIGN-SPEC 3.5). Plain JS, no DOM, no React.
//
// A student picks one colour. From it we derive everything the olive tokens need, in both themes:
// the fill, the press shade, the shadow edge, the tint for selected glass, a lighter fill for dark
// mode and light ink for dark glass. Then we darken or lighten (in OKLab, so hue holds) until
//   - accent text and icons reach 4.5:1 on glass (light mode: the fill itself; dark mode: the ink),
//   - white text on the light fill reaches 4.5:1,
//   - the dark label on the dark fill, and on its pressed shade, reaches 4.5:1,
//   - the dark fill stands 3:1 clear of dark glass (it is the button edge as well as the button).
// deriveAccent() says whether it had to move the colour beyond the usual light-to-dark shift, so
// the sheet can say "Adjusted so text stays readable".
//
// No colour literals live here (the colour-token test scans lib/): the surfaces glass can sit on
// are numbers, and a test checks them against styles/tokens.css so they can't drift.

// ---------- Colour basics ----------

export function parseHex(value) {
  const text = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) return [...text].map(ch => parseInt(ch + ch, 16));
  if (/^[0-9a-f]{6}$/i.test(text)) return [0, 2, 4].map(i => parseInt(text.slice(i, i + 2), 16));
  return null;
}

export function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const toLinear = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

// WCAG relative luminance and contrast ratio.
export function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// A translucent colour laid over an opaque one.
export function over(top, alpha, under) {
  return top.map((channel, i) => channel * alpha + under[i] * (1 - alpha));
}

// ---------- OKLab / OKLCH ----------

function toOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function linearFromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = lin => lin.every(c => c >= -0.0005 && c <= 1.0005);

export function toOklch(rgb) {
  const [L, a, b] = toOklab(rgb);
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
}
// OKLCH to sRGB. A colour outside the screen's range keeps its lightness and hue and gives up
// chroma until it fits.
export function fromOklch({ L, C, h }) {
  const lightness = Math.min(1, Math.max(0, L));
  let chroma = Math.max(0, C);
  let lin = linearFromOklab(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearFromOklab(lightness, mid * Math.cos(h), mid * Math.sin(h)))) lo = mid; else hi = mid;
    }
    chroma = lo;
    lin = linearFromOklab(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  }
  return lin.map(c => Math.round(Math.min(255, Math.max(0, fromLinear(Math.min(1, Math.max(0, c)))))));
}
const withL = (color, L, chromaScale = 1) => fromOklch({ L, C: color.C * chromaScale, h: color.h });

// ---------- What the accent has to read on ----------

// White text on a light-mode accent, and the dark label on a dark-mode accent (the on-olive tokens).
const WHITE = [255, 255, 255];
const DARK_LABEL = [18, 22, 15];
export const TEXT_CONTRAST = 4.5;
export const FILL_CONTRAST = 3; // a dark-mode fill is also the button's edge

// The worst glass accent text can sit on, per theme, over every built-in background (test:
// accent-theme.test.mjs checks these against styles/tokens.css). Light mode is judged on the
// darkest backdrop under a Clearer pane (the most see-through glass); dark mode on the lightest
// backdrop under a Clearer pane with its top sheen.
export const SURFACES = {
  light: [216, 213, 227],
  dark: [85, 84, 90],
  // What the dark-mode fill has to stand clear of as an edge: a pane over the plain canvas, as the
  // existing contrast test measures it.
  darkFill: [40, 43, 48],
};

// A custom accent is darkened or lightened in steps of this much lightness (OKLab L).
const STEP = 0.004;
// Dark mode lifts the picked colour by this much, never to less than the floor, before any fitting.
const DARK_LIFT = 0.15;
const DARK_FLOOR = 0.68;
// Moving a colour further than this when lifting it for dark mode counts as an adjustment.
const DARK_SHIFT_NOTICED = 0.35;
// The press shade, shadow edge and dark-mode press are this much darker than the fill.
const PRESS_STEP = 0.08;
const EDGE_STEP = 0.17;
const DARK_PRESS_STEP = 0.045;

const rgbText = rgb => rgb.map(Math.round).join(', ');

function fitLight(pick) {
  // Both light-mode tests (white on the fill, the fill as text on glass) want a darker fill.
  const reads = rgb => contrast(WHITE, rgb) >= TEXT_CONTRAST && contrast(rgb, SURFACES.light) >= TEXT_CONTRAST;
  let L = pick.L;
  let rgb = fromOklch({ ...pick, L });
  while (!reads(rgb) && L > 0) {
    L = Math.max(0, L - STEP);
    rgb = fromOklch({ ...pick, L });
  }
  return { L, rgb };
}

function fitDark(pick) {
  // Both dark-mode tests (the dark label on the fill, the fill against glass) want a lighter fill;
  // the fill's pressed shade has to keep the label readable too.
  const label = (rgb) => contrast(DARK_LABEL, rgb) >= TEXT_CONTRAST;
  const good = (L) => {
    const fill = fromOklch({ ...pick, L });
    const pressed = fromOklch({ ...pick, L: L - DARK_PRESS_STEP });
    return label(fill) && label(pressed) && contrast(fill, SURFACES.darkFill) >= FILL_CONTRAST;
  };
  const start = Math.min(0.97, Math.max(pick.L + DARK_LIFT, DARK_FLOOR));
  let L = start;
  while (!good(L) && L < 1) L = Math.min(1, L + STEP);
  // The ink (accent text on dark glass) sits lighter than the fill and keeps a little less colour.
  let inkL = Math.max(L + 0.2, 0.84);
  let ink = fromOklch({ ...pick, L: inkL, C: pick.C * 0.5 });
  while (contrast(ink, SURFACES.dark) < TEXT_CONTRAST && inkL < 1) {
    inkL = Math.min(1, inkL + STEP);
    ink = fromOklch({ ...pick, L: inkL, C: pick.C * 0.5 });
  }
  return { L, start, fill: fromOklch({ ...pick, L }), ink };
}

// Everything the accent tokens need, from one picked colour. Never throws: a value that isn't a
// colour gives { ok: false }.
export function deriveAccent(input) {
  const rgb = parseHex(input);
  if (!rgb) return { ok: false };
  const pick = toOklch(rgb);
  // A grey has no hue; give it a stable one so the maths stays continuous.
  if (pick.C < 1e-4) pick.h = 0;

  const light = fitLight(pick);
  const lightColor = { ...pick, L: light.L };
  const press = withL(lightColor, Math.max(0, light.L - PRESS_STEP));
  const edge = withL(lightColor, Math.max(0, light.L - EDGE_STEP), 0.9);

  const dark = fitDark(pick);
  const darkColor = { ...pick, L: dark.L };
  const darkPress = withL(darkColor, dark.L - DARK_PRESS_STEP);
  const tint = fromOklch({ L: 0.84, C: pick.C * 0.55, h: pick.h });

  const moved = Math.abs(light.L - pick.L) > STEP / 2;
  const adjustedLight = moved;
  const adjustedDark = dark.L - pick.L > DARK_SHIFT_NOTICED || dark.L > dark.start + STEP / 2;
  const fill = light.rgb;

  return {
    ok: true,
    pick: rgb,
    adjusted: adjustedLight || adjustedDark,
    adjustedLight,
    adjustedDark,
    light: { fill, press, ink: fill, on: WHITE, edge, wash: dark.fill },
    dark: { fill: dark.fill, press, ink: dark.ink, on: DARK_LABEL, glassPress: darkPress, tint },
  };
}

// The runtime custom properties styles/tokens.css maps onto the olive tokens when
// <html data-accent="custom"> is set (and the same seeds every curated accent sets in the file).
export const ACCENT_VARIABLES = [
  '--ca-l-fill', '--ca-l-press', '--ca-l-ink', '--ca-l-on', '--ca-l-edge', '--ca-l-wash',
  '--ca-d-fill', '--ca-d-ink', '--ca-d-on', '--ca-d-glass-press', '--ca-d-tint',
];

export function accentVariables(derived) {
  if (!derived?.ok) return {};
  const { light, dark } = derived;
  return {
    '--ca-l-fill': rgbText(light.fill),
    '--ca-l-press': rgbText(light.press),
    '--ca-l-ink': rgbText(light.ink),
    '--ca-l-on': rgbText(light.on),
    '--ca-l-edge': rgbText(light.edge),
    '--ca-l-wash': rgbText(light.wash),
    '--ca-d-fill': rgbText(dark.fill),
    '--ca-d-ink': rgbText(dark.ink),
    '--ca-d-on': rgbText(dark.on),
    '--ca-d-glass-press': rgbText(dark.glassPress),
    '--ca-d-tint': rgbText(dark.tint),
  };
}
