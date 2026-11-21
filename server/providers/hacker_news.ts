import {extractDomain, sanitizePlainText, type RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

interface AlgoliaHnHit {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string | null;
  story_text?: string | null;
}

export class HackerNewsProvider implements DiscoveryProvider {
  readonly name = 'hacker_news' as const;
  readonly displayName = 'Hacker News (Algolia)';
  readonly contentType = 'article' as const;
  readonly supportsMultiLanguage = false;
  readonly supportsMultiRegion = false;
  readonly localeLimitationNote =
    'Searches Hacker News stories and linked technical essays via Algolia (English-only; prioritized for technology, science, and computing topics).';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const hitsPerPage = Math.min(Math.max(options.maxResults || 20, 10), 25);

    const mapHits = (hits: AlgoliaHnHit[]): RawDiscoveredItem[] =>
      hits.flatMap((hit): RawDiscoveredItem[] => {
        const title = hit.title?.trim();
        if (!title || !hit.objectID) return [];

        const externalUrl = hit.url?.trim() || null;
        const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const originalUrl = externalUrl || hnUrl;
        const points = typeof hit.points === 'number' ? hit.points : 0;
        const comments = typeof hit.num_comments === 'number' ? hit.num_comments : 0;

        const cleanStoryText = hit.story_text ? sanitizePlainText(hit.story_text, 400) : '';
        const hnStatsLine = `Hacker News discussion: ${points} points · ${comments} comments`;
        const description = cleanStoryText ? `${cleanStoryText} (${hnStatsLine})` : hnStatsLine;

        const sourceName = externalUrl ? `${extractDomain(externalUrl)} · HN` : 'Hacker News';

        return [
          {
            title,
            description,
            contentType: 'article',
            originalUrl,
            externalId: `hn:${hit.objectID}`,
            sourceName,
            publisherDomainHint: externalUrl || hnUrl,
            author: hit.author || null,
            publishedAt: hit.created_at || null,
            language: 'en',
            publicationRegion: null,
            providerName: this.name,
          },
        ];
      });

    const recentUrl =
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=${hitsPerPage}&numericFilters=points>=3`;

    const recentResp = await fetchWithRetry(recentUrl);
    const recentJson = (await recentResp.json()) as {hits?: AlgoliaHnHit[]};
    const recentItems = mapHits(recentJson?.hits || []);
    if (recentItems.length >= 5) {
      return recentItems;
    }

    const fallbackUrl =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
      `&tags=story&hitsPerPage=${Math.min(hitsPerPage, 15)}&numericFilters=points>=5`;
    const fallbackResp = await fetchWithRetry(fallbackUrl);
    const fallbackJson = (await fallbackResp.json()) as {hits?: AlgoliaHnHit[]};
    const fallbackItems = mapHits(fallbackJson?.hits || []);

    const seen = new Set(recentItems.map((i) => i.originalUrl));
    const merged = [...recentItems];
    for (const item of fallbackItems) {
      if (!seen.has(item.originalUrl)) {
        seen.add(item.originalUrl);
        merged.push(item);
      }
      if (merged.length >= hitsPerPage) break;
    }
    return merged;
  }
}
