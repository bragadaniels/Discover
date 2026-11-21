import {XMLParser} from 'fast-xml-parser';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

interface ArxivAuthor {
  name?: string;
}

interface ArxivLink {
  '@_href'?: string;
  '@_title'?: string;
  '@_type'?: string;
}

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  link?: ArxivLink | ArxivLink[];
  'arxiv:primary_category'?: {'@_term'?: string};
}

export class ArxivProvider implements DiscoveryProvider {
  readonly name = 'arxiv' as const;
  readonly displayName = 'arXiv Preprints';
  readonly contentType = 'article' as const;
  readonly supportsMultiLanguage = false;
  readonly supportsMultiRegion = false;
  readonly localeLimitationNote =
    'arXiv preprints are predominantly English and the arXiv API does not support language or country filtering.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const maxResults = Math.min(Math.max(options.maxResults || 25, 15), 30);
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

    const response = await fetchWithRetry(url);
    const xml = await response.text();
    const parsed = parser.parse(xml) as {
      feed?: {entry?: ArxivEntry | ArxivEntry[]};
    };

    const rawEntries = parsed?.feed?.entry;
    if (!rawEntries) return [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

    return entries.flatMap((entry): RawDiscoveredItem[] => {
      if (!entry.title || !entry.id) return [];

      const authorsRaw = entry.author
        ? Array.isArray(entry.author)
          ? entry.author
          : [entry.author]
        : [];
      const authors = authorsRaw
        .slice(0, 4)
        .map((a) => a.name)
        .filter(Boolean)
        .join(', ');

      const links = entry.link ? (Array.isArray(entry.link) ? entry.link : [entry.link]) : [];
      const pdfUrl = links.find((l) => l['@_title'] === 'pdf' || l['@_type'] === 'application/pdf')?.['@_href'] || null;

      // Extract clean arXiv identifier (e.g. arxiv:2401.12345)
      const idMatch = String(entry.id).match(/abs\/([^v]+)/i);
      const externalId = idMatch ? `arxiv:${idMatch[1]}` : null;
      const primaryCategory = entry['arxiv:primary_category']?.['@_term'];

      return [
        {
          title: String(entry.title).replace(/\s+/g, ' ').trim(),
          description: entry.summary ? String(entry.summary).replace(/\s+/g, ' ').trim() : null,
          contentType: 'article',
          originalUrl: entry.id,
          externalId,
          sourceName: primaryCategory ? `arXiv (${primaryCategory})` : 'arXiv',
          author: authors || null,
          publishedAt: entry.published || entry.updated || null,
          language: 'en',
          publicationRegion: null,
          openAccessUrl: pdfUrl,
          providerName: this.name,
        },
      ];
    });
  }
}
