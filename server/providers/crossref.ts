import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  title?: string[];
  abstract?: string;
  publisher?: string;
  'container-title'?: string[];
  author?: CrossrefAuthor[];
  published?: {'date-parts'?: number[][]};
  'published-online'?: {'date-parts'?: number[][]};
  'published-print'?: {'date-parts'?: number[][]};
  link?: Array<{URL?: string; 'content-type'?: string; 'intended-application'?: string}>;
  language?: string;
}

function formatCrossrefDate(work: CrossrefWork): string | null {
  const parts =
    work.published?.['date-parts']?.[0] ||
    work['published-online']?.['date-parts']?.[0] ||
    work['published-print']?.['date-parts']?.[0];
  if (!parts || parts.length === 0) return null;
  const year = parts[0];
  const month = String(parts[1] || 1).padStart(2, '0');
  const day = String(parts[2] || 1).padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

export class CrossrefProvider implements DiscoveryProvider {
  readonly name = 'crossref' as const;
  readonly displayName = 'Crossref Scholarly';
  readonly contentType = 'article' as const;
  readonly supportsMultiLanguage = true;
  readonly supportsMultiRegion = false;
  readonly localeLimitationNote =
    'Executes bibliographic queries using translated terms across selected languages, but Crossref does not provide a geographic region or country filter.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const rows = Math.min(Math.max(options.maxResults || 25, 15), 35);
    const currentYear = new Date().getUTCFullYear();
    const fromYear = options.fromYear ?? currentYear - 4;

    const mapWorks = (works: CrossrefWork[]): RawDiscoveredItem[] =>
      works.flatMap((work): RawDiscoveredItem[] => {
        const title = work.title?.[0];
        const urlLink = work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : null);
        if (!title || !urlLink) return [];

        const authors = (work.author || [])
          .slice(0, 4)
          .map((a) => [a.given, a.family].filter(Boolean).join(' '))
          .filter(Boolean)
          .join(', ');

        const journal = work['container-title']?.[0] || work.publisher || 'Crossref';
        const pdfLink = work.link?.find(
          (l) => l.URL && (l['content-type']?.includes('pdf') || l['intended-application'] === 'text-mining')
        )?.URL;

        return [
          {
            title,
            description: work.abstract || null,
            contentType: 'article',
            originalUrl: urlLink,
            doi: work.DOI || null,
            sourceName: journal,
            author: authors || null,
            publishedAt: formatCrossrefDate(work),
            language: work.language || options.language || 'en',
            publicationRegion: null,
            openAccessUrl: pdfLink || null,
            providerName: this.name,
          },
        ];
      });

    const recentUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&filter=from-pub-date:${fromYear}-01-01&rows=${rows}&sort=published&order=desc`;
    const recentResp = await fetchWithRetry(recentUrl);
    const recentJson = (await recentResp.json()) as {
      message?: {items?: CrossrefWork[]};
    };
    const recentItems = mapWorks(recentJson?.message?.items || []);

    if (recentItems.length >= 5) {
      return recentItems;
    }

    // Fallback without date cutoff only for ultra-niche historical queries with < 5 recent papers
    const fallbackUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${Math.min(rows, 20)}&sort=relevance`;
    const fallbackResp = await fetchWithRetry(fallbackUrl);
    const fallbackJson = (await fallbackResp.json()) as {
      message?: {items?: CrossrefWork[]};
    };
    const fallbackItems = mapWorks(fallbackJson?.message?.items || []);

    const seenUrls = new Set(recentItems.map((i) => i.originalUrl));
    const merged = [...recentItems];
    for (const item of fallbackItems) {
      if (!seenUrls.has(item.originalUrl)) {
        seenUrls.add(item.originalUrl);
        merged.push(item);
      }
      if (merged.length >= rows) break;
    }
    return merged;
  }
}
