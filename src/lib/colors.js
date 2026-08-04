/**
 * Team colour resolution.
 *
 * ESPN publishes a primary and an alternate colour per team. Several primaries
 * are near-black (Raiders, Steelers, Texans) and vanish on a dark background,
 * while several alternates are pure white or pale gold and vanish on a light
 * one. Every team therefore gets a per-theme colour that is pushed into a
 * legible luminance band, and the 32 colours are assigned globally so that a
 * team looks the same in every chart on the page.
 */

const FALLBACK = '#7c8798';

export function hexToRgb(hex) {
  const h = String(hex ?? '').replace('#', '');
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function mix(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  if (!a || !b) return hex;
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

/** Push a colour toward the target luminance band without losing its hue. */
function adjustToBand(hex, min, max) {
  let out = hex;
  for (let i = 0; i < 16; i++) {
    const l = luminance(out);
    if (l >= min && l <= max) return out;
    out = l < min ? mix(out, '#ffffff', 0.14) : mix(out, '#000000', 0.12);
  }
  return out;
}

/**
 * Legible luminance windows per theme. The light ceiling of 0.35 keeps every
 * line at roughly 2.6:1 or better against a white card, which is what rescues
 * the pale golds (Steelers, Saints) and silvers (Raiders, Cowboys).
 */
const BAND = {
  dark: { min: 0.15, max: 0.88 },
  light: { min: 0.008, max: 0.35 },
};

const inBand = (hex, { min, max }) => {
  const l = luminance(hex);
  return l >= min && l <= max;
};

/** Colours with no meaningful hue read as "black" or "silver" and are interchangeable. */
function isAchromatic(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < 26;
}

/** The two candidate colours a team can be drawn with, each forced into band. */
function candidates(team, theme) {
  const band = BAND[theme] ?? BAND.dark;
  const raw = [team?.color, team?.altColor].filter(Boolean);
  if (!raw.length) return [FALLBACK];
  // A hueless colour is a poor first choice when the other option has real hue.
  const ordered = raw.length === 2 && isAchromatic(raw[0]) && !isAchromatic(raw[1]) ? [raw[1], raw[0]] : raw;
  const out = [];
  for (const hex of ordered) {
    const resolved = inBand(hex, band) ? hex : adjustToBand(hex, band.min, band.max);
    if (!out.includes(resolved)) out.push(resolved);
  }
  return out;
}

/** Single best colour for a team, ignoring what other teams are using. */
export function resolveTeamColor(team, theme) {
  if (!team) return FALLBACK;
  return candidates(team, theme)[0] ?? FALLBACK;
}

/** Perceptual-ish distance, good enough to spot teams that would look identical. */
export function colorDistance(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return Infinity;
  const rMean = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

const paletteCache = new WeakMap();

/**
 * Assign every team a colour once, league-wide, so a team keeps the same colour
 * in every chart. Teams are walked in a stable order and take whichever of
 * their two colours sits furthest from the colours already handed out, which
 * spreads the league's many navies across navy/red/gold instead of stacking
 * them on top of each other.
 */
export function teamPalette(teams, theme) {
  let byTheme = paletteCache.get(teams);
  if (!byTheme) {
    byTheme = new Map();
    paletteCache.set(teams, byTheme);
  }
  if (byTheme.has(theme)) return byTheme.get(theme);

  const abbrs = Object.keys(teams ?? {}).sort();
  const band = BAND[theme] ?? BAND.dark;
  const palette = new Map();
  const used = [];
  const nearestTo = (hex) => (used.length ? Math.min(...used.map((u) => colorDistance(u, hex))) : Infinity);

  for (const abbr of abbrs) {
    const options = candidates(teams[abbr], theme);
    // Teams keep their own primary unless it would collide with a colour that
    // has already been handed out and the alternate is a clear improvement.
    let best = options[0];
    let gap = nearestTo(best);
    if (gap < 58) {
      for (let i = 1; i < options.length; i++) {
        const alt = nearestTo(options[i]);
        if (alt > gap + 12) {
          gap = alt;
          best = options[i];
        }
      }
    }
    // Both of a team's colours can still land on top of another team (two golds,
    // two silvers). Shade the winner until it is at least tellable apart.
    if (gap < 40) {
      const toward = luminance(best) > (band.min + band.max) / 2 ? '#000000' : '#ffffff';
      let shade = best;
      for (let i = 0; i < 4 && gap < 40; i++) {
        shade = mix(shade, toward, 0.16);
        if (!inBand(shade, band)) break;
        const shadeGap = nearestTo(shade);
        if (shadeGap > gap) {
          gap = shadeGap;
          best = shade;
        }
      }
    }
    palette.set(abbr, best);
    used.push(best);
  }
  byTheme.set(theme, palette);
  return palette;
}

const DASH_PATTERNS = [[], [7, 4], [2, 3], [11, 4, 2, 4]];

/**
 * Per-chart styles: the league-wide colour plus, where two lines in this chart
 * would still be hard to tell apart, a distinct dash pattern.
 *
 * Entries are either a plain key (a team abbreviation) or a
 * `{ key, colorKey }` pair, which is what lets two players from the same team
 * share the team colour while still being separate lines.
 */
export function buildTeamStyles(entries, teams, theme) {
  const palette = teamPalette(teams, theme);
  const styles = new Map();
  const used = [];
  for (const entry of entries) {
    const key = typeof entry === 'string' ? entry : entry.key;
    const colorKey = typeof entry === 'string' ? entry : entry.colorKey ?? entry.key;
    const color = palette.get(colorKey) ?? resolveTeamColor(teams?.[colorKey], theme);
    const clash = used.filter((u) => colorDistance(u, color) < 62).length;
    styles.set(key, { color, dash: DASH_PATTERNS[Math.min(clash, DASH_PATTERNS.length - 1)] });
    used.push(color);
  }
  return styles;
}

export function withAlpha(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** Black or white text, whichever reads better on the given background. */
export function readableTextOn(hex) {
  return luminance(hex) > 0.45 ? '#0b0d10' : '#ffffff';
}
