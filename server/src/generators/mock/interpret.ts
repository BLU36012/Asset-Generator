import type { ReferenceInfo } from '@asset-gen/shared';
import type { Blueprint } from '../llm/blueprint';
import type { GenerationInfo, Rgb } from '../types';
import type { ImageAnalysis, Outline } from './imageAnalysis';
import type { Modifiers, ParsedPrompt, Shape, Surface } from './promptParser';

export interface Band {
  /** Bottom-up fractions of the object's height. */
  from: number;
  to: number;
  color: Rgb;
}

export interface Regions {
  cols: number;
  rows: number;
  /** Palette index per cell (row 0 = top), 255 = empty. */
  cells: Uint8Array;
  palette: Rgb[];
}

export type Form =
  | { kind: 'preset'; shape: Shape }
  /** Symmetric object: spin its half-width profile around the vertical axis. */
  | { kind: 'revolve'; profile: { y: number; r: number }[]; bands: Band[] }
  /** Boxy object: a box with the photo's proportions. */
  | { kind: 'box'; aspect: number; bands: Band[] }
  /** Mostly symmetric with extra parts (a mug's handle): revolve the core, extrude the parts. */
  | {
      kind: 'composite';
      profile: { y: number; r: number }[];
      bands: Band[];
      appendages: { outline: Outline; color: Rgb; thickness: number }[];
    }
  /** Flat requested: push the outline out into a slab with painted color regions. */
  | { kind: 'extrude'; shapes: Outline[]; bounds: ImageAnalysis['bounds']; regions: Regions }
  /** Limbed or irregular object: inflate the silhouette into a rounded body with painted color regions. */
  | { kind: 'inflate'; mask: ImageAnalysis['mask']; shapes: Outline[]; bounds: ImageAnalysis['bounds']; regions: Regions }
  /** Designed part-by-part by the text model (or reused from a liked result). */
  | { kind: 'blueprint'; blueprint: Blueprint };

/** A blueprint obtained before interpretation, and where it came from. */
export interface Design {
  blueprint: Blueprint;
  source: 'text-model' | 'feedback-reuse';
  model: string | null;
  /** For feedback-reuse: the prompt the liked design was made for. */
  fromPrompt?: string;
}

/** Everything the builders need, decided from text + image with text taking priority. */
export interface AssetSpec {
  form: Form;
  primary: Rgb | null;
  accent: Rgb | null;
  /** null = let the builder pick the shape's natural material. */
  surface: Surface | null;
  modifiers: Modifiers;
  /** Photo's height/width, used to nudge preset proportions when the text gives none. */
  imageAspect: number | null;
  scale: number;
  pixelArt: boolean;
  seed: number;
  name: string;
  words: string[];
  /** How each decision was made, shown to the user. */
  notes: string[];
  generation: GenerationInfo;
  /** Real-world size for image-derived forms of known subjects (e.g. a person is 1.75 m tall). */
  targetSize?: { size: number; dim: 'height' | 'length' };
  /** Inflated thickness relative to a round cross-section (default 0.7; flat objects like rifles ~0.4). */
  inflateDepth?: number;
}

const PRESETS: Shape[] = ['crate', 'barrel', 'orb', 'cone', 'tree', 'rock', 'pillar', 'coin', 'gem', 'mushroom', 'house', 'sword', 'potion', 'star', 'heart'];

/** Pick the image that separated most cleanly; the first image gets a small tie-break bonus. */
export function pickAnalysis(analyses: ImageAnalysis[]): { analysis: ImageAnalysis; index: number } | null {
  let best: { analysis: ImageAnalysis; index: number } | null = null;
  let bestScore = -Infinity;
  for (const [index, analysis] of analyses.entries()) {
    const score = analysis.confidence + (analysis.hasObject ? 0.5 : 0) + (index === 0 ? 0.1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { analysis, index };
    }
  }
  return best;
}

const toHex = (c: Rgb) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

