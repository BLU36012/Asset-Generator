import type { ReferenceInfo } from '@asset-gen/shared';

/** Identifies this app to the image APIs, as Wikimedia's API etiquette asks. */
export const USER_AGENT = 'AssetGenerator/0.1 (game asset generator; https://github.com/BLU36012/Asset-Generator)';

export interface ReferenceCandidate {
  info: ReferenceInfo;
  /** Position in the provider's ranking (0 = most relevant). */
  rank: number;
}

export interface ReferenceProvider {
  name: ReferenceInfo['provider'];
  search(query: string, limit: number): Promise<ReferenceCandidate[]>;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

interface WikimediaPage {
  title: string;
  imageinfo?: {
    thumburl?: string;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }[];
}

/** Wikimedia Commons: millions of freely licensed photos, many of single objects. */
export class WikimediaProvider implements ReferenceProvider {
  name = 'Wikimedia Commons' as const;
  constructor(private timeoutMs = 8000) {}

  async search(query: string, limit: number): Promise<ReferenceCandidate[]> {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      // Drawings (SVG) are included: Commons serves them as rendered PNG thumbnails, and clean
      // illustrations and silhouettes make excellent references.
      gsrsearch: `${query} filetype:bitmap|drawing`,
      gsrnamespace: '6',
      gsrlimit: String(limit),
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '640',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName',
      format: 'json',
      formatversion: '2',
    });
    const body = (await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, this.timeoutMs)) as {
      query?: { pages?: (WikimediaPage & { index?: number })[] };
    };
    const pages = (body.query?.pages ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.flatMap((page, rank) => {
      const ii = page.imageinfo?.[0];
      if (!ii?.thumburl || !ii.descriptionurl || !/^image\/(jpeg|png|webp|svg\+xml)$/.test(ii.mime ?? '')) return [];
      const meta = ii.extmetadata ?? {};
      const title = stripHtml(meta.ObjectName?.value ?? '') || page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
      return [
        {
          rank,
          info: {
            title: title.slice(0, 120),
            author: stripHtml(meta.Artist?.value ?? '').slice(0, 120) || null,
            license: stripHtml(meta.LicenseShortName?.value ?? 'See source page'),
            licenseUrl: meta.LicenseUrl?.value ?? null,
            pageUrl: ii.descriptionurl,
            imageUrl: ii.thumburl,
            provider: this.name,
          },
        },
      ];
    });
  }
}

interface OpenverseResult {
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  thumbnail?: string;
}

/** Openverse: openly licensed images aggregated from Flickr, museums and more. */
export class OpenverseProvider implements ReferenceProvider {
  name = 'Openverse' as const;
  constructor(private timeoutMs = 8000) {}

  async search(query: string, limit: number): Promise<ReferenceCandidate[]> {
    // Only licenses that allow adaptations: a 3D model built from a photo is a derivative.
    const params = new URLSearchParams({ q: query, page_size: String(limit), license_type: 'modification', mature: 'false' });
    const body = (await getJson(`https://api.openverse.org/v1/images/?${params}`, this.timeoutMs)) as { results?: OpenverseResult[] };
    return (body.results ?? []).flatMap((r, rank) => {
      if (!r.thumbnail || !r.foreign_landing_url) return [];
      const lic = (r.license ?? '').toLowerCase();
      const license = lic === 'cc0' ? 'CC0' : lic === 'pdm' ? 'Public Domain Mark' : `CC ${lic.toUpperCase()} ${r.license_version ?? ''}`.trim();
      return [
        {
          rank,
          info: {
            title: (r.title || 'Untitled').slice(0, 120),
            author: r.creator?.slice(0, 120) || null,
            license,
            licenseUrl: r.license_url ?? null,
            pageUrl: r.foreign_landing_url,
            imageUrl: r.thumbnail,
            provider: this.name,
          },
        },
      ];
    });
  }
}
