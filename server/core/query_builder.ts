import {resolveRegionMeta} from '../../shared/locale';
import type {ContentType, CustomRegion, TopicDomain} from '../../shared/types';
import {
  detectTopicDomain,
  HIDDEN_GEMS_TAG_NAME,
  previewTagSuggestions,
  translateTagForLanguage,
} from './domain_expansion';

export type DiscoveryProviderName =
  | 'google_news'
  | 'rss_publishers'
  | 'crossref'
  | 'arxiv'
  | 'openalex'
  | 'semantic_scholar'
  | 'hacker_news'
  | 'youtube';

export interface QueryTagInput {
  id: number;
  categoryId?: number;
  categoryName?: string;
  name: string;
  priority: number;
  expandedTerms: string[];
  exclusions: string[];
  languages?: string[];
  regions?: string[];
}

export interface BuiltQuery {
  tagId: number;
  tagName: string;
  priority: number;
  domain: TopicDomain;
  provider: DiscoveryProviderName;
  contentType: ContentType;
  queryString: string;
  matchType: 'direct' | 'expanded';
  matchedTerm: string;
  expandedTerms?: string[];
  exclusions: string[];
  language: string;
  region: string;
  countryCode: string;
  queryLocation?: string | null;
}

// Broad single-word concepts benefit from contextual disambiguation in news/video searches
const BROAD_TERM_CONTEXT: Record<string, string> = {
  chemistry: 'chemistry research OR chemical',
  python: 'python programming OR software',
  science: 'scientific discovery OR research',
  space: 'space exploration OR astronomy',
  technology: 'technology engineering OR computing',
  physics: 'physics research OR experiment',
  biology: 'biology research OR genomics',
  cinema: 'cinema OR arthouse film OR filmmaking',
};

const HIDDEN_GEM_NEWS_QUERIES: Record<string, string> = {
  en: 'hidden gem movies to watch OR underrated indie films',
  pt: 'filmes pouco conhecidos OR dicas de filmes cinema independente',
  es: 'películas recomendadas cine independiente OR películas poco conocidas',
  fr: 'films méconnus OR films à voir cinéma indépendant',
  de: 'Geheimtipp Filme OR Independent-Kino Empfehlungen',
  it: 'film poco conosciuti OR cinema indipendente consigli',
  ja: '隠れた名作 映画 OR インディーズ映画 おすすめ',
  ko: '숨은 명작 영화 OR 독립영화 추천',
};

export function suggestExpandedTerms(tagName: string, categoryName = ''): string[] {
  return previewTagSuggestions(tagName, {categoryName}).suggestions.map((s) => s.term);
}

export function formatNewsQuery(
  term: string,
  exclusions: string[],
  language = 'en',
  locationModifier?: string | null
): string {
  const normalized = term.trim().toLowerCase();
  let base: string;
  if (normalized === HIDDEN_GEMS_TAG_NAME.toLowerCase() || normalized === 'hidden gems') {
    base = HIDDEN_GEM_NEWS_QUERIES[language] || HIDDEN_GEM_NEWS_QUERIES.en;
  } else if (BROAD_TERM_CONTEXT[normalized]) {
    base = `(${BROAD_TERM_CONTEXT[normalized]})`;
  } else if (term.includes('"') || /\bOR\b/.test(term)) {
    base = term.trim();
  } else if (term.includes(' ')) {
    base = `"${term.trim()}"`;
  } else {
    base = term.trim();
  }

  const parts = [base];
  if (locationModifier && locationModifier.trim()) {
    const loc = locationModifier.trim();
    parts.push(loc.includes(' ') ? `"${loc}"` : loc);
  }

  const negations = exclusions
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((e) => (e.includes(' ') ? `-"${e}"` : `-${e}`));

  return [...parts, ...negations].join(' ');
}