/** Plain-language summary of the best reference image, given to the text model as context. */
export function describeImageForModel(analyses: ImageAnalysis[]): string | null {
  const a = pickAnalysis(analyses)?.analysis;
  if (!a) return null;
  const colors = a.palette
    .slice(0, 4)
    .map((p) => `${toHex(p.color)} (${Math.round(p.weight * 100)}%)`)
    .join(', ');
  if (!a.hasObject || a.confidence < 0.15) return `main colors ${colors}; the object's outline could not be isolated.`;
  const proportion = a.aspect > 1.3 ? 'tall' : a.aspect < 0.77 ? 'wide' : 'compact';
  const holes = a.shapes.some((s) => s.holes.length > 0);
  return [
    `a ${proportion} object about ${a.aspect.toFixed(2)}x as tall as it is wide`,
    a.symmetry >= 0.82 ? 'left-right symmetric' : 'asymmetric',
    a.appendages.length ? `with ${a.appendages.length} part(s) sticking out to the side (like a handle)` : '',
    holes ? 'with an opening through it' : '',
    `main colors ${colors}`,
    a.surfaceGuess ? `looks like ${a.surfaceGuess}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export interface InterpretOptions {
  /** Where the image analyses came from; changes the wording of the notes. */
  imageSource?: 'upload' | 'reference';
  /** Attribution for a web reference image. */
  reference?: ReferenceInfo | null;
  /** Organic/limbed subject (people, animals): inflate the silhouette instead of spinning it. */
  organic?: boolean;
}

export function interpret(
  parsed: ParsedPrompt,
  analyses: ImageAnalysis[],
  mode: '3d' | '2d',
  design: Design | null = null,
  opts: InterpretOptions = {},
): AssetSpec {
  const notes: string[] = [];
  const picked = pickAnalysis(analyses);
  const img = picked?.analysis ?? null;
  const usable = Boolean(img?.hasObject && img.confidence >= 0.15);
  const imagePalette = img?.palette.map((p) => p.color) ?? [];
  const isRef = opts.imageSource === 'reference';
  const imageWord = isRef ? 'the web reference image' : 'your image';
  const flat = (parsed.modifiers.thickness ?? 1) < 1;

  // ----- Colors: text first, then the image -----
  const primary = parsed.color ?? imagePalette[0] ?? null;
  const accent = parsed.accent ?? (img ? (imagePalette[1] ?? null) : null);
  /** Palette as the builders should use it: text colors replace the image's top two. */
  const effectivePalette = imagePalette.map((c, i) => (i === 0 && parsed.color ? parsed.color : i === 1 && parsed.accent ? parsed.accent : c));
  const infer = () => inferForm(img!, effectivePalette, { organic: opts.organic ?? false, flat });

  // ----- Form: text first (model blueprint, then keywords), otherwise infer from the image -----
  let form: Form;
  const useBlueprint = design && (design.blueprint.textNamesObject || !usable);
  if (design && useBlueprint) {
    form = { kind: 'blueprint', blueprint: design.blueprint };
    const what = design.blueprint.summary || design.blueprint.name;
    notes.push(
      design.source === 'text-model'
        ? `Designed from your text by the ${design.model} text model: ${what} (${design.blueprint.parts.length} parts).`
        : `The text model is offline, so a design that was liked for "${design.fromPrompt}" was reused: ${what}.`,
    );
    if (usable) notes.push('Your text named the object, so the image was only a hint for its colors and proportions.');
  } else if (design && usable) {
    form = infer();
    notes.push(`The text model read your text as a style rather than an object, so the shape comes from ${imageWord}.`);
    notes.push(describeForm(img!, form, mode, imageWord));
  } else if (parsed.shape && !isRef) {
    form = { kind: 'preset', shape: parsed.shape };
    notes.push(`Shape from your text: ${parsed.shape}.`);
    if (usable) notes.push("Your text decided the shape, so the image's outline was not used.");
  } else if (img && usable) {
    form = infer();
    if (isRef && opts.reference) {
      notes.push(`Found a reference image online for your text: "${opts.reference.title}" (${opts.reference.provider}).`);
    }
    notes.push(describeForm(img, form, mode, imageWord));
  } else {
    const shape = PRESETS[parsed.seed % PRESETS.length];
    form = { kind: 'preset', shape };
    notes.push(
      img
        ? `Couldn't separate an object from the image's background, so no outline was used; picked a ${shape} and took the image's colors.`
        : `No shape keyword found, so a ${shape} was picked for you.`,
    );
  }

  if (analyses.length > 1 && picked && usable && !isRef) {
    notes.push(`Analyzed ${analyses.length} images and used #${picked.index + 1}, which had the clearest outline.`);
  }

  // ----- Material -----
  // A material guessed from a web photo (a gray silhouette reads as "stone") is unreliable, so only uploads count.
  const surface: Surface | null = parsed.surface !== 'plain' ? parsed.surface : isRef ? null : (img?.surfaceGuess ?? null);

  // ----- Summary of text influence -----
  const textBits: string[] = [];
  if (form.kind === 'blueprint') {
    // The model already handled colors, materials and proportions; only these are applied on top.
    const applied = ['low-poly', 'smooth', 'shiny', 'matte', 'glowing', 'rusty', 'mossy', 'larger', 'smaller'];
    textBits.push(...parsed.modifierWords.filter((w) => applied.includes(w)));
  } else {
    if (parsed.colorWords.length) textBits.push(`color ${parsed.colorWords.slice(0, 2).join(' + ')}`);
    if (parsed.surface !== 'plain') textBits.push(`material ${parsed.surfaceWord ?? parsed.surface}`);
    textBits.push(...parsed.modifierWords);
  }
  if (parsed.pixelArt && mode === '2d') textBits.push('pixel-art');
  if (textBits.length) notes.push(`${form.kind === 'blueprint' ? 'Style words applied' : 'From your text'}: ${textBits.join(', ')}.`);

  // A blueprint's colors come from the model, so the image contributes nothing directly.
  const imageBits: string[] = [];
  if (form.kind !== 'blueprint' && img) {
    if (!parsed.color && imagePalette.length) imageBits.push(imagePalette.length === 1 ? 'main color' : `${Math.min(imagePalette.length, 4)}-color palette`);
    else if (parsed.color && !parsed.accent && imagePalette.length > 1) imageBits.push('accent color');
    if (parsed.surface === 'plain' && img.surfaceGuess && !isRef) imageBits.push(`${img.surfaceGuess} look`);
    if (usable && parsed.shape && !isRef && parsed.modifiers.height === null && parsed.modifiers.width === null) imageBits.push('proportions');
  }
  if (imageBits.length) notes.push(`From ${isRef ? 'the reference image' : 'your image'}: ${imageBits.join(', ')}.`);

  const reference = isRef && form.kind !== 'blueprint' && form.kind !== 'preset' ? (opts.reference ?? null) : null;
  const generation: GenerationInfo =
    form.kind === 'blueprint'
      ? { source: design!.source, model: design!.model, form: 'blueprint', blueprint: design!.blueprint, reference: null }
      : {
          source: form.kind === 'preset' ? 'keywords' : reference ? 'web-reference' : 'image',
          model: null,
          form: form.kind === 'preset' ? `preset:${form.shape}` : form.kind,
          blueprint: null,
          reference,
        };

  return {
    form,
    primary,
    accent,
    surface,
    modifiers: parsed.modifiers,
    imageAspect: usable && img && !isRef ? img.aspect : null,
    scale: parsed.scale,
    pixelArt: parsed.pixelArt,
    seed: parsed.seed,
    name:
      form.kind === 'blueprint'
        ? form.blueprint.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || parsed.name
        : parsed.name === 'asset' && form.kind !== 'preset'
          ? `${form.kind}-model`
          : parsed.name,
    words: parsed.words,
    notes,
    generation,
  };
}

