/**
 * What the app knows about common subjects that simple primitives model poorly:
 * whether they're organic/limbed (inflate, never spin) and their real-world size,
 * so models built from reference images import into engines at a sensible scale.
 */

export interface Subject {
  words: string[];
  organic: boolean;
  /** Meters along `dim`. */
  size: number;
  /** height = vertical extent; length = longest extent in any direction. */
  dim: 'height' | 'length';
  /**
   * Expected silhouette, used to reject irrelevant search results. Elongation is
   * long side / short side; orient says which side is the long one.
   */
  silhouette?: { minElong: number; maxElong: number; orient?: 'tall' | 'wide'; maxFill?: number };
  /** Thickness of an inflated model relative to a round cross-section (flat objects like rifles ~0.4). */
  depth?: number;
}

// People and four-legged animals leave gaps between limbs, so they never fill most of their box.
const STANDING = { minElong: 1.7, maxElong: 5, orient: 'tall' as const, maxFill: 0.7 };
const FOUR_LEGGED = { minElong: 1, maxElong: 2.4, orient: 'wide' as const, maxFill: 0.62 };

export const SUBJECTS: Subject[] = [
  { words: ['person', 'man', 'woman', 'human', 'people', 'character', 'boy', 'girl', 'adult', 'knight', 'soldier', 'warrior', 'wizard', 'king', 'queen', 'pirate', 'ninja', 'zombie', 'elf', 'orc', 'astronaut', 'doctor', 'farmer'], organic: true, size: 1.75, dim: 'height', silhouette: STANDING },
  { words: ['child', 'kid', 'goblin', 'dwarf'], organic: true, size: 1.1, dim: 'height', silhouette: { minElong: 1.3, maxElong: 4.5, orient: 'tall' } },
  { words: ['robot', 'android', 'mech'], organic: true, size: 1.8, dim: 'height', silhouette: { minElong: 1.1, maxElong: 4.5, orient: 'tall' } },
  { words: ['statue', 'figure', 'figurine', 'sculpture'], organic: true, size: 1.8, dim: 'height', silhouette: { minElong: 1.2, maxElong: 6, orient: 'tall' } },
  { words: ['dog', 'wolf', 'fox', 'puppy'], organic: true, size: 0.9, dim: 'length', silhouette: { minElong: 1, maxElong: 2.2 } },
  { words: ['cat', 'kitten', 'rabbit', 'bunny'], organic: true, size: 0.45, dim: 'length', silhouette: { minElong: 1, maxElong: 2.2 } },
  { words: ['horse', 'cow', 'deer', 'camel', 'donkey'], organic: true, size: 2.3, dim: 'length', silhouette: FOUR_LEGGED },
  { words: ['elephant', 'dinosaur', 'rhino'], organic: true, size: 5, dim: 'length', silhouette: FOUR_LEGGED },
  { words: ['dragon', 'monster', 'creature', 'beast'], organic: true, size: 4, dim: 'length' },
  { words: ['bear', 'lion', 'tiger'], organic: true, size: 2, dim: 'length', silhouette: { minElong: 1, maxElong: 2.6 } },
  { words: ['pig', 'sheep', 'goat'], organic: true, size: 1.2, dim: 'length', silhouette: FOUR_LEGGED },
  { words: ['bird', 'chicken', 'duck', 'owl', 'parrot', 'pigeon'], organic: true, size: 0.35, dim: 'height', silhouette: { minElong: 1, maxElong: 3 } },
  { words: ['eagle', 'hawk'], organic: true, size: 0.8, dim: 'height' },
  { words: ['fish', 'frog', 'turtle'], organic: true, size: 0.35, dim: 'length', silhouette: { minElong: 1, maxElong: 4 } },
  { words: ['shark', 'dolphin'], organic: true, size: 2.5, dim: 'length', silhouette: { minElong: 1.8, maxElong: 6, orient: 'wide' } },
  { words: ['whale'], organic: true, size: 15, dim: 'length', silhouette: { minElong: 1.8, maxElong: 8, orient: 'wide' } },
  { words: ['snake', 'lizard'], organic: true, size: 1.2, dim: 'length' },
  { words: ['spider', 'insect', 'beetle', 'butterfly', 'bee', 'ant'], organic: true, size: 0.08, dim: 'length', silhouette: { minElong: 1, maxElong: 3 } },
  { words: ['rifle', 'shotgun', 'musket', 'sniper'], organic: false, size: 1.1, dim: 'length', silhouette: { minElong: 2.5, maxElong: 14 }, depth: 0.4 },
  { words: ['pistol', 'revolver', 'handgun', 'gun'], organic: false, size: 0.22, dim: 'length', silhouette: { minElong: 1, maxElong: 6 }, depth: 0.4 },
  { words: ['guitar', 'violin', 'cello'], organic: false, size: 1.0, dim: 'length', silhouette: { minElong: 1.6, maxElong: 4.5 }, depth: 0.4 },
  { words: ['bicycle', 'bike'], organic: false, size: 1.7, dim: 'length', silhouette: { minElong: 1.2, maxElong: 2.4, orient: 'wide' }, depth: 0.4 },
  { words: ['motorcycle', 'scooter'], organic: false, size: 2.1, dim: 'length', silhouette: { minElong: 1.1, maxElong: 2.6, orient: 'wide' }, depth: 0.4 },
  { words: ['airplane', 'plane', 'jet'], organic: false, size: 30, dim: 'length' },
  { words: ['helicopter'], organic: false, size: 12, dim: 'length', silhouette: { minElong: 1.2, maxElong: 4, orient: 'wide' } },
  { words: ['boat', 'ship'], organic: false, size: 10, dim: 'length', silhouette: { minElong: 1.2, maxElong: 6, orient: 'wide' } },
  { words: ['bow', 'crossbow'], organic: false, size: 1.2, dim: 'height', depth: 0.4 },
  { words: ['spear', 'staff', 'wand'], organic: false, size: 1.8, dim: 'length', silhouette: { minElong: 5, maxElong: 60 } },
  { words: ['hammer', 'wrench', 'pickaxe'], organic: false, size: 0.4, dim: 'length', silhouette: { minElong: 1.3, maxElong: 8 }, depth: 0.4 },
  { words: ['plant', 'flower', 'cactus'], organic: true, size: 0.5, dim: 'height' },
];

