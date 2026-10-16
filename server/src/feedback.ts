import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { nowIso } from './db';
import { sanitizeBlueprint, type Blueprint } from './generators/llm/blueprint';
import type { FeedbackExample } from './generators/llm/prompt';
import type { FeedbackContext, GenerationInfo } from './generators/types';

import { promptTokens, similarity } from './generators/llm/similarity';

export { promptTokens, similarity };

interface FeedbackRow {
  id: string;
  asset_id: string;
  user_id: string | null;
  prompt: string;
  mode: string;
  liked: number;
  comment: string | null;
  generation_json: string | null;
  created_at: string;
}

export interface FeedbackInput {
  assetId: string;
  userId: string | null;
  prompt: string;
  mode: string;
  liked: boolean;
  comment: string | null;
  generation: GenerationInfo | null;
}

/** One vote per asset per voter (guests share one slot per asset); voting again replaces it. */
export function recordFeedback(db: Db, f: FeedbackInput): void {
  db.prepare('DELETE FROM feedback WHERE asset_id = ? AND user_id IS ?').run(f.assetId, f.userId);
  db.prepare(
    `INSERT INTO feedback (id, asset_id, user_id, prompt, mode, liked, comment, generation_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), f.assetId, f.userId, f.prompt, f.mode, f.liked ? 1 : 0, f.comment, f.generation ? JSON.stringify(f.generation) : null, nowIso());
}

export function myFeedback(db: Db, assetId: string, userId: string | null): 'like' | 'dislike' | null {
  const row = db.prepare('SELECT liked FROM feedback WHERE asset_id = ? AND user_id IS ?').get(assetId, userId) as { liked: number } | undefined;
  return row ? (row.liked ? 'like' : 'dislike') : null;
}

function parseBlueprint(json: string | null): Blueprint | null {
  if (!json) return null;
  try {
    const gen = JSON.parse(json) as GenerationInfo;
    return gen.blueprint ? sanitizeBlueprint(gen.blueprint) : null;
  } catch {
    return null;
  }
}

const OWN_WEIGHT = 3;
const HALF_LIFE_DAYS = 60;
const MIN_SIMILARITY = 0.25;
const REUSE_SIMILARITY = 0.6;
const REPEAT_SIMILARITY = 0.8;

/**
 * Finds ratings for prompts similar to this one. The current user's ratings
 * count three times as much as everyone else's, and older ratings fade.
 */
export function feedbackContext(db: Db, q: { prompt: string; mode: string; userId: string | null }): FeedbackContext {
  const empty: FeedbackContext = { examples: [], reusable: null, repeatDislikes: 0, likedReferences: [], rejectedReferences: [] };
  const tokens = promptTokens(q.prompt);
  if (!tokens.length) return empty;

  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 2000').all() as unknown as FeedbackRow[];
  const now = Date.now();
  const scored = rows
    .map((row) => {
      const sim = similarity(tokens, promptTokens(row.prompt));
      if (sim < MIN_SIMILARITY) return null;
      const own = q.userId !== null && row.user_id === q.userId;
      const ageDays = (now - Date.parse(row.created_at)) / 86_400_000;
      const weight = sim * (own ? OWN_WEIGHT : 1) * 0.5 ** (ageDays / HALF_LIFE_DAYS) * (row.mode === q.mode ? 1 : 0.7);
      return { row, sim, own, weight, blueprint: parseBlueprint(row.generation_json) };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.weight - a.weight);
  if (!scored.length) return empty;

  const toExample = (s: (typeof scored)[number]): FeedbackExample => ({
    prompt: s.row.prompt,
    liked: s.row.liked === 1,
    blueprint: s.blueprint,
    comment: s.row.comment,
    own: s.own,
  });
  const liked = scored.filter((s) => s.row.liked === 1).slice(0, 3);
  const disliked = scored.filter((s) => s.row.liked === 0).slice(0, 3);

  // Never reuse a design that was later disliked (e.g. after it was reused once already).
  const rejected = new Set(disliked.filter((s) => s.blueprint).map((s) => JSON.stringify(s.blueprint)));
  const reuse = scored.find((s) => s.row.liked === 1 && s.blueprint && s.sim >= REUSE_SIMILARITY && !rejected.has(JSON.stringify(s.blueprint)));

  const repeatDislikes = scored.filter((s) => s.row.liked === 0 && s.sim >= REPEAT_SIMILARITY && s.row.user_id === q.userId && s.row.mode === q.mode).length;

  // Web reference images rated for (nearly) the same prompt: liked ones are tried first, disliked ones skipped.
  const referenceOf = (s: (typeof scored)[number]) => {
    try {
      return (JSON.parse(s.row.generation_json ?? 'null') as GenerationInfo | null)?.reference?.imageUrl ?? null;
    } catch {
      return null;
    }
  };
  const close = scored.filter((s) => s.sim >= REUSE_SIMILARITY);
  const rejectedReferences = [...new Set(close.filter((s) => s.row.liked === 0).map(referenceOf).filter((u): u is string => !!u))];
  const likedReferences = [
    ...new Set(close.filter((s) => s.row.liked === 1).map(referenceOf).filter((u): u is string => !!u && !rejectedReferences.includes(u))),
  ];

  return {
    examples: [...liked, ...disliked].map(toExample),
    reusable: reuse ? { prompt: reuse.row.prompt, blueprint: reuse.blueprint! } : null,
    repeatDislikes,
    likedReferences,
    rejectedReferences,
  };
}
