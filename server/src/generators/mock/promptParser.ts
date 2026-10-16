import type { Rgb } from '../types';

export type Shape =
  | 'crate'
  | 'barrel'
  | 'orb'
  | 'cone'
  | 'tree'
  | 'rock'
  | 'pillar'
  | 'coin'
  | 'gem'
  | 'mushroom'
  | 'house'
  | 'sword'
  | 'potion'
  | 'star'
  | 'heart';

export type Surface = 'wood' | 'stone' | 'metal' | 'brick' | 'glass' | 'plain';

export interface Modifiers {
  /** Vertical stretch from words like "tall" / "short"; null when the text says nothing. */
  height: number | null;
  /** Horizontal stretch from words like "wide" / "slim"; null when the text says nothing. */
  width: number | null;
  /** Depth of extruded/boxy forms relative to their default. */
  thickness: number | null;
  lowPoly: boolean;
  smooth: boolean;
  finish: 'shiny' | 'matte' | null;
  glowing: boolean;
  wear: 'rust' | 'moss' | null;
}

export interface ParsedPrompt {
  shape: Shape | null;
  surface: Surface;
  /** First color word in the prompt. */
  color: Rgb | null;
  /** Second distinct color word ("red crate with gold trim" → gold). */
  accent: Rgb | null;
  /** The color words as written, for the summary. */
  colorWords: string[];
  surfaceWord: string | null;
  scale: number;
  modifiers: Modifiers;
  /** Human-readable list of the modifiers that were applied. */
  modifierWords: string[];
  pixelArt: boolean;
  seed: number;
  name: string;
  words: string[];
}

// Checked in order; the first keyword hit wins.
const SHAPE_KEYWORDS: [Shape, string[]][] = [
  ['sword', ['sword', 'blade', 'katana', 'dagger']],
  ['potion', ['potion', 'flask', 'bottle', 'elixir']],
  ['mushroom', ['mushroom', 'toadstool', 'shroom']],
  ['house', ['house', 'hut', 'cabin', 'cottage', 'building', 'home']],
  ['tree', ['tree', 'pine', 'oak', 'bush', 'forest']],
  ['pillar', ['pillar', 'column', 'post', 'tower']],
  ['barrel', ['barrel', 'keg', 'cask', 'can', 'drum', 'cylinder']],
  ['coin', ['coin', 'token', 'medal']],
  ['gem', ['gem', 'crystal', 'diamond', 'jewel', 'ruby', 'emerald', 'sapphire', 'shard']],
  ['rock', ['rock', 'boulder', 'stone', 'pebble', 'asteroid', 'ore']],
  ['star', ['star']],
  ['heart', ['heart', 'health', 'life']],
  ['orb', ['orb', 'ball', 'sphere', 'planet', 'globe', 'bubble', 'egg']],
  ['cone', ['cone', 'spike', 'horn', 'pyramid']],
  ['crate', ['crate', 'box', 'cube', 'chest', 'block', 'package']],
];

const SURFACE_KEYWORDS: [Surface, string[]][] = [
  ['brick', ['brick', 'bricks']],
  ['wood', ['wood', 'wooden', 'plank', 'timber', 'log']],
  ['metal', ['metal', 'metallic', 'steel', 'iron', 'gold', 'golden', 'silver', 'bronze', 'copper', 'chrome']],
  ['stone', ['stone', 'rock', 'marble', 'granite', 'concrete', 'cobble']],
  ['glass', ['glass', 'ice', 'icy', 'crystal', 'frozen']],
];

const COLORS: Record<string, Rgb> = {
  red: [0.85, 0.15, 0.15],
  crimson: [0.7, 0.05, 0.15],
  orange: [0.95, 0.5, 0.1],
  yellow: [0.95, 0.85, 0.15],
  gold: [0.95, 0.75, 0.2],
  golden: [0.95, 0.75, 0.2],
  green: [0.2, 0.7, 0.25],
  lime: [0.55, 0.9, 0.2],
  emerald: [0.1, 0.65, 0.4],
  teal: [0.1, 0.6, 0.6],
  cyan: [0.1, 0.85, 0.95],
  blue: [0.15, 0.4, 0.9],
  sapphire: [0.1, 0.25, 0.75],
  navy: [0.08, 0.12, 0.4],
  purple: [0.55, 0.2, 0.8],
  violet: [0.6, 0.3, 0.9],
  pink: [0.95, 0.45, 0.7],
  magenta: [0.85, 0.1, 0.7],
  ruby: [0.75, 0.05, 0.2],
  brown: [0.5, 0.32, 0.18],
  wooden: [0.6, 0.4, 0.22],
  black: [0.08, 0.08, 0.1],
  white: [0.95, 0.95, 0.95],
  gray: [0.5, 0.5, 0.52],
  grey: [0.5, 0.5, 0.52],
  silver: [0.78, 0.8, 0.83],
  bronze: [0.7, 0.45, 0.2],
  copper: [0.8, 0.45, 0.3],
  iron: [0.45, 0.47, 0.5],
  steel: [0.62, 0.65, 0.7],
  ice: [0.7, 0.9, 1.0],
  icy: [0.7, 0.9, 1.0],
};

