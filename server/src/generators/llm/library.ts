import type { Align, Arrangement, LayoutDesign, LayoutPart, Side } from './layout';
import type { PartMaterial, PartShape } from './parts';

/**
 * Reference designs of common game props. The most similar ones to a prompt are
 * shown to the text model as worked examples; small models adapt a nearby
 * example far better than they design from scratch. Liked user results join
 * this pool at runtime (see feedback.ts).
 */

type V = [number, number, number];

function part(
  name: string,
  shape: PartShape,
  size: V,
  attach_to: string,
  side: Side,
  color: string,
  material: PartMaterial,
  opts: { align?: Align; arrangement?: Arrangement; rotation?: V } = {},
): LayoutPart {
  return {
    name,
    shape,
    size,
    attach_to,
    side,
    align: opts.align ?? 'center',
    arrangement: opts.arrangement ?? 'single',
    rotation: opts.rotation ?? [0, 0, 0],
    color,
    material,
  };
}

const GROUND = 'ground';

function design(name: string, parts_plan: string, summary: string, parts: LayoutPart[]): LayoutDesign {
  return { name, parts_plan, summary, text_names_object: true, parts };
}

export interface LibraryEntry {
  keywords: string[];
  design: LayoutDesign;
}

const UP: V = [90, 0, 0];
const SIDEWAYS: V = [0, 0, 90];

