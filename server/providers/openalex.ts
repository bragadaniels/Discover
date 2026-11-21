import {APP_CONFIG} from '../config';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

interface OpenAlexAuthorship {
  author?: {
    display_name?: string;
  };
}

interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: {
    display_name?: string | null;
    host_organization_name?: string | null;
  } | null;
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_date?: string | null;
  publication_year?: number | null;
  language?: string | null;
  cited_by_count?: number | null;
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  open_access?: {
    oa_url?: string | null;
  } | null;
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

export function reconstructOpenAlexAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object') {
    return null;
  }

  let maxPos = -1;
  for (const positions of Object.values(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && Number.isFinite(pos) && pos >= 0 && pos < 4000 && pos > maxPos) {
        maxPos = pos;
      }
    }
  }
  if (maxPos < 0) return null;

  const words = new Array<string>(maxPos + 1);
  for (const [token, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0 && pos <= maxPos) {
        words[pos] = token;
      }
    }
  }

  const text = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

function extractArxivIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})(?:v\d+)?/i);
  return match ? `arxiv:${match[1]}` : null;
}

export class OpenAlexProvider implements DiscoveryProvider {
  readonly name = 'openalex' as const;
  readonly displayName = 'OpenAlex Scholarly';
  readonly contentType = 'article' as const;
  readonly supportsMultiLanguage = true;
  readonly supportsMultiRegion = false;
  readonly localeLimitationNote =
    'Searches OpenAlex open scholarly catalog across languages with open-access PDF links and citation metadata, without geographic press filters.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return APP_CONFIG.openalexMailto ? 'Polite pool enabled' : null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const perPage = Math.min(Math.max(options.maxResults || 25, 15), 35);
    const currentYear = new Date().getUTCFullYear();
    const fromYear = options.fromYear ?? currentYear - 4;
    const select =
      'id,doi,title,display_name,publication_date,publication_year,language,cited_by_count,primary_location,best_oa_location,open_access,authorships,abstract_inverted_index';
    const mailtoParam = APP_CONFIG.openalexMailto
      ? `&mailto=${encodeURIComponent(APP_CONFIG.openalexMailto)}`
      : '';

    const mapWorks = (works: OpenAlexWork[]): RawDiscoveredItem[] =>
      works.flatMap((work): RawDiscoveredItem[] => {
        const title = work.title || work.display_name;
        const landingUrl = work.primary_location?.landing_page_url || null;
        const doiUrl = work.doi
          ? work.doi.startsWith('http')
            ? work.doi
            : `https://doi.org/${work.doi}`
          : null;
        const originalUrl = landingUrl || doiUrl || work.open_access?.oa_url || work.id;
        if (!title || !originalUrl) return [];

        const authors = (work.authorships || [])
          .slice(0, 4)
          .map((a) => a.author?.display_name)
          .filter(Boolean)
          .join(', ');

        const sourceName =
          work.primary_location?.source?.display_name ||
          work.primary_location?.source?.host_organization_name ||
          'OpenAlex';

        const abstract = reconstructOpenAlexAbstract(work.abstract_inverted_index);
        const description =
          abstract ||
          (typeof work.cited_by_count === 'number' && work.cited_by_count > 0
            ? `${sourceName} · Cited by ${work.cited_by_count} works`
            : null);

        const openAccessUrl =
          work.best_oa_location?.pdf_url || work.open_access?.oa_url || null;

        const externalId =
          extractArxivIdFromUrl(landingUrl) ||
          extractArxivIdFromUrl(openAccessUrl) ||
          (work.id ? `openalex:${work.id.replace('https://openalex.org/', '')}` : null);

        const publishedAt = work.publication_date
          ? `${work.publication_date}T00:00:00.000Z`
          : work.publication_year
            ? `${work.publication_year}-01-01T00:00:00.000Z`
            : null;

        return [
          {
            title,
            description,
            contentType: 'article',
            originalUrl,
            doi: work.doi || null,
            externalId,
            sourceName,
            publisherDomainHint: landingUrl || undefined,
            author: authors || null,
            publishedAt,
            language: work.language || options.language || 'en',
            publicationRegion: null,
            openAccessUrl,
            providerName: this.name,
          },
        ];
      });

    const recentUrl =
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
      `&filter=from_publication_date:${fromYear}-01-01,type:article|preprint` +
      `&sort=publication_date:desc&per-page=${perPage}&select=${select}${mailtoParam}`;

    const recentResp = await fetchWithRetry(recentUrl);
    const recentJson = (await recentResp.json()) as {results?: OpenAlexWork[]};
    const recentItems = mapWorks(recentJson?.results || []);
    if (recentItems.length >= 5) {
      return recentItems;
    }

    const fallbackUrl =
      `https://api.openalex.org/works?search=${encodeURIComponent(query)}` +
      `&sort=relevance_score:desc&per-page=${Math.min(perPage, 20)}&select=${select}${mailtoParam}`;
    const fallbackResp = await fetchWithRetry(fallbackUrl);
    const fallbackJson = (await fallbackResp.json()) as {results?: OpenAlexWork[]};
    const fallbackItems = mapWorks(fallbackJson?.results || []);

    const seen = new Set(recentItems.map((i) => i.originalUrl));
    const merged = [...recentItems];
    for (const item of fallbackItems) {
      if (!seen.has(item.originalUrl)) {
        seen.add(item.originalUrl);
        merged.push(item);
      }
      if (merged.length >= perPage) break;
    }
    return merged;
  }
}
