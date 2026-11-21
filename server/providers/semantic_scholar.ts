import {APP_CONFIG} from '../config';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

interface SemanticScholarPaper {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  url?: string | null;
  venue?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  citationCount?: number | null;
  authors?: Array<{name?: string}>;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
  } | null;
  openAccessPdf?: {
    url?: string;
  } | null;
}

// Polite serial pacing for Semantic Scholar free tier (~1 req/sec)
let pacingQueue: Promise<void> = Promise.resolve();
let lastRequestAtMs = 0;

async function waitSemanticScholarSlot(hasApiKey: boolean): Promise<void> {
  const minSpacingMs = hasApiKey ? 150 : 1100;
  const current = pacingQueue.then(async () => {
    const elapsed = Date.now() - lastRequestAtMs;
    if (elapsed < minSpacingMs) {
      await new Promise((resolve) => setTimeout(resolve, minSpacingMs - elapsed));
    }
    lastRequestAtMs = Date.now();
  });
  pacingQueue = current.catch(() => {});
  await current;
}

export class SemanticScholarProvider implements DiscoveryProvider {
  readonly name = 'semantic_scholar' as const;
  readonly displayName = 'Semantic Scholar';
  readonly contentType = 'article' as const;
  readonly supportsMultiLanguage = false;
  readonly supportsMultiRegion = false;
  readonly localeLimitationNote =
    'Searches Semantic Scholar academic publications with citation counts and open-access PDFs; indexes primarily English scholarly metadata.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return APP_CONFIG.semanticScholarApiKey
      ? 'Authenticated API key configured'
      : 'Free unauthenticated tier (rate-paced automatically)';
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const limit = Math.min(Math.max(options.maxResults || 20, 10), 25);
    const currentYear = new Date().getUTCFullYear();
    const fromYear = options.fromYear ?? currentYear - 4;
    const fields =
      'paperId,title,abstract,url,venue,year,publicationDate,citationCount,authors,externalIds,openAccessPdf';

    const headers: Record<string, string> = {};
    if (APP_CONFIG.semanticScholarApiKey) {
      headers['x-api-key'] = APP_CONFIG.semanticScholarApiKey;
    }

    const mapPapers = (papers: SemanticScholarPaper[]): RawDiscoveredItem[] =>
      papers.flatMap((paper): RawDiscoveredItem[] => {
        if (!paper.title) return [];
        const doi = paper.externalIds?.DOI || null;
        const arxivId = paper.externalIds?.ArXiv?.replace(/v\d+$/i, '') || null;
        const originalUrl =
          paper.url ||
          (doi ? `https://doi.org/${doi}` : null) ||
          (arxivId ? `https://arxiv.org/abs/${arxivId}` : null);
        if (!originalUrl) return [];

        const authors = (paper.authors || [])
          .slice(0, 4)
          .map((a) => a.name)
          .filter(Boolean)
          .join(', ');

        const venue = paper.venue?.trim() || 'Semantic Scholar';
        const description =
          paper.abstract?.trim() ||
          (typeof paper.citationCount === 'number' && paper.citationCount > 0
            ? `${venue} · ${paper.citationCount} citations`
            : null);

        const publishedAt = paper.publicationDate
          ? `${paper.publicationDate}T00:00:00.000Z`
          : paper.year
            ? `${paper.year}-01-01T00:00:00.000Z`
            : null;

        const externalId = arxivId
          ? `arxiv:${arxivId}`
          : paper.paperId
            ? `s2:${paper.paperId}`
            : null;

        return [
          {
            title: paper.title,
            description,
            contentType: 'article',
            originalUrl,
            doi,
            externalId,
            sourceName: venue,
            author: authors || null,
            publishedAt,
            language: 'en',
            publicationRegion: null,
            openAccessUrl: paper.openAccessPdf?.url || null,
            providerName: this.name,
          },
        ];
      });

    await waitSemanticScholarSlot(Boolean(APP_CONFIG.semanticScholarApiKey));
    const recentUrl =
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}` +
      `&limit=${limit}&publicationDateOrYear=${fromYear}:&fields=${fields}`;

    const recentResp = await fetchWithRetry(recentUrl, {headers});
    const recentJson = (await recentResp.json()) as {data?: SemanticScholarPaper[]};
    const recentItems = mapPapers(recentJson?.data || []);
    if (recentItems.length >= 4) {
      return recentItems;
    }

    await waitSemanticScholarSlot(Boolean(APP_CONFIG.semanticScholarApiKey));
    const fallbackUrl =
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}` +
      `&limit=${Math.min(limit, 15)}&fields=${fields}`;
    const fallbackResp = await fetchWithRetry(fallbackUrl, {headers});
    const fallbackJson = (await fallbackResp.json()) as {data?: SemanticScholarPaper[]};
    const fallbackItems = mapPapers(fallbackJson?.data || []);

    const seen = new Set(recentItems.map((i) => i.originalUrl));
    const merged = [...recentItems];
    for (const item of fallbackItems) {
      if (!seen.has(item.originalUrl)) {
        seen.add(item.originalUrl);
        merged.push(item);
      }
      if (merged.length >= limit) break;
    }
    return merged;
  }
}