export const LIBRARY: LibraryEntry[] = [
  {
    keywords: ['wooden table', 'table', 'desk'],
    design: design('wooden table', 'A flat rectangular top with four straight legs under its corners.', 'Rectangular tabletop on four legs.', [
      part('top', 'box', [1.2, 0.05, 0.7], GROUND, 'ground', '#9c6b3c', 'wood'),
      part('leg', 'box', [0.06, 0.7, 0.06], 'top', 'below', '#83582f', 'wood', { arrangement: 'corners' }),
    ]),
  },
  {
    keywords: ['street lamp', 'lamp post', 'lamp', 'light'],
    design: design('street lamp', 'A round base, a tall thin pole on it, a hood on top, and a glowing bulb under the hood.', 'Iron lamp post with a glowing bulb.', [
      part('base', 'cylinder', [0.4, 0.15, 0.4], GROUND, 'ground', '#2f3336', 'metal'),
      part('pole', 'cylinder', [0.1, 3, 0.1], 'base', 'on_top', '#2f3336', 'metal'),
      part('hood', 'cone', [0.6, 0.35, 0.6], 'pole', 'on_top', '#1f2224', 'metal'),
      part('bulb', 'sphere', [0.22, 0.22, 0.22], 'hood', 'below', '#ffe9a8', 'glow'),
    ]),
  },
  {
    keywords: ['coffee mug', 'mug', 'cup'],
    design: design('coffee mug', 'A ceramic cylinder body with a ring handle on its right side and coffee at the top.', 'Ceramic mug with a ring handle.', [
      part('body', 'cylinder', [0.09, 0.1, 0.09], GROUND, 'ground', '#f2f0ea', 'ceramic'),
      part('handle', 'torus', [0.06, 0.012, 0.06], 'body', 'right', '#f2f0ea', 'ceramic', { rotation: UP }),
      part('coffee', 'cylinder', [0.082, 0.006, 0.082], 'body', 'on_top', '#3b2314', 'organic'),
    ]),
  },
  {
    keywords: ['key', 'door key', 'skeleton key'],
    design: design('old key', 'A thin shaft standing upright, a ring bow on top of it, and two teeth sticking out to the right at the bottom.', 'Brass key with a ring bow and two teeth.', [
      part('shaft', 'cylinder', [0.007, 0.05, 0.007], GROUND, 'ground', '#c9a64a', 'metal'),
      part('bow', 'torus', [0.03, 0.006, 0.03], 'shaft', 'on_top', '#c9a64a', 'metal', { rotation: UP }),
      part('tooth', 'box', [0.012, 0.006, 0.004], 'shaft', 'right', '#c9a64a', 'metal', { align: 'bottom' }),
      part('upper tooth', 'box', [0.008, 0.005, 0.004], 'tooth', 'on_top', '#c9a64a', 'metal', { align: 'left' }),
    ]),
  },
  {
    keywords: ['chair', 'seat', 'stool'],
    design: design('wooden chair', 'A square seat on four legs, with a tall backrest standing on the back edge of the seat.', 'Simple wooden chair.', [
      part('seat', 'box', [0.45, 0.05, 0.45], GROUND, 'ground', '#a0703c', 'wood'),
      part('leg', 'box', [0.04, 0.45, 0.04], 'seat', 'below', '#8a5d30', 'wood', { arrangement: 'corners' }),
      part('backrest', 'box', [0.45, 0.45, 0.04], 'seat', 'on_top', '#a0703c', 'wood', { align: 'back' }),
    ]),
  },
  {
    keywords: ['sword', 'blade', 'katana', 'dagger'],
    design: design('steel sword', 'A grip with a round pommel below it, a wide crossguard on top, then a long flat blade ending in a point.', 'Steel longsword with a gold crossguard.', [
      part('grip', 'cylinder', [0.03, 0.16, 0.03], GROUND, 'ground', '#4a2e1a', 'wood'),
      part('pommel', 'sphere', [0.05, 0.05, 0.05], 'grip', 'below', '#c9a64a', 'metal'),
      part('guard', 'box', [0.22, 0.03, 0.05], 'grip', 'on_top', '#c9a64a', 'metal'),
      part('blade', 'box', [0.05, 0.75, 0.012], 'guard', 'on_top', '#c8ccd2', 'metal'),
      part('tip', 'pyramid', [0.05, 0.08, 0.012], 'blade', 'on_top', '#c8ccd2', 'metal'),
    ]),
  },
  {
    keywords: ['treasure chest', 'chest', 'trunk', 'loot'],
    design: design('treasure chest', 'A wooden box body with a lid on top, two metal bands around it and a lock on the front.', 'Wooden treasure chest with iron bands.', [
      part('body', 'box', [0.8, 0.45, 0.5], GROUND, 'ground', '#7a4b26', 'wood'),
      part('lid', 'box', [0.82, 0.18, 0.52], 'body', 'on_top', '#8a5a30', 'wood'),
      part('band', 'box', [0.06, 0.64, 0.54], 'body', 'center', '#3a3a40', 'metal', { arrangement: 'pair', align: 'bottom' }),
      part('lock', 'box', [0.08, 0.1, 0.03], 'body', 'front', '#d4af37', 'metal', { align: 'top' }),
    ]),
  },
  {
    keywords: ['barrel', 'keg', 'cask'],
    design: design('wooden barrel', 'A tall wooden cylinder with metal hoops near the top and the bottom.', 'Wooden barrel with two iron hoops.', [
      part('body', 'cylinder', [0.6, 0.9, 0.6], GROUND, 'ground', '#8b5a2b', 'wood'),
      part('top hoop', 'torus', [0.63, 0.04, 0.63], 'body', 'center', '#3a3a40', 'metal', { align: 'top' }),
      part('bottom hoop', 'torus', [0.63, 0.04, 0.63], 'body', 'center', '#3a3a40', 'metal', { align: 'bottom' }),
    ]),
  },
  {
    keywords: ['lantern', 'oil lamp', 'candle'],
    design: design('lantern', 'A metal base, a glass chamber with a glowing flame inside and four thin posts at its corners, a cone roof and a carry ring on top.', 'Iron lantern with a glowing flame.', [
      part('base', 'cylinder', [0.2, 0.03, 0.2], GROUND, 'ground', '#3a3a40', 'metal'),
      part('glass', 'cylinder', [0.16, 0.22, 0.16], 'base', 'on_top', '#d8eef5', 'glass'),
      part('flame', 'sphere', [0.05, 0.08, 0.05], 'glass', 'center', '#ffb84a', 'glow'),
      part('post', 'cylinder', [0.015, 0.22, 0.015], 'glass', 'center', '#3a3a40', 'metal', { arrangement: 'corners' }),
      part('roof', 'cone', [0.22, 0.1, 0.22], 'glass', 'on_top', '#3a3a40', 'metal'),
      part('ring', 'torus', [0.06, 0.01, 0.06], 'roof', 'on_top', '#3a3a40', 'metal', { rotation: UP }),
    ]),
  },
  {
    keywords: ['tree', 'oak', 'bush'],
    design: design('oak tree', 'A thick brown trunk with a big round leafy canopy on top.', 'Round leafy tree.', [
      part('trunk', 'cylinder', [0.3, 1.5, 0.3], GROUND, 'ground', '#5b3a1e', 'wood'),
      part('canopy', 'sphere', [1.6, 1.4, 1.6], 'trunk', 'on_top', '#3f8a35', 'organic'),
      part('canopy top', 'sphere', [1.0, 0.9, 1.0], 'canopy', 'on_top', '#4a9a3e', 'organic'),
    ]),
  },
  {
    keywords: ['house', 'cottage', 'cabin', 'hut', 'building'],
    design: design('cottage', 'Box walls with a pyramid roof on top, a door at the bottom of the front wall and two windows beside it.', 'Small cottage with a peaked roof.', [
      part('walls', 'box', [6, 3, 5], GROUND, 'ground', '#e8dcc0', 'stone'),
      part('roof', 'pyramid', [6.6, 2, 5.6], 'walls', 'on_top', '#8a3324', 'ceramic'),
      part('door', 'box', [1, 2, 0.1], 'walls', 'front', '#6b4423', 'wood', { align: 'bottom' }),
      part('window', 'box', [0.9, 0.9, 0.1], 'walls', 'front', '#9fd3f0', 'glass', { arrangement: 'pair' }),
    ]),
  },
  {
    keywords: ['car', 'vehicle', 'truck', 'automobile'],
    design: design('car', 'A long low body (pointing right) on four wheels at its corners, a smaller cabin on top toward the rear and a windshield at the cabin front.', 'Compact car.', [
      part('body', 'box', [4, 0.8, 1.8], GROUND, 'ground', '#c0392b', 'metal'),
      part('wheel', 'cylinder', [0.7, 0.3, 0.7], 'body', 'below', '#1c1c1c', 'rubber', { arrangement: 'corners', rotation: UP }),
      part('cabin', 'box', [2.2, 0.7, 1.6], 'body', 'on_top', '#c0392b', 'metal', { align: 'left' }),
      part('windshield', 'box', [0.1, 0.55, 1.4], 'cabin', 'right', '#9fd3f0', 'glass'),
    ]),
  },
  {
    keywords: ['potion', 'bottle', 'flask', 'vial'],
    design: design('potion bottle', 'A round glass flask with a narrow neck on top and a cork in the neck.', 'Round potion flask with a cork.', [
      part('flask', 'sphere', [0.12, 0.12, 0.12], GROUND, 'ground', '#8e44ad', 'glass'),
      part('neck', 'cylinder', [0.035, 0.06, 0.035], 'flask', 'on_top', '#d8eef5', 'glass'),
      part('cork', 'cylinder', [0.04, 0.025, 0.04], 'neck', 'on_top', '#a0703c', 'wood'),
    ]),
  },
  {
    keywords: ['mushroom', 'toadstool', 'fungus'],
    design: design('mushroom', 'A pale stem with a wide dome cap on top and white spots on the top and front of the cap.', 'Red-capped toadstool.', [
      part('stem', 'cylinder', [0.12, 0.25, 0.12], GROUND, 'ground', '#efe6d2', 'organic'),
      part('cap', 'dome', [0.4, 0.18, 0.4], 'stem', 'on_top', '#c0392b', 'organic'),
      part('top spot', 'sphere', [0.08, 0.03, 0.08], 'cap', 'on_top', '#ffffff', 'organic'),
      part('front spot', 'sphere', [0.06, 0.06, 0.03], 'cap', 'front', '#ffffff', 'organic'),
    ]),
  },
  {
    keywords: ['shield', 'buckler'],
    design: design('round shield', 'A round wooden board standing upright, a metal rim around it and a domed boss in the middle of the front.', 'Round wooden shield with a metal boss.', [
      part('board', 'cylinder', [0.6, 0.04, 0.6], GROUND, 'ground', '#8b5a2b', 'wood', { rotation: UP }),
      part('rim', 'torus', [0.62, 0.035, 0.62], 'board', 'center', '#7f8c8d', 'metal', { rotation: UP }),
      part('boss', 'dome', [0.15, 0.07, 0.15], 'board', 'front', '#bdc3c7', 'metal', { rotation: UP }),
    ]),
  },
  {
    keywords: ['crown', 'tiara'],
    design: design('golden crown', 'A golden ring band with pointed spikes around its top edge and a red gem on the front.', 'Golden crown with a ruby.', [
      part('band', 'cylinder', [0.2, 0.06, 0.2], GROUND, 'ground', '#d4af37', 'metal'),
      part('spike', 'cone', [0.035, 0.07, 0.035], 'band', 'on_top', '#d4af37', 'metal', { arrangement: 'ring6' }),
      part('gem', 'sphere', [0.03, 0.03, 0.02], 'band', 'front', '#c0392b', 'crystal'),
    ]),
  },
  {
    keywords: ['rocket', 'spaceship', 'missile'],
    design: design('rocket', 'A tall capsule body with a cone nose on top, crossed fins at the bottom and a round window on the front.', 'Retro rocket with fins.', [
      part('body', 'capsule', [0.6, 3, 0.6], GROUND, 'ground', '#ecf0f1', 'metal'),
      part('nose', 'cone', [0.6, 0.8, 0.6], 'body', 'on_top', '#c0392b', 'metal'),
      part('fin', 'box', [1.3, 0.6, 0.06], 'body', 'center', '#c0392b', 'metal', { align: 'bottom' }),
      part('side fin', 'box', [0.06, 0.6, 1.3], 'body', 'center', '#c0392b', 'metal', { align: 'bottom' }),
      part('window', 'sphere', [0.25, 0.25, 0.1], 'body', 'front', '#7fd3f7', 'glass'),
    ]),
  },
];

/** True when the prompt mentions an object the library knows (a sure sign it names an object, not just a style). */
export function mentionsKnownObject(tokens: string[]): boolean {
  return LIBRARY.some((e) => e.keywords.some((k) => k.split(' ').every((w) => tokens.includes(w))));
}

/** The examples shown when nothing in the library resembles the prompt (varied structures). */
const DEFAULT_EXAMPLES = ['wooden table', 'street lamp', 'coffee mug'];

/**
 * Picks the `count` library designs most similar to the prompt, topping up with
 * structurally varied defaults so the model always sees `count` examples.
 */
export function pickLibraryExamples(promptTokens: string[], similarity: (a: string[], b: string[]) => number, tokenize: (s: string) => string[], count = 3) {
  const scored = LIBRARY.map((entry) => ({
    entry,
    score: Math.max(...entry.keywords.map((k) => similarity(promptTokens, tokenize(k)))),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((s) => s.entry.design);
  for (const name of DEFAULT_EXAMPLES) {
    if (scored.length >= count) break;
    const d = LIBRARY.find((e) => e.design.name === name)!.design;
    if (!scored.includes(d)) scored.push(d);
  }
  return scored;
}
