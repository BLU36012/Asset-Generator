import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OpenverseProvider, USER_AGENT, WikimediaProvider, type ReferenceCandidate, type ReferenceProvider } from './providers';

export type { ReferenceCandidate, ReferenceProvider } from './providers';

/** Searches openly licensed image sites and downloads candidate images. */
export interface ReferenceFinder {
  search(query: string, limit?: number): Promise<ReferenceCandidate[]>;
  fetchImage(url: string): Promise<Buffer>;
}

/**
 * Only image hosts of the providers we query are fetched from, so a crafted
 * search result can't make the server request arbitrary URLs.
 */
const ALLOWED_IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org', 'api.openverse.org']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export class WebReferenceFinder implements ReferenceFinder {
  private searches = new Map<string, { at: number; results: ReferenceCandidate[] }>();

  constructor(
    private providers: ReferenceProvider[],
    private cacheDir: string | null,
    private timeoutMs = 10_000,
  ) {
    if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  }

  /** Queries every provider in parallel and interleaves their rankings; a failing provider is skipped. */
  async search(query: string, limit = 16): Promise<ReferenceCandidate[]> {
    const key = `${query.toLowerCase()}|${limit}`;
    const cached = this.searches.get(key);
    if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results;

    const per = Math.ceil(limit / this.providers.length) + 2;
    const lists = await Promise.all(this.providers.map((p) => p.search(query, per).catch(() => [] as ReferenceCandidate[])));
    const seen = new Set<string>();
    const merged: ReferenceCandidate[] = [];
    for (let i = 0; merged.length < limit && lists.some((l) => i < l.length); i++) {
      for (const list of lists) {
        const c = list[i];
        if (c && !seen.has(c.info.imageUrl) && merged.length < limit) {
          seen.add(c.info.imageUrl);
          merged.push({ ...c, rank: merged.length });
        }
      }
    }
    if (merged.length) {
      this.searches.set(key, { at: Date.now(), results: merged });
      if (this.searches.size > 300) this.searches.delete(this.searches.keys().next().value!);
    }
    return merged;
  }

  async fetchImage(url: string): Promise<Buffer> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) throw new Error(`Refusing to fetch from ${parsed.hostname}`);

    const file = this.cacheDir ? join(this.cacheDir, createHash('sha1').update(url).digest('hex')) : null;
    if (file) {
      try {
        return await readFile(file);
      } catch {
        // not cached yet
      }
    }

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow' });
    const finalHost = new URL(res.url || url).hostname;
    if (!ALLOWED_IMAGE_HOSTS.has(finalHost)) throw new Error(`Redirected to an unexpected host (${finalHost})`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('Not an image');
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error('Image too large');

    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('Image too large');
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (file) await writeFile(file, data).catch(() => undefined);
    return data;
  }
}

export function referenceFinderFromEnv(cacheDir: string, env: NodeJS.ProcessEnv = process.env): ReferenceFinder | null {
  if (env.REFERENCES === 'off') return null;
  return new WebReferenceFinder([new WikimediaProvider(), new OpenverseProvider()], cacheDir);
}