function inferForm(img: ImageAnalysis, palette: Rgb[], opts: { organic: boolean; flat: boolean }): Form {
  const bands = img.bands.map((b) => ({ from: b.from, to: b.to, color: palette[b.index] ?? palette[0] }));
  const regions = { ...img.regions, palette };
  const holes = img.shapes.some((s) => s.holes.length > 0);
  const solidPiece = img.shapes.length === 1 && !holes;
  const inflate: Form = { kind: 'inflate', mask: img.mask, shapes: img.shapes, bounds: img.bounds, regions };

  // "flat"/"cutout" in the text asks for a crisp slab rather than a rounded volume.
  if (opts.flat) return { kind: 'extrude', shapes: img.shapes, bounds: img.bounds, regions };
  // People, animals and other limbed subjects are never solids of revolution.
  if (opts.organic) return inflate;
  if (img.fill > 0.88 && img.symmetry > 0.8 && solidPiece) return { kind: 'box', aspect: img.aspect, bands };
  // Spinning only suits compact symmetric outlines (vases, bottles); limbs and openings would be lost.
  const spinnable = !holes && img.solidity >= 0.82;
  if (img.symmetry >= 0.9 && spinnable) return { kind: 'revolve', profile: img.profile, bands };
  if (img.coreFraction >= 0.55 && img.appendages.length && img.solidity >= 0.6) {
    return {
      kind: 'composite',
      profile: img.profile,
      bands,
      appendages: img.appendages.map((a) => ({ outline: a.outline, color: palette[a.index] ?? palette[0], thickness: a.thickness })),
    };
  }
  if (img.symmetry >= 0.82 && spinnable) return { kind: 'revolve', profile: img.profile, bands };
  return inflate;
}

