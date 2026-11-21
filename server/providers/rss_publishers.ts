import {XMLParser} from 'fast-xml-parser';
import {HIDDEN_GEMS_TAG_NAME} from '../core/domain_expansion';
import type {RawDiscoveredItem} from '../core/normalizer';
import {fetchWithRetry, type DiscoveryProvider, type ProviderSearchOptions} from './base';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

interface PublisherFeedDef {
  id: string;
  sourceName: string;
  country: string;
  language: string;
  section: 'general' | 'world' | 'tech' | 'science' | 'cinema';
  url: string;
}

const PUBLISHER_FEEDS: PublisherFeedDef[] = [
  // International (English)
  {
    id: 'bbc-news',
    sourceName: 'BBC News',
    country: 'GB',
    language: 'en',
    section: 'general',
    url: 'https://feeds.bbci.co.uk/news/rss.xml',
  },
  {
    id: 'bbc-world',
    sourceName: 'BBC News',
    country: 'GB',
    language: 'en',
    section: 'world',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  },
  {
    id: 'bbc-tech',
    sourceName: 'BBC News',
    country: 'GB',
    language: 'en',
    section: 'tech',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  },
  {
    id: 'bbc-science',
    sourceName: 'BBC News',
    country: 'GB',
    language: 'en',
    section: 'science',
    url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  },
  {
    id: 'bbc-arts',
    sourceName: 'BBC News',
    country: 'GB',
    language: 'en',
    section: 'cinema',
    url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
  },
  {
    id: 'guardian-world',
    sourceName: 'The Guardian',
    country: 'GB',
    language: 'en',
    section: 'world',
    url: 'https://www.theguardian.com/world/rss',
  },
  {
    id: 'guardian-tech',
    sourceName: 'The Guardian',
    country: 'GB',
    language: 'en',
    section: 'tech',
    url: 'https://www.theguardian.com/technology/rss',
  },
  {
    id: 'guardian-science',
    sourceName: 'The Guardian',
    country: 'GB',
    language: 'en',
    section: 'science',
    url: 'https://www.theguardian.com/science/rss',
  },
  {
    id: 'guardian-film',
    sourceName: 'The Guardian',
    country: 'GB',
    language: 'en',
    section: 'cinema',
    url: 'https://www.theguardian.com/film/rss',
  },

  // Brazilian (Portuguese)
  {
    id: 'g1-geral',
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'general',
    url: 'https://g1.globo.com/rss/g1/',
  },
  {
    id: 'g1-tech',
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'tech',
    url: 'https://g1.globo.com/rss/g1/tecnologia/',
  },
  {
    id: 'g1-science',
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'science',
    url: 'https://g1.globo.com/rss/g1/ciencia-e-saude/',
  },
  {
    id: 'g1-pop-arte',
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'cinema',
    url: 'https://g1.globo.com/rss/g1/pop-arte/',
  },
  {
    id: 'g1-mundo',
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'world',
    url: 'https://g1.globo.com/rss/g1/mundo/',
  },
  {
    id: 'folha-geral',
    sourceName: 'Folha de S.Paulo',
    country: 'BR',
    language: 'pt',
    section: 'general',
    url: 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml',
  },
  {
    id: 'folha-tec',
    sourceName: 'Folha de S.Paulo',
    country: 'BR',
    language: 'pt',
    section: 'tech',
    url: 'https://feeds.folha.uol.com.br/tec/rss091.xml',
  },
  {
    id: 'folha-ilustrada',
    sourceName: 'Folha de S.Paulo',
    country: 'BR',
    language: 'pt',
    section: 'cinema',
    url: 'https://feeds.folha.uol.com.br/ilustrada/rss091.xml',
  },
  {
    id: 'folha-mundo',
    sourceName: 'Folha de S.Paulo',
    country: 'BR',
    language: 'pt',
    section: 'world',
    url: 'https://feeds.folha.uol.com.br/mundo/rss091.xml',
  },
  {
    id: 'agencia-brasil',
    sourceName: 'Agência Brasil',
    country: 'BR',
    language: 'pt',
    section: 'general',
    url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
  },
];

interface ParsedRssEntry {
  title: string;
  description: string | null;
  link: string;
  pubDate: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  sourceName: string;
  country: string;
  language: string;
  section: PublisherFeedDef['section'];
}

interface RawRssEntryNode {
  title?: unknown;
  link?: unknown;
  description?: unknown;
  pubDate?: unknown;
  'dc:date'?: unknown;
  'dc:creator'?: unknown;
  author?: unknown;
  'media:thumbnail'?: {'@_url'?: string} | Array<{'@_url'?: string}>;
  'media:content'?: {'@_url'?: string} | Array<{'@_url'?: string}>;
}

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const feedCache = new Map<string, {fetchedAt: number; entries: ParsedRssEntry[]}>();

