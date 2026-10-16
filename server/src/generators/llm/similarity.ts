const STOP_WORDS = new Set(
  'a an the of with and or for in on to at by from my some very that this is it its make create generate draw design build me please model asset sprite 3d 2d'.split(' '),
);

/** Normalized content words of a prompt ("Rusty old Keys!" → ["rusty", "old", "key"]). */
export function promptTokens(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    out.add(w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return [...out];
}

/** Jaccard overlap of two token sets, 0..1. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const inter = a.filter((t) => setB.has(t)).length;
  return inter / (a.length + b.length - inter);
}
