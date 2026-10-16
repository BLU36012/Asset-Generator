import type { ReferenceInfo } from '@asset-gen/shared';
import type { ReferenceFinder } from '../../references';
import { analyzeImage, type ImageAnalysis } from './imageAnalysis';
import { decodeImage } from './images';
import { fitsSilhouette, type Subject } from './subjects';

export interface PickedReference {
  analysis: ImageAnalysis;
  info: ReferenceInfo;
  /** How many candidates were downloaded and analyzed. */
  analyzed: number;
}

/** Below this score no candidate is clean enough to model from. */
const MIN_SCORE = 0.95;
const MAX_ANALYZED = 10;

/** Titles that describe pictures of things other than a single object. */
const NOT_AN_OBJECT = /\b(map|maps|diagram|chart|graph|logo|flag|coat of arms|emblem|symbol|icon set|infographic|screenshot|poster|collage|crowd|group)\b/i;

export interface ScoreContext {
  /** Content words of the search ("knight", "rifle"); relevant titles mention one. */
  words: string[];
  subject: Subject | null;
}

/**
 * Scores how usable a candidate is as a modeling reference: a single clearly
 * separated object, fully in frame (transparent cutouts are best), shaped like
 * the subject and titled like it, with the search ranking as a tie-breaker.
 * Returns -1 for candidates that should never be used.
 */
export function referenceScore(a: ImageAnalysis, info: ReferenceInfo, rank: number, total: number, ctx: ScoreContext): number {
  if (!a.hasObject || a.confidence < 0.45) return -1;
  if (NOT_AN_OBJECT.test(info.title)) return -1;
  if (!fitsSilhouette(ctx.subject, a.aspect, a.fill)) return -1;
  // An "object" covering most of the frame is really a scene (often a framed photo).
  if (a.areaFraction > 0.75) return -1;
  // Spanning nearly the whole picture both ways means a framed photo or a scene, not one object.
  if (a.bboxCover.w > 0.9 && a.bboxCover.h > 0.9) return -1;
  // People and animals never fill their bounding box; a filled box means the cutout failed.
  if (ctx.subject?.organic && a.fill > 0.8) return -1;
  const title = info.title.toLowerCase();
  const relevant = ctx.words.some((w) => title.includes(w)) || (ctx.subject?.words.some((w) => title.includes(w)) ?? false);
  // A large second piece means two objects in the picture, or a cutout that broke apart
  // (e.g. a white shirt lost against a white background, detaching the head).
  const second = a.pieceAreas[1] ?? 0;
  return (
    a.confidence +
    (a.edgeTouches === 0 ? 0.35 : -0.25 * a.edgeTouches) +
    (a.fromAlpha ? 0.3 : 0) +
    (second > 0.12 ? -0.8 : second > 0.04 ? -0.25 : 0.15) +
    (relevant ? 0.2 : -0.35) +
    0.25 * (1 - rank / Math.max(1, total))
  );
}

/**
 * Searches the web for openly licensed images of `query`, downloads the most
 * relevant candidates and returns the one whose silhouette is cleanest.
 * Previously disliked references are skipped and liked ones are preferred.
 */
export async function pickReference(
  finder: ReferenceFinder,
  queries: string[],
  opts: { liked: string[]; rejected: string[]; context: ScoreContext },
): Promise<{ pick: PickedReference | null; searched: number; analyzed: number; query: string }> {
  let searched = 0;
  let analyzed = 0;
  const tried = new Set<string>();
  for (const query of queries) {
    const r = await pickFromQuery(finder, query, opts, tried);
    searched += r.searched;
    analyzed += r.analyzed;
    if (r.pick) return { pick: r.pick, searched, analyzed, query };
  }
  return { pick: null, searched, analyzed, query: queries[0] };
}

async function pickFromQuery(
  finder: ReferenceFinder,
  query: string,
  opts: { liked: string[]; rejected: string[]; context: ScoreContext },
  tried: Set<string>,
): Promise<{ pick: PickedReference | null; searched: number; analyzed: number }> {
  // Images already analyzed for an earlier phrasing aren't downloaded again.
  const all = (await finder.search(query, 16)).filter((c) => !tried.has(c.info.imageUrl));
  for (const c of all) tried.add(c.info.imageUrl);
  const candidates = all
    .filter((c) => !opts.rejected.includes(c.info.imageUrl))
    .sort((a, b) => Number(opts.liked.includes(b.info.imageUrl)) - Number(opts.liked.includes(a.info.imageUrl)))
    .slice(0, MAX_ANALYZED);

  const results = await Promise.all(
    candidates.map(async (c, i) => {
      try {
        const analysis = analyzeImage(await decodeImage({ data: await finder.fetchImage(c.info.imageUrl), mime: 'image/*' }));
        const score = referenceScore(analysis, c.info, i, candidates.length, opts.context);
        // A reference that was liked before is strongly preferred (unless it no longer qualifies).
        return { c, analysis, score: score >= 0 && opts.liked.includes(c.info.imageUrl) ? score + 1 : score };
      } catch {
        return null; // unreachable or undecodable image
      }
    }),
  );

  const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const best = ok.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < MIN_SCORE) return { pick: null, searched: all.length, analyzed: ok.length };
  return { pick: { analysis: best.analysis, info: best.c.info, analyzed: ok.length }, searched: all.length, analyzed: ok.length };
}