export function formatPublisherNewsQuery(
  term: string,
  exclusions: string[],
  language: string,
  countryCode: string,
  locationModifier?: string | null
): string | null {
  const normalized = term.trim().toLowerCase();
  const base =
    normalized === HIDDEN_GEMS_TAG_NAME.toLowerCase() || normalized === 'hidden gems'
      ? language === 'pt'
        ? '(cinema OR filmes)'
        : '(cinema OR film OR movies)'
      : term.includes(' ')
        ? `"${term.trim()}"`
        : term.trim();

  const negations = exclusions
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((e) => (e.includes(' ') ? `-"${e}"` : `-${e}`));

  if (countryCode === 'BR' || language === 'pt') {
    const locPart = locationModifier?.trim() ? ` "${locationModifier.trim()}"` : '';
    return `${base}${locPart} ("O Povo" OR Estadão OR "O Globo" OR Folha OR G1 OR "Agência Brasil") ${negations.join(' ')}`.trim();
  }

  if (language === 'en') {
    const locPart = locationModifier?.trim() ? ` "${locationModifier.trim()}"` : '';
    return `${base}${locPart} (Reuters OR "Associated Press" OR BBC OR "The Guardian") ${negations.join(' ')}`.trim();
  }

  return null;
}

export function formatArxivQuery(term: string, exclusions: string[]): string {
  const clean = term.trim().replace(/"/g, '');
  const base = clean.includes(' ')
    ? `(ti:"${clean}" OR abs:"${clean}")`
    : `(ti:${clean} OR abs:${clean})`;
  const negations = exclusions
    .map((e) => e.trim().replace(/"/g, ''))
    .filter(Boolean)
    .slice(0, 3)
    .map((e) => (e.includes(' ') ? `ANDNOT all:"${e}"` : `ANDNOT all:${e}`));

  return [base, ...negations].join(' ');
}

export function formatCrossrefQuery(term: string, exclusions: string[]): string {
  void exclusions;
  return term.trim();
}

export function formatYoutubeQuery(term: string, exclusions: string[], language = 'en'): string {
  const clean = term.trim();
  const normalized = clean.toLowerCase();
  let base: string;
  if (normalized === HIDDEN_GEMS_TAG_NAME.toLowerCase() || normalized === 'hidden gems') {
    base =
      language === 'pt'
        ? 'filmes pouco conhecidos cinema independente recomendação'
        : language === 'es'
          ? 'películas poco conocidas cine independiente recomendaciones'
          : language === 'fr'
            ? 'films méconnus cinéma indépendant recommandation'
            : 'hidden gem underrated indie films to watch';
  } else {
    base = BROAD_TERM_CONTEXT[normalized] ? `${clean} lecture OR documentary` : clean;
  }
  const negations = exclusions
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((e) => `-${e}`);
  return [base, ...negations].join(' ');
}

export function buildLocalePairs(
  languagesInput?: string[],
  regionsInput?: string[],
  maxPairs = 6,
  customRegions: CustomRegion[] = []
): Array<{
  language: string;
  region: string;
  countryCode: string;
  queryLocation: string | null;
}> {
  const languages = (languagesInput && languagesInput.length > 0 ? languagesInput : ['en']).map((l) =>
    l.toLowerCase()
  );
  const regions = (regionsInput && regionsInput.length > 0 ? regionsInput : ['US']).map((r) =>
    r.toUpperCase()
  );

  const regionMetaMap = new Map(regions.map((r) => [r, resolveRegionMeta(r, customRegions)]));
  const pairs: Array<{
    language: string;
    region: string;
    countryCode: string;
    queryLocation: string | null;
  }> = [];
  const seen = new Set<string>();

  const pushPair = (language: string, region: string) => {
    const key = `${language}:${region}`;
    if (!seen.has(key)) {
      seen.add(key);
      const meta = regionMetaMap.get(region) || resolveRegionMeta(region, customRegions);
      pairs.push({
        language,
        region,
        countryCode: meta.countryCode,
        queryLocation: meta.queryLocation,
      });
    }
  };

  // 1. Cover every selected region with its matching selected language (or primary selected language)
  for (const reg of regions) {
    const nativeLang = regionMetaMap.get(reg)?.defaultLanguage;
    if (nativeLang && languages.includes(nativeLang)) {
      pushPair(nativeLang, reg);
    } else {
      pushPair(languages[0], reg);
    }
  }

  // 2. Ensure every selected language is represented across a natural region if available
  for (const lang of languages) {
    const alreadyCovered = pairs.some((p) => p.language === lang);
    if (!alreadyCovered) {
      const matchingRegion =
        regions.find((r) => regionMetaMap.get(r)?.defaultLanguage === lang) || regions[0];
      pushPair(lang, matchingRegion);
    }
  }

  // 3. Cross-region/language combinations up to maxPairs
  for (const lang of languages) {
    for (const reg of regions) {
      if (pairs.length >= maxPairs) break;
      pushPair(lang, reg);
    }
  }

  return pairs.slice(0, maxPairs);
}

function interleaveTagsByCategory(tags: QueryTagInput[]): QueryTagInput[] {
  const buckets = new Map<number, QueryTagInput[]>();
  for (const t of tags) {
    const key = t.categoryId ?? 0;
    const list = buckets.get(key) || [];
    list.push(t);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => b.priority - a.priority);
  }

  const interleaved: QueryTagInput[] = [];
  const queues = Array.from(buckets.values());
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) {
        interleaved.push(next);
        remaining = true;
      }
    }
  }
  return interleaved;
}

