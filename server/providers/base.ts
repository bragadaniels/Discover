import type {ContentType} from '../../shared/types';
import {APP_CONFIG} from '../config';
import type {RawDiscoveredItem} from '../core/normalizer';

export interface ProviderSearchOptions {
  language: string;
  region: string;
  countryCode?: string;
  queryLocation?: string | null;
  expandedTerms?: string[];
  exclusions?: string[];
  maxResults: number;
  fromYear?: number;
}

export class ProviderRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 300) {
    super(message);
    this.name = 'ProviderRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface DiscoveryProvider {
  readonly name:
    | 'google_news'
    | 'rss_publishers'
    | 'crossref'
    | 'arxiv'
    | 'openalex'
    | 'semantic_scholar'
    | 'hacker_news'
    | 'youtube';
  readonly displayName: string;
  readonly contentType: ContentType;
  readonly supportsMultiLanguage: boolean;
  readonly supportsMultiRegion: boolean;
  readonly localeLimitationNote: string;
  isConfigured(): boolean;
  getStatusNote(): string | null;
  search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]>;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = APP_CONFIG.maxRetries,
  timeoutMs = APP_CONFIG.requestTimeoutMs
): Promise<Response> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'User-Agent': 'DiscoverPersonalAggregator/1.0 (https://localhost; personal-research)',
          ...(init.headers || {}),
        },
      });
      clearTimeout(timer);

      if (response.status === 429) {
        const retryHeader = Number(response.headers.get('retry-after')) || 300;
        throw new ProviderRateLimitError(`Rate limited (HTTP 429)`, retryHeader);
      }

      if (response.status >= 500 && attempt < retries) {
        attempt++;
        const delay = 400 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ProviderRateLimitError) {
        throw err;
      }
      lastError = err;
      if (attempt >= retries) {
        break;
      }
      attempt++;
      const delay = 400 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}