function describeForm(img: ImageAnalysis, form: Form, mode: '3d' | '2d', imageWord: string): string {
  const proportion = img.aspect > 1.3 ? 'tall' : img.aspect < 0.77 ? 'wide' : 'compact';
  const symmetry = `symmetry ${Math.round(img.symmetry * 100)}%`;
  const holes = img.shapes.reduce((n, s) => n + s.holes.length, 0);
  const extras = [img.shapes.length > 1 && `${img.shapes.length} separate pieces`, holes && `${holes} opening(s)`].filter(Boolean).join(', ');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const read = `Read ${imageWord} as`;

  switch (form.kind) {
    case 'revolve':
      return mode === '3d'
        ? `${read} a ${proportion}, symmetric object (${symmetry}) and spun its profile into a round 3D form with ${plural(form.bands.length, 'color band')}.`
        : `${read} a ${proportion}, symmetric object (${symmetry}) and redrew it as a symmetric sprite with ${plural(form.bands.length, 'color band')}.`;
    case 'box':
      return `${read} a ${proportion}, boxy object and ${mode === '3d' ? 'built a box' : 'drew a boxy sprite'} with its proportions and ${plural(form.bands.length, 'color band')}.`;
    case 'composite':
      return mode === '3d'
        ? `${read} a symmetric body with ${plural(form.appendages.length, 'attached part')} (like a handle or arm): spun the body into a round form and extruded the ${form.appendages.length === 1 ? 'part' : 'parts'} onto it.`
        : `${read} a symmetric body with ${plural(form.appendages.length, 'attached part')} and redrew both as a sprite.`;
    case 'inflate':
      return `${read} a ${proportion} object (${symmetry}${extras ? `, ${extras}` : ''}) and ${
        mode === '3d' ? 'inflated its silhouette into a rounded 3D body (thick where it is wide, thin at limbs and edges)' : 'redrew its silhouette as a sprite'
      }, painted with ${plural(form.regions.palette.length, 'color region')}.`;
    case 'extrude':
      return `${read} a ${proportion} object (${symmetry}${extras ? `, ${extras}` : ''}) and ${
        mode === '3d' ? 'extruded its outline into a flat solid' : 'redrew its outline as a sprite'
      }, painted with ${plural(form.regions.palette.length, 'color region')}.`;
    default:
      return '';
  }
}