export function decodeXmlBuffer(buf: ArrayBuffer, contentTypeHeader?: string | null): string {
  const bytes = new Uint8Array(buf);
  const asciiHead = new TextDecoder('ascii', {fatal: false}).decode(bytes.slice(0, 220)).toLowerCase();
  const headerLower = (contentTypeHeader || '').toLowerCase();
  const isLatin1 =
    headerLower.includes('iso-8859-1') ||
    headerLower.includes('latin1') ||
    asciiHead.includes('encoding="iso-8859-1"') ||
    asciiHead.includes("encoding='iso-8859-1'");

  return new TextDecoder(isLatin1 ? 'iso-8859-1' : 'utf-8').decode(bytes);
}

function extractText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && '#text' in val) {
    return String((val as {'#text'?: unknown})['#text'] || '');
  }
  return '';
}

function extractMediaUrl(node: RawRssEntryNode): string | null {
  const thumb = node['media:thumbnail'];
  if (Array.isArray(thumb) && thumb[0]?.['@_url']) return thumb[0]['@_url'];
  if (thumb && !Array.isArray(thumb) && thumb['@_url']) return thumb['@_url'];
  const content = node['media:content'];
  if (Array.isArray(content) && content[0]?.['@_url']) return content[0]['@_url'];
  if (content && !Array.isArray(content) && content['@_url']) return content['@_url'];
  return null;
}

async function fetchPublisherFeed(feed: PublisherFeedDef): Promise<ParsedRssEntry[]> {
  const cached = feedCache.get(feed.url);
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) {
    return cached.entries;
  }

  try {
    const resp = await fetchWithRetry(
      feed.url,
      {
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
      },
      0,
      5000
    );
    const buf = await resp.arrayBuffer();
    const xml = decodeXmlBuffer(buf, resp.headers.get('content-type'));
    const parsed = parser.parse(xml) as {
      rss?: {channel?: {item?: RawRssEntryNode | RawRssEntryNode[]}};
    };
    const rawItems = parsed?.rss?.channel?.item;
    if (!rawItems) return [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];

    const entries: ParsedRssEntry[] = [];
    for (const item of list.slice(0, 60)) {
      const title = extractText(item.title).trim();
      const link = extractText(item.link).trim();
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
      const descRaw = extractText(item.description)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      entries.push({
        title,
        description: descRaw || null,
        link,
        pubDate: extractText(item.pubDate || item['dc:date']) || null,
        author: extractText(item['dc:creator'] || item.author) || null,
        thumbnailUrl: extractMediaUrl(item),
        sourceName: feed.sourceName,
        country: feed.country,
        language: feed.language,
        section: feed.section,
      });
    }

    feedCache.set(feed.url, {fetchedAt: Date.now(), entries});
    return entries;
  } catch {
    return [];
  }
}

export function selectFeedsForQuery(
  query: string,
  language: string,
  countryCode: string
): PublisherFeedDef[] {
  const lang = language.toLowerCase();
  const qLower = query.toLowerCase();

  let candidates = PUBLISHER_FEEDS.filter((f) => f.language === lang);
  if (candidates.length === 0) return [];

  // Prioritize country feeds if matching (e.g. BR vs PT, GB vs US)
  const exactCountry = candidates.filter((f) => f.country === countryCode);
  if (exactCountry.length > 0 && lang !== 'en') {
    candidates = exactCountry;
  }

  const wantsCinema =
    /\b(film|cinema|movie|thriller|kubrick|hidden gem|filmes|roteiro|festival|oscar|cannes|director)\b/i.test(
      qLower
    );
  const wantsTech =
    /\b(ai|artificial intelligence|intelig|software|cyber|computer|tech|robot|quantum|cloud|llm|open-source)\b/i.test(
      qLower
    );
  const wantsSci =
    /\b(science|chem|cataly|hydroformylation|physics|astro|exoplanet|bio|climate|genome|ciência|saúde|pesquisa)\b/i.test(
      qLower
    );

  const preferredSections = new Set<PublisherFeedDef['section']>(['general', 'world']);
  if (wantsCinema) preferredSections.add('cinema');
  if (wantsTech) preferredSections.add('tech');
  if (wantsSci) preferredSections.add('science');

  const filtered = candidates.filter((f) => preferredSections.has(f.section));
  return filtered.length > 0 ? filtered : candidates.slice(0, 5);
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'that',
  'this',
  'para',
  'com',
  'sobre',
  'das',
  'dos',
  'uma',
  'pouco',
]);

