import { mentionsKnownObject } from '../llm/library';
import { promptTokens } from '../llm/similarity';
import type { AssetGenerator, GeneratorInput, InputImage } from '../types';
import { analyzeImage, type ImageAnalysis } from './imageAnalysis';
import { decodeImage } from './images';
import { describeImageForModel, interpret, type AssetSpec, type Design, type InterpretOptions } from './interpret';
import { buildMesh } from './mesh3d';
import { parsePrompt } from './promptParser';
import { pickReference } from './referencePick';
import { buildSprite } from './sprite2d';
import { findSubject, queryVariants, searchQuery } from './subjects';

async function analyzeAll(images: InputImage[]): Promise<ImageAnalysis[]> {
  return Promise.all(images.map(async (img) => analyzeImage(await decodeImage(img))));
}

/**
 * Builds the AssetSpec for one request:
 *  1. your own photos/video frames, if any, are the image reference;
 *  2. otherwise, for objects that primitives model poorly (people, animals,
 *     rifles…), an openly licensed reference image is found online;
 *  3. otherwise the text model designs a parts blueprint, guided by feedback;
 *  4. otherwise a liked design is reused, or keywords are used;
 * and everything is merged with the text taking priority.
 */
async function plan(input: GeneratorInput, mode: '3d' | '2d'): Promise<AssetSpec> {
  const parsed = parsePrompt(input.prompt);
  const tokens = promptTokens(input.prompt);
  const subject = findSubject(tokens);
  const feedback = input.feedback ?? { examples: [], reusable: null, repeatDislikes: 0, likedReferences: [], rejectedReferences: [] };
  const notes: string[] = [];
  let analyses = await analyzeAll(input.images);
  // Known hard subjects (people, animals, guitars, rifles…) are inflated rather than spun.
  const opts: InterpretOptions = { imageSource: 'upload', organic: Boolean(subject) };

  // ----- Web reference images (text-only prompts) -----
  const referenceMode = input.referenceMode ?? 'auto';
  const knownObject = Boolean(parsed.shape) || mentionsKnownObject(tokens);
  const wantReference =
    input.prompt.trim() !== '' && input.images.length === 0 && input.references && referenceMode !== 'never' && (referenceMode === 'always' || !knownObject);
  if (wantReference) {
    const base = searchQuery(tokens);
    try {
      const { pick, searched, analyzed, query } = await pickReference(input.references!, queryVariants(base, subject), {
        liked: feedback.likedReferences,
        rejected: feedback.rejectedReferences,
        context: { words: base.split(' '), subject },
      });
      if (pick) {
        analyses = [pick.analysis];
        opts.imageSource = 'reference';
        opts.reference = pick.info;
        notes.push(`Searched openly licensed images for "${query}" (${searched} found, ${analyzed} analyzed) and modeled the cleanest one.`);
        if (feedback.rejectedReferences.length) notes.push(`Skipped ${feedback.rejectedReferences.length} reference image(s) that were disliked before.`);
      } else {
        notes.push(`Searched online for "${base}" but found no clean, isolated reference image (${analyzed} analyzed), so it was designed without one.`);
      }
    } catch (err) {
      notes.push(`Reference image search failed (${err instanceof Error ? err.message : 'network error'}), so it was designed without one.`);
    }
  }
  const usingReference = opts.imageSource === 'reference';

  // ----- Text model blueprint (skipped when a reference image already gives the shape) -----
  let design: Design | null = null;
  if (input.prompt.trim() && input.textModel && !usingReference) {
    const status = await input.textModel.status();
    if (status.available) {
      try {
        const blueprint = await input.textModel.design({
          prompt: input.prompt.trim(),
          mode,
          imageSummary: describeImageForModel(analyses),
          examples: feedback.examples,
        });
        // Small models sometimes call "steampunk lantern" a mere style; a known object or shape word overrules that.
        if (!blueprint.textNamesObject && (knownObject || subject)) blueprint.textNamesObject = true;
        design = { blueprint, source: 'text-model', model: input.textModel.model };
      } catch (err) {
        notes.push(`The text model failed (${err instanceof Error ? err.message : 'unknown error'}), so keywords were used instead.`);
      }
    } else {
      notes.push(`Text model unavailable: ${status.reason} Using keyword matching instead.`);
    }
  }

  if (!design && !usingReference && feedback.reusable) {
    design = { blueprint: feedback.reusable.blueprint, source: 'feedback-reuse', model: null, fromPrompt: feedback.reusable.prompt };
  }

  // Each repeat dislike of the same prompt shifts the keyword generator to a different variation.
  if (!design && !usingReference && feedback.repeatDislikes > 0) {
    parsed.seed = (parsed.seed + feedback.repeatDislikes * 7919) >>> 0;
    notes.push(`You disliked ${feedback.repeatDislikes} earlier result(s) for this prompt, so a different variation was picked.`);
  }

  const spec = interpret(parsed, analyses, mode, design, opts);
  if (subject && spec.form.kind !== 'blueprint' && spec.form.kind !== 'preset') {
    spec.targetSize = { size: subject.size, dim: subject.dim };
    spec.inflateDepth = subject.depth;
  }

  const used = feedback.examples.length;
  if (used && design?.source === 'text-model') {
    const liked = feedback.examples.filter((e) => e.liked).length;
    const own = feedback.examples.filter((e) => e.own).length;
    notes.push(
      `Guided by ${used} rated result(s) for similar prompts (${liked} liked, ${used - liked} disliked${own ? `; ${own} of them yours` : ''}).`,
    );
  }
  // Search/model notes read best before the interpretation details.
  spec.notes.splice(usingReference ? 0 : spec.notes.length, 0, ...notes);
  return spec;
}

/**
 * Offline-first asset generator: designs objects from text with a server-side
 * language model, models objects from your photos or from openly licensed web
 * references, and builds meshes or sprites procedurally.
 */
export const mockGenerator: AssetGenerator = {
  id: 'mock',

  async generate3D(input) {
    return buildMesh(await plan(input, '3d'), { maxTextureSize: input.engine.maxTextureSize });
  },

  async generate2D(input) {
    return buildSprite(await plan(input, '2d'), { size: input.size, frameCount: input.frameCount });
  },
};
