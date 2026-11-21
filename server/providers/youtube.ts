import {APP_CONFIG} from '../config';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

interface YouTubeSearchItem {
  id?: {videoId?: string};
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: {url?: string};
      high?: {url?: string};
      default?: {url?: string};
    };
  };
}

interface YouTubeVideoDetail {
  id?: string;
  contentDetails?: {duration?: string};
}

function formatIsoDuration(iso: string | undefined): string | null {
  if (!iso) return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const mins = Number(match[2] || 0);
  const secs = Number(match[3] || 0);
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export class YouTubeProvider implements DiscoveryProvider {
  readonly name = 'youtube' as const;
  readonly displayName = 'YouTube Data API';
  readonly contentType = 'video' as const;
  readonly supportsMultiLanguage = true;
  readonly supportsMultiRegion = true;
  readonly localeLimitationNote =
    'Supports relevanceLanguage and regionCode per query when YOUTUBE_API_KEY is configured.';

  isConfigured(): boolean {
    return APP_CONFIG.youtubeApiKey.length > 0;
  }

  getStatusNote(): string | null {
    if (!this.isConfigured()) {
      return 'Set YOUTUBE_API_KEY in server environment to enable automatic video discovery.';
    }
    return null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const maxResults = Math.min(options.maxResults, 8);
    const lang = (options.language || 'en').toLowerCase();
    const region = (options.region || 'US').toUpperCase();
    const countryCode = (options.countryCode || (region.length === 2 ? region : 'US')).toUpperCase();

    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}` +
      `&q=${encodeURIComponent(query)}&relevanceLanguage=${encodeURIComponent(lang)}` +
      `&regionCode=${encodeURIComponent(countryCode)}&key=${encodeURIComponent(APP_CONFIG.youtubeApiKey)}`;

    const searchResp = await fetchWithRetry(searchUrl);
    const searchData = (await searchResp.json()) as {items?: YouTubeSearchItem[]};
    const items = searchData.items || [];

    const videoIds = items.map((i) => i.id?.videoId).filter((id): id is string => Boolean(id));
    const durationMap = new Map<string, string>();

    if (videoIds.length > 0) {
      try {
        const detailUrl =
          `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(videoIds.join(','))}` +
          `&key=${encodeURIComponent(APP_CONFIG.youtubeApiKey)}`;
        const detailResp = await fetchWithRetry(detailUrl);
        const detailData = (await detailResp.json()) as {items?: YouTubeVideoDetail[]};
        for (const v of detailData.items || []) {
          const formatted = formatIsoDuration(v.contentDetails?.duration);
          if (v.id && formatted) {
            durationMap.set(v.id, formatted);
          }
        }
      } catch {
        // Duration lookup is optional; keep search results even if detail call fails
      }
    }

    return items.flatMap((item): RawDiscoveredItem[] => {
      const videoId = item.id?.videoId;
      const snippet = item.snippet;
      if (!videoId || !snippet?.title) return [];

      const thumb =
        snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.default?.url ||
        null;

      return [
        {
          title: snippet.title,
          description: snippet.description || null,
          contentType: 'video',
          originalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          externalId: `youtube:${videoId}`,
          sourceName: snippet.channelTitle || 'YouTube',
          author: snippet.channelTitle || null,
          thumbnailUrl: thumb,
          publishedAt: snippet.publishedAt || null,
          language: lang,
          publicationRegion: region,
          duration: durationMap.get(videoId) || null,
          providerName: this.name,
        },
      ];
    });
  }
}