export function buildDiscoveryQueries(
  tags: QueryTagInput[],
  enabledProviders: DiscoveryProviderName[],
  maxQueries = 42,
  globalLocale?: {languages: string[]; regions: string[]; customRegions?: CustomRegion[]}
): BuiltQuery[] {
  const orderedTags = interleaveTagsByCategory(tags);
  const primaryDirectQueues: BuiltQuery[][] = [];
  const secondaryLocaleQueues: BuiltQuery[][] = [];
  const expandedQueries: BuiltQuery[] = [];

  for (const tag of orderedTags) {
    const domain = detectTopicDomain(tag.name, tag.categoryName || '');
    const langs =
      tag.languages && tag.languages.length > 0 ? tag.languages : globalLocale?.languages || ['en'];
    const regs =
      tag.regions && tag.regions.length > 0 ? tag.regions : globalLocale?.regions || ['US'];
    const localePairs = buildLocalePairs(langs, regs, 6, globalLocale?.customRegions || []);

    const tagPrimaryQueue: BuiltQuery[] = [];
    const tagSecondaryQueue: BuiltQuery[] = [];

    // Domain-aware provider routing: do not send non-academic cinema/entertainment tags to academic/HN providers
    const isTechGeopolitics =
      domain === 'geopolitics' &&
      /\b(tech|cyber|ai|chip|semiconductor|space|satellite|military technology|nuclear)\b/i.test(
        tag.name
      );
    const applicableProviders = enabledProviders.filter((p) => {
      if (
        domain === 'entertainment' &&
        (p === 'arxiv' ||
          p === 'crossref' ||
          p === 'openalex' ||
          p === 'semantic_scholar' ||
          p === 'hacker_news')
      ) {
        return false;
      }
      if (p === 'hacker_news' && domain === 'geopolitics' && !isTechGeopolitics) {
        return false;
      }
      return true;
    });

    for (const provider of applicableProviders) {
      const contentType: ContentType =
        provider === 'google_news' || provider === 'rss_publishers'
          ? 'news'
          : provider === 'youtube'
            ? 'video'
            : 'article';

      if (provider === 'arxiv') {
        tagPrimaryQueue.push({
          tagId: tag.id,
          tagName: tag.name,
          priority: tag.priority,
          domain,
          provider,
          contentType,
          queryString: formatArxivQuery(tag.name, tag.exclusions),
          matchType: 'direct',
          matchedTerm: tag.name,
          exclusions: tag.exclusions,
          language: 'en',
          region: 'GLOBAL',
          countryCode: 'US',
        });
        continue;
      }

      if (provider === 'crossref' || provider === 'openalex') {
        const seenTerms = new Set<string>();
        langs.forEach((lang, idx) => {
          const translated = translateTagForLanguage(tag.name, lang, domain) || tag.name;
          const key = translated.toLowerCase();
          if (seenTerms.has(key)) return;
          seenTerms.add(key);

          const built: BuiltQuery = {
            tagId: tag.id,
            tagName: tag.name,
            priority: tag.priority,
            domain,
            provider,
            contentType,
            queryString: formatCrossrefQuery(translated, tag.exclusions),
            matchType: 'direct',
            matchedTerm: translated,
            exclusions: tag.exclusions,
            language: lang,
            region: 'GLOBAL',
            countryCode: 'US',
          };
          if (idx === 0) tagPrimaryQueue.push(built);
          else tagSecondaryQueue.push(built);
        });

        if (orderedTags.length === 1 && tag.expandedTerms.length > 0) {
          const expTerm = tag.expandedTerms[0];
          if (expTerm && expTerm.trim() && !seenTerms.has(expTerm.trim().toLowerCase())) {
            expandedQueries.push({
              tagId: tag.id,
              tagName: tag.name,
              priority: tag.priority,
              domain,
              provider,
              contentType,
              queryString: formatCrossrefQuery(expTerm, tag.exclusions),
              matchType: 'expanded',
              matchedTerm: expTerm.trim(),
              exclusions: tag.exclusions,
              language: langs[0] || 'en',
              region: 'GLOBAL',
              countryCode: 'US',
              queryLocation: null,
            });
          }
        }
        continue;
      }

      if (provider === 'semantic_scholar' || provider === 'hacker_news') {
        tagPrimaryQueue.push({
          tagId: tag.id,
          tagName: tag.name,
          priority: tag.priority,
          domain,
          provider,
          contentType,
          queryString: tag.name.trim(),
          matchType: 'direct',
          matchedTerm: tag.name,
          exclusions: tag.exclusions,
          language: 'en',
          region: 'GLOBAL',
          countryCode: 'US',
        });
        continue;
      }

      if (provider === 'rss_publishers') {
        // Direct RSS feeds support EN & PT publications (BBC, The Guardian, G1, Folha, Agência Brasil)
        const rssPairs = localePairs.filter((p) => p.language === 'en' || p.language === 'pt');
        const seenRssLangs = new Set<string>();
        rssPairs.forEach((pair, idx) => {
          const key = `${pair.language}:${pair.region}`;
          if (seenRssLangs.has(key)) return;
          seenRssLangs.add(key);

          const isHiddenGems =
            tag.name.trim().toLowerCase() === HIDDEN_GEMS_TAG_NAME.toLowerCase() ||
            tag.name.trim().toLowerCase() === 'hidden gems';
          const translatedTerm = isHiddenGems
            ? tag.name
            : translateTagForLanguage(tag.name, pair.language, domain) || tag.name;

          const built: BuiltQuery = {
            tagId: tag.id,
            tagName: tag.name,
            priority: tag.priority,
            domain,
            provider,
            contentType: 'news',
            queryString: translatedTerm,
            matchType: 'direct',
            matchedTerm: translatedTerm,
            expandedTerms: tag.expandedTerms,
            exclusions: tag.exclusions,
            language: pair.language,
            region: pair.region,
            countryCode: pair.countryCode,
            queryLocation: pair.queryLocation,
          };
          if (idx === 0) tagPrimaryQueue.push(built);
          else tagSecondaryQueue.push(built);
        });
        continue;
      }

      // Google News RSS (with Bing News RSS fallback) and YouTube Data API
      localePairs.forEach((pair, idx) => {
        const isHiddenGems =
          tag.name.trim().toLowerCase() === HIDDEN_GEMS_TAG_NAME.toLowerCase() ||
          tag.name.trim().toLowerCase() === 'hidden gems';
        const translatedTerm = isHiddenGems
          ? tag.name
          : translateTagForLanguage(tag.name, pair.language, domain) || tag.name;

        const queryString =
          provider === 'google_news'
            ? formatNewsQuery(translatedTerm, tag.exclusions, pair.language, pair.queryLocation)
            : formatYoutubeQuery(translatedTerm, tag.exclusions, pair.language);

        const built: BuiltQuery = {
          tagId: tag.id,
          tagName: tag.name,
          priority: tag.priority,
          domain,
          provider,
          contentType,
          queryString,
          matchType: 'direct',
          matchedTerm: translatedTerm,
          exclusions: tag.exclusions,
          language: pair.language,
          region: pair.region,
          countryCode: pair.countryCode,
          queryLocation: pair.queryLocation,
        };
        if (idx === 0) tagPrimaryQueue.push(built);
        else tagSecondaryQueue.push(built);

        // Add established international/national/regional publisher search query on google_news
        if (provider === 'google_news' && idx === 0 && tag.priority >= 3) {
          const pubQuery = formatPublisherNewsQuery(
            translatedTerm,
            tag.exclusions,
            pair.language,
            pair.countryCode,
            pair.queryLocation
          );
          if (pubQuery) {
            tagSecondaryQueue.push({
              tagId: tag.id,
              tagName: tag.name,
              priority: tag.priority,
              domain,
              provider,
              contentType: 'news',
              queryString: pubQuery,
              matchType: 'direct',
              matchedTerm: translatedTerm,
              exclusions: tag.exclusions,
              language: pair.language,
              region: pair.region,
              countryCode: pair.countryCode,
              queryLocation: pair.queryLocation,
            });
          }
        }
      });

      // Expanded terms for high-priority tags, Entertainment, or focused small tabs
      const allowExpandedForProvider =
        provider === 'google_news' || provider === 'youtube';
      if (
        allowExpandedForProvider &&
        (tag.priority >= 4 || domain === 'entertainment' || orderedTags.length <= 2) &&
        tag.expandedTerms.length > 0
      ) {
        const expCount = domain === 'entertainment' ? Math.min(2, tag.expandedTerms.length) : 1;
        for (let i = 0; i < expCount; i++) {
          const expTerm = tag.expandedTerms[i];
          const primaryPair = localePairs[0] || {
            language: 'en',
            region: 'US',
            countryCode: 'US',
            queryLocation: null,
          };
          expandedQueries.push({
            tagId: tag.id,
            tagName: tag.name,
            priority: tag.priority,
            domain,
            provider,
            contentType,
            queryString:
              provider === 'google_news'
                ? formatNewsQuery(
                    expTerm,
                    tag.exclusions,
                    primaryPair.language,
                    primaryPair.queryLocation
                  )
                : formatYoutubeQuery(expTerm, tag.exclusions, primaryPair.language),
            matchType: 'expanded',
            matchedTerm: expTerm,
            exclusions: tag.exclusions,
            language: primaryPair.language,
            region: primaryPair.region,
            countryCode: primaryPair.countryCode,
            queryLocation: primaryPair.queryLocation,
          });
        }
      }
    }

    if (tagPrimaryQueue.length > 0) primaryDirectQueues.push(tagPrimaryQueue);
    if (tagSecondaryQueue.length > 0) secondaryLocaleQueues.push(tagSecondaryQueue);
  }

  const ordered: BuiltQuery[] = [];
  const flattenQueues = (queues: BuiltQuery[][]) => {
    let active = true;
    while (active && ordered.length < maxQueries) {
      active = false;
      for (const q of queues) {
        const next = q.shift();
        if (next) {
          ordered.push(next);
          active = true;
          if (ordered.length >= maxQueries) break;
        }
      }
    }
  };

  flattenQueues(primaryDirectQueues);
  flattenQueues(secondaryLocaleQueues);
  for (const eq of expandedQueries) {
    if (ordered.length >= maxQueries) break;
    ordered.push(eq);
  }

  return ordered.slice(0, maxQueries);
}