/** Whether a silhouette's proportions fit what this subject should look like. */
export function fitsSilhouette(subject: Subject | null, aspect: number, fill = 0): boolean {
  const s = subject?.silhouette;
  if (!s) return true;
  if (s.maxFill !== undefined && fill > s.maxFill) return false;
  const elong = Math.max(aspect, 1 / aspect);
  if (elong < s.minElong || elong > s.maxElong) return false;
  if (s.orient === 'tall' && aspect < 1) return false;
  if (s.orient === 'wide' && aspect > 1) return false;
  return true;
}

export function findSubject(tokens: string[]): Subject | null {
  return SUBJECTS.find((s) => s.words.some((w) => tokens.includes(w))) ?? null;
}

/** Words that describe style rather than the object, left out of image searches. */
const STYLE_WORDS = new Set(
  'low poly lowpoly pixel retro glowing glow shiny glossy matte smooth tiny small little large big huge giant massive flat thick thin tall short wide slim cartoon cartoony stylized realistic simple detailed cute game asset 3d 2d model sprite render'.split(' '),
);

/** Turns a prompt into an image-search query ("tall low poly rusty rifle" → "rusty rifle"). */
export function searchQuery(tokens: string[]): string {
  const kept = tokens.filter((t) => !STYLE_WORDS.has(t));
  return (kept.length ? kept : tokens).slice(0, 5).join(' ');
}

/**
 * Search phrasings to try in order until a clean cutout turns up. Plain queries
 * mostly return scenes; these steer toward single objects on plain backgrounds.
 */
export function queryVariants(query: string, subject: Subject | null): string[] {
  // "transparent background" finds real cutout PNGs on Commons (best possible silhouettes);
  // the other phrasings favor single objects on plain backgrounds.
  const standing = subject?.silhouette?.orient === 'tall';
  const variants = subject?.organic
    ? [
        `${query} transparent background`,
        ...(standing ? [`${query} standing transparent background`, `${query} full length portrait white background`] : []),
        `${query} isolated`,
        `${query} silhouette`,
        query,
      ]
    : [`${query} transparent background`, query, `${query} isolated`, `${query} white background`];
  // Last resort: the general subject ("knight" → "person"), so the shape is at least right.
  const general = subject?.words[0];
  if (general && !query.split(' ').includes(general)) {
    variants.push(`${general} ${standing ? 'standing ' : ''}transparent background`, ...(standing ? [`${general} silhouette standing`] : []));
  }
  return variants;
}