export function scoreRssEntryMatch(
  entry: ParsedRssEntry,
  searchTerms: string[],
  exclusions: string[] = []
): number {
  const titleLower = entry.title.toLowerCase();
  const descLower = (entry.description || '').toLowerCase();
  const haystack = `${titleLower} ${descLower}`;

  for (const ex of exclusions) {
    const cleanEx = ex.trim().toLowerCase();
    if (cleanEx && haystack.includes(cleanEx)) {
      return 0;
    }
  }

  let bestScore = 0;
  for (const rawTerm of searchTerms) {
    const clean = rawTerm.trim().toLowerCase();
    if (!clean) continue;

    if (clean === HIDDEN_GEMS_TAG_NAME.toLowerCase() || clean === 'hidden gems') {
      const indieHints = [
        'film',
        'cinema',
        'movie',
        'filme',
        'indie',
        'independent',
        'independente',
        'festival',
        'sundance',
        'cannes',
        'berlinale',
        'venice',
        'mubi',
        'criterion',
        'director',
        'diretor',
        'mostra',
        'documentary',
        'documentário',
      ];
      const matches = indieHints.filter((h) => haystack.includes(h)).length;
      if (entry.section === 'cinema' && matches >= 1) {
        bestScore = Math.max(bestScore, 2 + matches);
      } else if (matches >= 2) {
        bestScore = Math.max(bestScore, matches);
      }
      continue;
    }

    if (titleLower.includes(clean)) {
      bestScore = Math.max(bestScore, 5);
      continue;
    }
    if (descLower.includes(clean)) {
      bestScore = Math.max(bestScore, 3);
      continue;
    }

    const words = clean
      .split(/[\s,/-]+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
    if (words.length >= 2) {
      const titleHits = words.filter((w) => titleLower.includes(w)).length;
      const bodyHits = words.filter((w) => haystack.includes(w)).length;
      if (titleHits >= 2 || bodyHits >= words.length) {
        bestScore = Math.max(bestScore, 2 + titleHits);
      }
    } else if (words.length === 1 && titleLower.includes(words[0])) {
      bestScore = Math.max(bestScore, 3);
    }
  }

  return bestScore;
}

export class RssPublishersProvider implements DiscoveryProvider {
  readonly name = 'rss_publishers' as const;
  readonly displayName = 'International & Brazilian Press RSS';
  readonly contentType = 'news' as const;
  readonly supportsMultiLanguage = true;
  readonly supportsMultiRegion = true;
  readonly localeLimitationNote =
    'Queries verified public RSS editions from BBC News, The Guardian (EN/GB) and G1, Folha de S.Paulo, Agência Brasil (PT/BR). Other languages/publishers use News Search RSS.';

  isConfigured(): boolean {
    return true;
  }

  getStatusNote(): string | null {
    return null;
  }

  async search(query: string, options: ProviderSearchOptions): Promise<RawDiscoveredItem[]> {
    const lang = (options.language || 'en').toLowerCase();
    const countryCode = (options.countryCode || (options.region.length === 2 ? options.region : 'US')).toUpperCase();
    const feeds = selectFeedsForQuery(
      [query, ...(options.expandedTerms || [])].join(' '),
      lang,
      countryCode
    );
    if (feeds.length === 0) return [];

    const feedBatches = await Promise.all(feeds.map((f) => fetchPublisherFeed(f)));
    const allEntries = feedBatches.flat();
    if (allEntries.length === 0) return [];

    const searchTerms = [query, ...(options.expandedTerms || [])].filter(Boolean);
    const scored = allEntries
      .map((entry) => ({
        entry,
        score: scoreRssEntryMatch(entry, searchTerms, options.exclusions || []),
      }))
      .filter((x) => x.score > 0);

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tA = Date.parse(a.entry.pubDate || '') || 0;
      const tB = Date.parse(b.entry.pubDate || '') || 0;
      return tB - tA;
    });

    const seenLinks = new Set<string>();
    const results: RawDiscoveredItem[] = [];
    for (const {entry} of scored) {
      if (seenLinks.has(entry.link)) continue;
      seenLinks.add(entry.link);
      results.push({
        title: entry.title,
        description: entry.description,
        contentType: 'news',
        originalUrl: entry.link,
        sourceName: entry.sourceName,
        publisherDomainHint: entry.link,
        author: entry.author,
        thumbnailUrl: entry.thumbnailUrl,
        publishedAt: entry.pubDate,
        language: entry.language,
        publicationRegion: options.region.toUpperCase(),
        publisherCountry: entry.country,
        providerName: this.name,
      });
      if (results.length >= options.maxResults) break;
    }

    return results;
  }
}
