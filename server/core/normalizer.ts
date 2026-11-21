import type {ContentType} from '../../shared/types';

export interface RawDiscoveredItem {
  title: string;
  description?: string | null;
  contentType: ContentType;
  originalUrl: string;
  doi?: string | null;
  externalId?: string | null;
  sourceName?: string | null;
  publisherDomainHint?: string | null;
  author?: string | null;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  language?: string | null;
  publicationRegion?: string | null;
  publisherCountry?: string | null;
  duration?: string | null;
  openAccessUrl?: string | null;
  providerName: string;
}

export interface NormalizedContentItem {
  title: string;
  description: string | null;
  contentType: ContentType;
  originalUrl: string;
  canonicalUrl: string;
  doi: string | null;
  externalId: string | null;
  sourceName: string;
  sourceDomain: string;
  author: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  language: string;
  publicationRegion: string | null;
  publisherCountry: string | null;
  duration: string | null;
  openAccessUrl: string | null;
  metadataQuality: number;
  providerName: string;
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ocid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'si',
]);

// Verifiable country-code TLDs only. Generic TLDs (.com, .org, .net, .io) deliberately return null
// so English articles are never falsely assumed to originate from US or GB.
const CCTLD_COUNTRY_MAP: Record<string, string> = {
  br: 'BR',
  uk: 'GB',
  pt: 'PT',
  es: 'ES',
  mx: 'MX',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  jp: 'JP',
  kr: 'KR',
  ca: 'CA',
  au: 'AU',
  ar: 'AR',
  cl: 'CL',
  co: 'CO',
  ch: 'CH',
  at: 'AT',
  nl: 'NL',
  be: 'BE',
  se: 'SE',
  no: 'NO',
  dk: 'DK',
  fi: 'FI',
  ie: 'IE',
  nz: 'NZ',
  in: 'IN',
  pl: 'PL',
};

export function inferPublisherCountryFromDomain(domainOrUrl: string | null | undefined): string | null {
  if (!domainOrUrl) return null;
  let host = domainOrUrl.trim().toLowerCase();
  if (host.startsWith('http://') || host.startsWith('https://')) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, '');
  if (!host || host === 'news.google.com' || host === 'youtube.com' || host === 'arxiv.org') {
    return null;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return CCTLD_COUNTRY_MAP[last] || null;
}

export function sanitizePlainText(input: string | null | undefined, maxLength = 800): string {
  if (!input) return '';
  let text = String(input);

  // Decode common and numeric HTML entities first, then strip tags cleanly
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });

  // Strip script/style blocks completely
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Strip remaining HTML/XML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > maxLength) {
    return text.slice(0, maxLength - 1).trimEnd() + '…';
  }
  return text;
}

export function isValidHttpUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function canonicalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl.trim());
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hash = '';

  const keptParams: [string, string][] = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) {
      keptParams.push([k, v]);
    }
  }
  keptParams.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = '';
  for (const [k, v] of keptParams) {
    parsed.searchParams.append(k, v);
  }

  // Strip trailing slash for non-root paths
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function normalizeDoi(rawDoi: string | null | undefined): string | null {
  if (!rawDoi) return null;
  const cleaned = rawDoi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  if (!cleaned || !cleaned.includes('/')) return null;
  return cleaned;
}

export function normalizePublishedDate(rawDate: string | null | undefined): string | null {
  if (!rawDate) return null;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function normalizeLanguageCode(rawLang: string | null | undefined): string {
  if (!rawLang) return 'en';
  const cleaned = rawLang.trim().toLowerCase().split(/[-_]/)[0];
  return cleaned ? cleaned.slice(0, 8) : 'en';
}

export function computeMetadataQuality(item: {
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
  doi: string | null;
  openAccessUrl: string | null;
  sourceName: string;
}): number {
  let score = 0.25;
  if (item.title.length >= 16) score += 0.1;
  if (item.description && item.description.length >= 40) score += 0.25;
  if (item.author) score += 0.1;
  if (item.publishedAt) score += 0.15;
  if (item.doi || item.openAccessUrl) score += 0.1;
  if (item.sourceName && item.sourceName !== 'Unknown Source') score += 0.05;
  return Math.min(1, Math.round(score * 100) / 100);
}

export function normalizeRawItem(raw: RawDiscoveredItem): NormalizedContentItem | null {
  if (!isValidHttpUrl(raw.originalUrl)) {
    return null;
  }

  const title = sanitizePlainText(raw.title, 280);
  if (!title || title.length < 4) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(raw.originalUrl);
  const urlDomain = extractDomain(canonicalUrl);
  const hintDomain = raw.publisherDomainHint ? extractDomain(raw.publisherDomainHint) : null;
  const sourceDomain =
    hintDomain && hintDomain !== 'unknown'
      ? hintDomain
      : urlDomain;
  const sourceName = sanitizePlainText(raw.sourceName, 120) || sourceDomain;
  const descriptionText = sanitizePlainText(raw.description, 520);
  const description = descriptionText.length > 0 ? descriptionText : null;
  const authorText = sanitizePlainText(raw.author, 160);
  const author = authorText.length > 0 ? authorText : null;
  const doi = normalizeDoi(raw.doi);
  const publishedAt = normalizePublishedDate(raw.publishedAt);
  const thumbnailUrl = isValidHttpUrl(raw.thumbnailUrl) ? raw.thumbnailUrl!.trim() : null;
  const openAccessUrl = isValidHttpUrl(raw.openAccessUrl) ? raw.openAccessUrl!.trim() : null;

  const publicationRegion =
    raw.publicationRegion && raw.publicationRegion !== 'GLOBAL'
      ? raw.publicationRegion.trim().toUpperCase().slice(0, 24)
      : null;

  const publisherCountry =
    raw.publisherCountry?.trim().toUpperCase().slice(0, 4) ||
    inferPublisherCountryFromDomain(raw.publisherDomainHint || sourceDomain);

  const metadataQuality = computeMetadataQuality({
    title,
    description,
    author,
    publishedAt,
    doi,
    openAccessUrl,
    sourceName,
  });

  return {
    title,
    description,
    contentType: raw.contentType,
    originalUrl: raw.originalUrl.trim(),
    canonicalUrl,
    doi,
    externalId: raw.externalId ? raw.externalId.trim() : null,
    sourceName,
    sourceDomain,
    author,
    thumbnailUrl,
    publishedAt,
    language: normalizeLanguageCode(raw.language),
    publicationRegion,
    publisherCountry,
    duration: raw.duration ? sanitizePlainText(raw.duration, 24) : null,
    openAccessUrl,
    metadataQuality,
    providerName: raw.providerName,
  };
}