const SIZE_WORDS: [number, string[]][] = [
  [0.4, ['tiny', 'mini', 'miniature']],
  [0.7, ['small', 'little']],
  [1.6, ['large', 'big']],
  [2.5, ['huge', 'giant', 'massive', 'enormous']],
];

const HEIGHT_WORDS: [number, string[]][] = [
  [1.45, ['tall', 'long', 'elongated', 'towering', 'lanky']],
  [0.65, ['short', 'stubby', 'squat']],
];

const WIDTH_WORDS: [number, string[]][] = [
  [1.4, ['wide', 'fat', 'broad', 'chunky', 'bulky', 'round']],
  [0.68, ['slim', 'skinny', 'narrow', 'slender', 'thin']],
];

const THICKNESS_WORDS: [number, string[]][] = [
  [0.35, ['flat', 'paper', 'sheet', 'card', 'cutout']],
  [2, ['thick', 'chunky', 'solid', 'puffy']],
];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG so the same prompt always produces the same asset. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parsePrompt(prompt: string): ParsedPrompt {
  const words: string[] = prompt.toLowerCase().match(/[a-z]+/g) ?? [];
  const has = (list: string[]) => list.some((k) => words.includes(k) || words.includes(k + 's'));

  const pick = <T,>(table: [T, string[]][]) => table.find(([, keys]) => has(keys));
  const text = words.join(' ');

  const shape = pick(SHAPE_KEYWORDS)?.[0] ?? null;
  const scale = pick(SIZE_WORDS)?.[0] ?? 1;

  // Distinct colors in the order they appear ("gold"/"golden" count once).
  const colorWords: string[] = [];
  const colors: Rgb[] = [];
  for (const w of words) {
    const c = COLORS[w];
    if (c && !colors.some((x) => x.every((v, i) => v === c[i]))) {
      colors.push(c);
      colorWords.push(w);
    }
  }

  // A material word that is really the accent color ("green potion with gold cork")
  // describes that part, not the whole object.
  const accentWords = new Set(colorWords.slice(1));
  const surfaceHit = SURFACE_KEYWORDS.map(([surface, keys]) => {
    const word = words.find((w) => !accentWords.has(w) && (keys.includes(w) || keys.includes(w.replace(/s$/, ''))));
    return word ? ([surface, word] as const) : null;
  }).find(Boolean);

  const modifiers: Modifiers = {
    height: pick(HEIGHT_WORDS)?.[0] ?? null,
    width: pick(WIDTH_WORDS)?.[0] ?? null,
    thickness: pick(THICKNESS_WORDS)?.[0] ?? null,
    lowPoly: /\blow ?poly\b/.test(text) || has(['faceted', 'blocky', 'lowpoly']),
    smooth: has(['smooth', 'polished', 'sleek']),
    finish: has(['shiny', 'glossy', 'polished', 'reflective']) ? 'shiny' : has(['matte', 'rough', 'dull']) ? 'matte' : null,
    glowing: has(['glowing', 'glow', 'neon', 'magic', 'magical', 'luminous', 'enchanted', 'radiant']),
    wear: has(['rusty', 'rust', 'rusted', 'corroded']) ? 'rust' : has(['mossy', 'moss', 'overgrown']) ? 'moss' : null,
  };
  const modifierWords = [
    modifiers.height && (modifiers.height > 1 ? 'taller' : 'shorter'),
    modifiers.width && (modifiers.width > 1 ? 'wider' : 'slimmer'),
    modifiers.thickness && (modifiers.thickness > 1 ? 'thicker' : 'flatter'),
    modifiers.lowPoly && 'low-poly',
    modifiers.smooth && 'smooth',
    modifiers.finish,
    modifiers.glowing && 'glowing',
    modifiers.wear && (modifiers.wear === 'rust' ? 'rusty' : 'mossy'),
    scale !== 1 && (scale > 1 ? 'larger' : 'smaller'),
  ].filter((w): w is string => typeof w === 'string');

  const name =
    words
      .filter((w) => w.length > 2)
      .slice(0, 4)
      .join('-') || 'asset';

  return {
    shape,
    surface: surfaceHit?.[0] ?? 'plain',
    color: colors[0] ?? null,
    accent: colors[1] ?? null,
    colorWords,
    surfaceWord: surfaceHit?.[1] ?? null,
    scale,
    modifiers,
    modifierWords,
    pixelArt: has(['pixel', 'retro', 'bit']),
    seed: hashString(prompt.trim().toLowerCase()),
    name,
    words,
  };
}

export function defaultSurfaceColor(surface: Surface, seed: number): Rgb {
  switch (surface) {
    case 'wood':
      return [0.6, 0.4, 0.22];
    case 'stone':
      return [0.55, 0.55, 0.57];
    case 'metal':
      return [0.75, 0.77, 0.8];
    case 'brick':
      return [0.7, 0.3, 0.22];
    case 'glass':
      return [0.6, 0.85, 0.95];
    default:
      return hslToRgb((seed % 360) / 360, 0.6, 0.55);
  }
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function shade(c: Rgb, factor: number): Rgb {
  return c.map((v) => Math.max(0, Math.min(1, v * factor))) as Rgb;
}

export function toCss(c: Rgb, alpha = 1): string {
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
