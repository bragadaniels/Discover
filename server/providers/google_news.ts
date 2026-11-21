import {XMLParser} from 'fast-xml-parser';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  source?: string | {'#text'?: string; '@_url'?: string};
}

let googleNewsCooldownUntil = 0;

interface BingRssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  'News:Source'?: string;
  'News:Image'?: string;
}

function decodeBingNewsUrl(rawLink: string): string {
  try {
    const u = new URL(rawLink);
    const inner = u.searchParams.get('url');
    if (inner && /^https?:\/\//i.test(inner)) {
      return inner;
    }
  } catch {
    // Fallback to raw link
  }
  return rawLink;
}

export class GoogleNewsProvider implements DiscoveryProvider {
  readonly name = 'google_news' as const;
  readonly displayName = 'Google News RSS';
  readonly contentType = 'news' as const;
  readonly supportsMultiLanguage = true;
  readonly supportsMultiRegion = true;
  readonly localeLimitationNote =
    'Natively queries separate language & country editions (Google News hl/gl/ceid with Bing News mkt/setlang fallback). Publisher country is only recorded when verifiable from publisher domain TLD.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    if (Date.now() < googleNewsCooldownUntil) {
      return 'Google News RSS temporarily throttled (503/429); using Bing News RSS fallback for regional feeds.';
    }
    return null;
  }

  private async searchBingNewsFallback(
    query: string,
    lang: string,
    countryCode: string,
    publicationRegion: string,
    maxResults: number
  ): Promise<RawDiscoveredItem[]> {
    const mkt = `${lang}-${countryCode}`;
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=${encodeURIComponent(mkt)}&setlang=${encodeURIComponent(lang)}`;
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': `${lang}-${countryCode},${lang};q=0.9`,
        },
      },
      1,
      7000
    );
    const xml = await response.text();
    const parsed = parser.parse(xml) as {
      rss?: {channel?: {item?: BingRssItem | BingRssItem[]}};
    };
    const rawItems = parsed?.rss?.channel?.item;
    if (!rawItems) return [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items.slice(0, maxResults).flatMap((item): RawDiscoveredItem[] => {
      if (!item.title || !item.link) return [];
      const realUrl = decodeBingNewsUrl(String(item.link));
      const sourceName = item['News:Source'] ? String(item['News:Source']).trim() : 'News';
      const cleanDesc = item.description
        ? String(item.description)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : null;

      return [
        {
          title: String(item.title).trim(),
          description: cleanDesc || null,
          contentType: 'news',
          originalUrl: realUrl,
          sourceName,
          publisherDomainHint: realUrl,
          thumbnailUrl: item['News:Image'] ? String(item['News:Image']) : null,
          publishedAt: item.pubDate || null,
          language: lang,
          publicationRegion,
          providerName: this.name,
        },
      ];
    });
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const lang = (options.language || 'en').toLowerCase();
    const publicationRegion = (options.region || 'US').toUpperCase();
    const countryCode = (
      options.countryCode ||
      (publicationRegion.length === 2 ? publicationRegion : 'US')
    ).toUpperCase();

    if (Date.now() < googleNewsCooldownUntil) {
      return this.searchBingNewsFallback(
        query,
        lang,
        countryCode,
        publicationRegion,
        options.maxResults
      );
    }

    const hl = `${lang}-${countryCode}`;
    const ceid = `${countryCode}:${lang}`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(countryCode)}&ceid=${encodeURIComponent(ceid)}`;

    let xml: string;
    try {
      // Fail fast on 503/429/timeout (0 retries) so discovery falls back to Bing News RSS immediately
      const response = await fetchWithRetry(url, {}, 0, 3000);
      xml = await response.text();
    } catch {
      googleNewsCooldownUntil = Date.now() + 5 * 60 * 1000;
      return this.searchBingNewsFallback(
        query,
        lang,
        countryCode,
        publicationRegion,
        options.maxResults
      );
    }

    const parsed = parser.parse(xml) as {
      rss?: {channel?: {item?: RssItem | RssItem[]}};
    };

    const rawItems = parsed?.rss?.channel?.item;
    if (!rawItems) return [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items.slice(0, options.maxResults).flatMap((item): RawDiscoveredItem[] => {
      if (!item.title || !item.link) return [];

      let sourceName = 'Google News';
      let publisherDomainHint: string | null = null;
      if (typeof item.source === 'string') {
        sourceName = item.source;
      } else if (item.source) {
        if (typeof item.source['#text'] === 'string') {
          sourceName = item.source['#text'];
        }
        if (typeof item.source['@_url'] === 'string') {
          publisherDomainHint = item.source['@_url'];
        }
      }

      // Google News titles often end with " - Source Name"; trim redundant trailing publisher
      let cleanTitle = String(item.title);
      if (sourceName && cleanTitle.endsWith(` - ${sourceName}`)) {
        cleanTitle = cleanTitle.slice(0, -(` - ${sourceName}`.length)).trim();
      }

      // Google News RSS <description> is typically an HTML link echoing only the title + source.
      let cleanDesc: string | null = null;
      if (item.description) {
        const plainDesc = String(item.description)
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/\s+/g, ' ')
          .trim();
        const titleNorm = cleanTitle.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const descNorm = plainDesc.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const srcNorm = sourceName.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const isEcho =
          !plainDesc ||
          descNorm === titleNorm ||
          descNorm === `${titleNorm}${srcNorm}` ||
          (titleNorm.length > 15 && descNorm.startsWith(titleNorm) && descNorm.length <= titleNorm.length + srcNorm.length + 8);
        if (!isEcho) {
          cleanDesc = plainDesc;
        }
      }

      return [
        {
          title: cleanTitle,
          description: cleanDesc,
          contentType: 'news',
          originalUrl: item.link,
          sourceName,
          publisherDomainHint,
          publishedAt: item.pubDate || null,
          language: lang,
          publicationRegion,
          providerName: this.name,
        },
      ];
    });
  }
}
