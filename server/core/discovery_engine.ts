import {normalizeLanguageList, normalizeRegionList} from '../../shared/locale';
import type {
  ContentType,
  DiscoveryQueryLog,
  DiscoveryRunSummary,
  ProviderHealthMetric,
  ProviderStatusInfo,
} from '../../shared/types';
import {APP_CONFIG} from '../config';
import {getDb} from '../db/database';
import {ArxivProvider} from '../providers/arxiv';
import {ProviderRateLimitError, type DiscoveryProvider} from '../providers/base';
import {CrossrefProvider} from '../providers/crossref';
import {GoogleNewsProvider} from '../providers/google_news';
import {HackerNewsProvider} from '../providers/hacker_news';
import {OpenAlexProvider} from '../providers/openalex';
import {RssPublishersProvider} from '../providers/rss_publishers';
import {SemanticScholarProvider} from '../providers/semantic_scholar';
import {YouTubeProvider} from '../providers/youtube';
import {listCategories} from '../services/category_service';
import {getPreferences} from '../services/preference_service';
import {findDuplicateCandidate, type ExistingDedupeCandidate} from './deduplicator';
import {selectOutdatedNonSavedItemIds, type SyncTagLink} from './feed_sync';
import {classifyFilmContent} from './film_classifier';
import {removeContentFtsIndex, syncContentFtsIndex} from './fts_search';
import {normalizeRawItem} from './normalizer';
import {buildDiscoveryQueries, type QueryTagInput} from './query_builder';
import {computeRelevanceScore, containsExcludedTerm} from './relevance';

const PROVIDERS: DiscoveryProvider[] = [
  new RssPublishersProvider(),
  new GoogleNewsProvider(),
  new CrossrefProvider(),
  new ArxivProvider(),
  new OpenAlexProvider(),
  new SemanticScholarProvider(),
  new HackerNewsProvider(),
  new YouTubeProvider(),
];

export function getProviderStatusList(): ProviderStatusInfo[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM provider_status').all() as Array<{
    provider_name: string;
    is_enabled: number;
    is_configured: number;
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
  }>;
  const rowMap = new Map(rows.map((r) => [r.provider_name, r]));

  return PROVIDERS.map((p) => {
    const row = rowMap.get(p.name);
    const configured = p.isConfigured();
    return {
      providerName: p.name,
      displayName: p.displayName,
      contentType: p.contentType,
      isEnabled: row ? row.is_enabled === 1 : configured,
      isConfigured: configured,
      supportsMultiLanguage: p.supportsMultiLanguage,
      supportsMultiRegion: p.supportsMultiRegion,
      localeLimitationNote: p.localeLimitationNote,
      lastRunAt: row?.last_run_at || null,
      lastSuccessAt: row?.last_success_at || null,
      lastError: row?.last_error || null,
      consecutiveFailures: row?.consecutive_failures || 0,
      note: p.getStatusNote(),
    };
  });
}

export function setProviderEnabled(providerName: string, isEnabled: boolean): void {
  const db = getDb();
  db.prepare('UPDATE provider_status SET is_enabled = ? WHERE provider_name = ?').run(
    isEnabled ? 1 : 0,
    providerName
  );
}

export function getProviderHealthMetrics(): ProviderHealthMetric[] {
  const db = getDb();
  const statusRows = db.prepare('SELECT * FROM provider_status').all() as Array<{
    provider_name: string;
    is_enabled: number;
    is_configured: number;
    last_run_at: string | null;
    last_error: string | null;
    rate_limit_reset_at: string | null;
  }>;
  const statusMap = new Map(statusRows.map((r) => [r.provider_name, r]));

  const aggRows = db
    .prepare(
      `SELECT provider_name,
              COUNT(*) AS total_runs,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_runs,
              SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) AS rate_limited_runs,
              ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END)) AS avg_latency_ms,
              COALESCE(SUM(items_found), 0) AS total_found,
              COALESCE(SUM(items_added), 0) AS total_added
       FROM discovery_queries
       WHERE executed_at >= datetime('now', '-30 days')
       GROUP BY provider_name`
    )
    .all() as Array<{
    provider_name: string;
    total_runs: number;
    success_runs: number;
    error_runs: number;
    rate_limited_runs: number;
    avg_latency_ms: number | null;
    total_found: number;
    total_added: number;
  }>;
  const aggMap = new Map(aggRows.map((r) => [r.provider_name, r]));

  return PROVIDERS.map((p) => {
    const st = statusMap.get(p.name);
    const agg = aggMap.get(p.name);
    const configured = p.isConfigured();
    const totalRuns = agg?.total_runs || 0;
    const successRuns = agg?.success_runs || 0;
    return {
      providerName: p.name,
      displayName: p.displayName,
      contentType: p.contentType,
      isEnabled: st ? st.is_enabled === 1 : configured,
      isConfigured: configured,
      totalRuns,
      successRuns,
      errorRuns: agg?.error_runs || 0,
      rateLimitedRuns: agg?.rate_limited_runs || 0,
      successRatePct: totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : null,
      avgLatencyMs: agg?.avg_latency_ms ?? null,
      totalFound: agg?.total_found || 0,
      totalAdded: agg?.total_added || 0,
      rateLimitResetAt: st?.rate_limit_reset_at || null,
      lastRunAt: st?.last_run_at || null,
      lastError: st?.last_error || null,
    };
  });
}

export function getRecentDiscoveryLogs(limit = 30): DiscoveryQueryLog[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT dq.*, t.name AS tag_name
       FROM discovery_queries dq
       LEFT JOIN tags t ON t.id = dq.tag_id
       ORDER BY dq.executed_at DESC, dq.id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    id: number;
    provider_name: string;
    query_text: string;
    language: string | null;
    region: string | null;
    tag_id: number | null;
    tag_name: string | null;
    status: 'success' | 'error' | 'rate_limited';
    items_found: number;
    items_added: number;
    duration_ms: number | null;
    error_message: string | null;
    executed_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    providerName: r.provider_name,
    queryText: r.query_text,
    language: r.language,
    region: r.region,
    tagId: r.tag_id,
    tagName: r.tag_name,
    status: r.status,
    itemsFound: r.items_found,
    itemsAdded: r.items_added,
    durationMs: r.duration_ms ?? null,
    errorMessage: r.error_message,
    executedAt: r.executed_at,
  }));
}

export function syncFeedWithPreferences(scopedCategoryId?: number): number {
  const db = getDb();
  const prefs = getPreferences();
  const customLangCodes = prefs.customLanguages.map((l) => l.code);
  const customRegCodes = prefs.customRegions.map((r) => r.code);
  const statuses = getProviderStatusList();
  const enabledProviders = new Set(
    statuses.filter((s) => s.isEnabled && s.isConfigured).map((s) => s.providerName)
  );

  const itemRows = db
    .prepare(
      `SELECT ci.id, ci.content_type, ci.language, ci.publication_region, ci.publisher_country,
              ci.provider_name, COALESCE(uf.is_saved, 0) AS is_saved
       FROM content_items ci
       LEFT JOIN user_feedback uf ON uf.content_id = ci.id`
    )
    .all() as Array<{
    id: number;
    content_type: ContentType;
    language: string;
    publication_region: string | null;
    publisher_country: string | null;
    provider_name: string;
    is_saved: number;
  }>;

  if (itemRows.length === 0) return 0;

  const linkRows = db
    .prepare(
      `SELECT ct.content_id,
              c.id AS category_id,
              c.is_enabled AS category_is_enabled,
              t.is_enabled AS tag_is_enabled,
              c.languages AS category_languages,
              c.regions AS category_regions
       FROM content_tags ct
       JOIN tags t ON t.id = ct.tag_id
       JOIN categories c ON c.id = t.category_id`
    )
    .all() as Array<{
    content_id: number;
    category_id: number;
    category_is_enabled: number;
    tag_is_enabled: number;
    category_languages: string | null;
    category_regions: string | null;
  }>;

  const linksByContent = new Map<number, SyncTagLink[]>();
  for (const lr of linkRows) {
    let catLangs: string[] | null = null;
    let catRegs: string[] | null = null;
    if (lr.category_languages) {
      try {
        const parsed = JSON.parse(lr.category_languages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          catLangs = normalizeLanguageList(parsed, [], customLangCodes);
        }
      } catch {
        // Ignore malformed
      }
    }
    if (lr.category_regions) {
      try {
        const parsed = JSON.parse(lr.category_regions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          catRegs = normalizeRegionList(parsed, [], customRegCodes);
        }
      } catch {
        // Ignore malformed
      }
    }

    const arr = linksByContent.get(lr.content_id) || [];
    arr.push({
      categoryId: lr.category_id,
      categoryIsEnabled: lr.category_is_enabled === 1,
      tagIsEnabled: lr.tag_is_enabled === 1,
      categoryLanguages: catLangs,
      categoryRegions: catRegs,
    });
    linksByContent.set(lr.content_id, arr);
  }

  // If scoping to a single category, only prune non-saved items that are attached to that category
  // (or completely orphaned items with no tag links at all) so other categories remain intact.
  const candidates = itemRows
    .filter((r) => {
      if (typeof scopedCategoryId !== 'number') return true;
      const links = linksByContent.get(r.id) || [];
      return links.length === 0 || links.some((l) => l.categoryId === scopedCategoryId);
    })
    .map((r) => ({
      item: {
        id: r.id,
        contentType: r.content_type,
        language: r.language,
        publicationRegion: r.publication_region,
        publisherCountry: r.publisher_country,
        providerName: r.provider_name,
        isSaved: r.is_saved === 1,
      },
      links: linksByContent.get(r.id) || [],
    }));

  const outdatedIds = selectOutdatedNonSavedItemIds(
    candidates,
    {
      languages: prefs.languages,
      regions: prefs.regions,
      customRegions: prefs.customRegions,
      enabledProviders,
    },
    scopedCategoryId ?? 'all'
  );

  if (outdatedIds.length === 0) return 0;

  const delStmt = db.prepare('DELETE FROM content_items WHERE id = ?');
  for (const id of outdatedIds) {
    delStmt.run(id);
    removeContentFtsIndex(db, id);
  }
  return outdatedIds.length;
}

let activeDiscoveryPromise: Promise<DiscoveryRunSummary> | null = null;

export function isDiscoveryRunning(): boolean {
  return activeDiscoveryPromise !== null;
}

export async function runDiscovery(options?: {
  categoryId?: number;
  contentTypes?: ContentType[];
  force?: boolean;
}): Promise<DiscoveryRunSummary> {
  if (activeDiscoveryPromise) {
    return activeDiscoveryPromise;
  }

  activeDiscoveryPromise = executeDiscoveryPipeline(options).finally(() => {
    activeDiscoveryPromise = null;
  });

  return activeDiscoveryPromise;
}

async function executeDiscoveryPipeline(options?: {
  categoryId?: number;
  contentTypes?: ContentType[];
  force?: boolean;
}): Promise<DiscoveryRunSummary> {
  const startedAt = new Date().toISOString();
  const db = getDb();

  // Synchronize existing feed with latest active preferences first, preserving all saved items
  const itemsPruned = syncFeedWithPreferences(options?.categoryId);

  const prefs = getPreferences();
  const categories = listCategories();

  const targetCategories = categories.filter(
    (c) => c.isEnabled && (!options?.categoryId || c.id === options.categoryId)
  );

  const activeTags: QueryTagInput[] = [];
  const tagCategoryNameMap = new Map<number, string>();
  for (const cat of targetCategories) {
    const effectiveLanguages = cat.languages && cat.languages.length > 0 ? cat.languages : prefs.languages;
    const effectiveRegions = cat.regions && cat.regions.length > 0 ? cat.regions : prefs.regions;
    for (const tag of cat.tags) {
      if (!tag.isEnabled) continue;
      tagCategoryNameMap.set(tag.id, cat.name);
      activeTags.push({
        id: tag.id,
        categoryId: cat.id,
        categoryName: cat.name,
        name: tag.name,
        priority: tag.priority,
        expandedTerms: tag.relations
          .filter((r) => r.relationType === 'expanded' && r.isEnabled)
          .map((r) => r.term),
        exclusions: tag.relations
          .filter((r) => r.relationType === 'exclusion' && r.isEnabled)
          .map((r) => r.term),
        languages: effectiveLanguages,
        regions: effectiveRegions,
      });
    }
  }

  if (activeTags.length === 0) {
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      queriesExecuted: 0,
      itemsDiscovered: 0,
      itemsAdded: 0,
      itemsPruned,
      duplicatesMerged: 0,
      errors: [],
    };
  }

  const statuses = getProviderStatusList();
  const nowIso = new Date().toISOString();
  const enabledProviders = PROVIDERS.filter((p) => {
    const st = statuses.find((s) => s.providerName === p.name);
    if (!p.isConfigured() || (st && !st.isEnabled)) return false;
    if (options?.contentTypes && !options.contentTypes.includes(p.contentType)) return false;

    const rateRow = db
      .prepare('SELECT rate_limit_reset_at FROM provider_status WHERE provider_name = ?')
      .get(p.name) as {rate_limit_reset_at: string | null} | undefined;
    if (rateRow?.rate_limit_reset_at && rateRow.rate_limit_reset_at > nowIso) {
      return false;
    }
    return true;
  });

  const queries = buildDiscoveryQueries(
    activeTags,
    enabledProviders.map((p) => p.name),
    APP_CONFIG.maxQueriesPerRun,
    {
      languages: prefs.languages,
      regions: prefs.regions,
      customRegions: prefs.customRegions,
    }
  );

  // Load existing dedupe candidates once for fast in-memory matching
  const existingRows = db
    .prepare('SELECT id, title, content_type, canonical_url, doi, external_id, published_at, film_category FROM content_items')
    .all() as Array<{
    id: number;
    title: string;
    content_type: ContentType;
    canonical_url: string;
    doi: string | null;
    external_id: string | null;
    published_at: string | null;
    film_category: 'about_film' | 'to_watch' | null;
  }>;

  const dedupePool: ExistingDedupeCandidate[] = existingRows.map((r) => ({
    id: r.id,
    title: r.title,
    contentType: r.content_type,
    canonicalUrl: r.canonical_url,
    doi: r.doi,
    externalId: r.external_id,
    publishedAt: r.published_at,
  }));
  const existingFilmCatMap = new Map<number, 'about_film' | 'to_watch' | null>(
    existingRows.map((r) => [r.id, r.film_category])
  );

  const insertContent = db.prepare(`
    INSERT INTO content_items (
      title, description, content_type, film_category, original_url, canonical_url, doi, external_id,
      source_name, source_domain, author, thumbnail_url, published_at, discovered_at,
      language, publication_region, publisher_country, duration, open_access_url, metadata_quality, base_score, provider_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateFilmCat = db.prepare(`UPDATE content_items SET film_category = ? WHERE id = ?`);
  const insertContentTag = db.prepare(`
    INSERT OR IGNORE INTO content_tags (content_id, tag_id, match_type, matched_term)
    VALUES (?, ?, ?, ?)
  `);
  const logQuery = db.prepare(`
    INSERT INTO discovery_queries (provider_name, query_text, language, region, tag_id, status, items_found, items_added, duration_ms, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Filter out recently executed queries unless forced
  const pendingQueries = queries.filter((q) => {
    if (options?.force) return true;
    const recent = db
      .prepare(
        `SELECT id FROM discovery_queries
         WHERE provider_name = ? AND query_text = ?
           AND COALESCE(language, '') = ? AND COALESCE(region, '') = ?
           AND status = 'success'
           AND executed_at > datetime('now', '-10 minutes')
         LIMIT 1`
      )
      .get(q.provider, q.queryString, q.language, q.region);
    return !recent;
  });

  let queriesExecuted = 0;
  let itemsDiscovered = 0;
  let itemsAdded = 0;
  let duplicatesMerged = 0;
  const errors: string[] = [];

  const CONCURRENCY = 3;
  for (let offset = 0; offset < pendingQueries.length; offset += CONCURRENCY) {
    const batch = pendingQueries.slice(offset, offset + CONCURRENCY);
    const fetchedBatch = await Promise.all(
      batch.map(async (q) => {
        const provider = PROVIDERS.find((p) => p.name === q.provider);
        if (!provider) return null;
        db.prepare('UPDATE provider_status SET last_run_at = ? WHERE provider_name = ?').run(
          new Date().toISOString(),
          provider.name
        );
        const t0 = Date.now();
        try {
          const rawItems = await provider.search(q.queryString, {
            language: q.language,
            region: q.region,
            countryCode: q.countryCode,
            queryLocation: q.queryLocation,
            expandedTerms: q.expandedTerms,
            exclusions: q.exclusions,
            maxResults: 25,
          });
          return {q, provider, rawItems, durationMs: Math.max(1, Date.now() - t0), error: null as unknown};
        } catch (err) {
          return {q, provider, rawItems: null, durationMs: Math.max(1, Date.now() - t0), error: err};
        }
      })
    );

    for (const outcome of fetchedBatch) {
      if (!outcome) continue;
      const {q, provider, rawItems, durationMs, error} = outcome;
      queriesExecuted++;

      if (error || !rawItems) {
        const msg = error instanceof Error ? error.message : 'Discovery failed';
        errors.push(`${provider.displayName} (${q.language}/${q.region}): ${msg}`);

        if (error instanceof ProviderRateLimitError) {
          const resetAt = new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString();
          logQuery.run(provider.name, q.queryString, q.language, q.region, q.tagId, 'rate_limited', 0, 0, durationMs, msg);
          db.prepare(
            `UPDATE provider_status
             SET last_error = ?, consecutive_failures = consecutive_failures + 1, rate_limit_reset_at = ?
             WHERE provider_name = ?`
          ).run(msg, resetAt, provider.name);
        } else {
          logQuery.run(provider.name, q.queryString, q.language, q.region, q.tagId, 'error', 0, 0, durationMs, msg);
          db.prepare(
            `UPDATE provider_status
             SET last_error = ?, consecutive_failures = consecutive_failures + 1
             WHERE provider_name = ?`
          ).run(msg, provider.name);
        }
        continue;
      }

      let queryAdded = 0;
      itemsDiscovered += rawItems.length;
      const categoryName = tagCategoryNameMap.get(q.tagId) || '';

      for (const raw of rawItems) {
        const normalized = normalizeRawItem(raw);
        if (!normalized) continue;

        if (containsExcludedTerm(normalized.title, normalized.description, q.exclusions)) {
          continue;
        }

        const filmCategory = classifyFilmContent({
          title: normalized.title,
          description: normalized.description,
          sourceName: normalized.sourceName,
          sourceDomain: normalized.sourceDomain,
          contentType: normalized.contentType,
          categoryNames: categoryName ? [categoryName] : [],
          tagNames: [q.tagName],
          matchedTerms: [q.matchedTerm],
        });

        const existingMatch = findDuplicateCandidate(normalized, dedupePool);
        if (existingMatch) {
          const tagRes = insertContentTag.run(existingMatch.id, q.tagId, q.matchType, q.matchedTerm);
          if (tagRes.changes > 0) {
            duplicatesMerged++;
            syncContentFtsIndex(db, existingMatch.id);
          }
          if (filmCategory && !existingFilmCatMap.get(existingMatch.id)) {
            updateFilmCat.run(filmCategory, existingMatch.id);
            existingFilmCatMap.set(existingMatch.id, filmCategory);
          }
          continue;
        }

        const discoveredAt = new Date().toISOString();
        const baseScore = computeRelevanceScore(
          {
            contentType: normalized.contentType,
            publishedAt: normalized.publishedAt,
            discoveredAt,
            metadataQuality: normalized.metadataQuality,
            matches: [{priority: q.priority, matchType: q.matchType}],
            feedbackType: null,
            isRead: false,
          },
          prefs.scoringWeights
        );

        const res = insertContent.run(
          normalized.title,
          normalized.description,
          normalized.contentType,
          filmCategory,
          normalized.originalUrl,
          normalized.canonicalUrl,
          normalized.doi,
          normalized.externalId,
          normalized.sourceName,
          normalized.sourceDomain,
          normalized.author,
          normalized.thumbnailUrl,
          normalized.publishedAt,
          discoveredAt,
          normalized.language,
          normalized.publicationRegion,
          normalized.publisherCountry,
          normalized.duration,
          normalized.openAccessUrl,
          normalized.metadataQuality,
          baseScore,
          normalized.providerName
        );

        const newId = Number(res.lastInsertRowid);
        insertContentTag.run(newId, q.tagId, q.matchType, q.matchedTerm);
        syncContentFtsIndex(db, newId);

        dedupePool.push({
          id: newId,
          title: normalized.title,
          contentType: normalized.contentType,
          canonicalUrl: normalized.canonicalUrl,
          doi: normalized.doi,
          externalId: normalized.externalId,
          publishedAt: normalized.publishedAt,
        });
        existingFilmCatMap.set(newId, filmCategory);

        queryAdded++;
        itemsAdded++;
      }

      logQuery.run(
        provider.name,
        q.queryString,
        q.language,
        q.region,
        q.tagId,
        'success',
        rawItems.length,
        queryAdded,
        durationMs,
        null
      );
      db.prepare(
        `UPDATE provider_status
         SET last_success_at = ?, last_error = NULL, consecutive_failures = 0, rate_limit_reset_at = NULL
         WHERE provider_name = ?`
      ).run(new Date().toISOString(), provider.name);
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    queriesExecuted,
    itemsDiscovered,
    itemsAdded,
    itemsPruned,
    duplicatesMerged,
    errors,
  };
}

export async function runLiveWebSearch(input: {
  query: string;
  language?: string | 'all';
}): Promise<{itemIds: number[]; totalFound: number; errors: string[]}> {
  const cleanQuery = input.query.trim();
  if (!cleanQuery) {
    return {itemIds: [], totalFound: 0, errors: []};
  }

  const db = getDb();
  const prefs = getPreferences();
  const statuses = getProviderStatusList();
  const enabledProviders = PROVIDERS.filter((p) => {
    const st = statuses.find((s) => s.providerName === p.name);
    return p.isConfigured() && (!st || st.isEnabled);
  });

  const targetLanguage =
    input.language && input.language !== 'all'
      ? input.language.toLowerCase()
      : prefs.languages[0] || 'en';
  const targetRegion = prefs.regions[0] || 'US';
  const countryCode = targetRegion.length === 2 ? targetRegion : targetRegion.split('-')[0] || 'US';

  const existingRows = db
    .prepare('SELECT id, title, content_type, canonical_url, doi, external_id, published_at FROM content_items')
    .all() as Array<{
    id: number;
    title: string;
    content_type: ContentType;
    canonical_url: string;
    doi: string | null;
    external_id: string | null;
    published_at: string | null;
  }>;

  const dedupePool: ExistingDedupeCandidate[] = existingRows.map((r) => ({
    id: r.id,
    title: r.title,
    contentType: r.content_type,
    canonicalUrl: r.canonical_url,
    doi: r.doi,
    externalId: r.external_id,
    publishedAt: r.published_at,
  }));

  const insertContent = db.prepare(`
    INSERT INTO content_items (
      title, description, content_type, film_category, original_url, canonical_url, doi, external_id,
      source_name, source_domain, author, thumbnail_url, published_at, discovered_at,
      language, publication_region, publisher_country, duration, open_access_url, metadata_quality, base_score, provider_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const providerCalls = enabledProviders.map(async (provider) => {
    const queryStr =
      provider.name === 'arxiv'
        ? cleanQuery.includes(' ')
          ? `(ti:"${cleanQuery}" OR abs:"${cleanQuery}")`
          : `(ti:${cleanQuery} OR abs:${cleanQuery})`
        : cleanQuery;
    try {
      const items = await provider.search(queryStr, {
        language: targetLanguage,
        region: targetRegion,
        countryCode,
        maxResults: 25,
      });
      return {provider, items, error: null as unknown};
    } catch (err) {
      return {provider, items: [], error: err};
    }
  });

  const results = await Promise.all(providerCalls);
  const itemIds: number[] = [];
  const seenIds = new Set<number>();
  const errors: string[] = [];

  for (const res of results) {
    if (res.error) {
      errors.push(`${res.provider.displayName}: ${res.error instanceof Error ? res.error.message : 'Search failed'}`);
      continue;
    }

    for (const raw of res.items) {
      const normalized = normalizeRawItem(raw);
      if (!normalized) continue;

      const existing = findDuplicateCandidate(normalized, dedupePool);
      if (existing) {
        if (!seenIds.has(existing.id)) {
          seenIds.add(existing.id);
          itemIds.push(existing.id);
        }
        continue;
      }

      const discoveredAt = new Date().toISOString();
      const baseScore = computeRelevanceScore(
        {
          contentType: normalized.contentType,
          publishedAt: normalized.publishedAt,
          discoveredAt,
          metadataQuality: normalized.metadataQuality,
          matches: [{priority: 4, matchType: 'direct'}],
          feedbackType: null,
          isRead: false,
        },
        prefs.scoringWeights
      );

      const inserted = insertContent.run(
        normalized.title,
        normalized.description,
        normalized.contentType,
        null,
        normalized.originalUrl,
        normalized.canonicalUrl,
        normalized.doi,
        normalized.externalId,
        normalized.sourceName,
        normalized.sourceDomain,
        normalized.author,
        normalized.thumbnailUrl,
        normalized.publishedAt,
        discoveredAt,
        normalized.language,
        normalized.publicationRegion,
        normalized.publisherCountry,
        normalized.duration,
        normalized.openAccessUrl,
        normalized.metadataQuality,
        baseScore,
        normalized.providerName
      );

      const newId = Number(inserted.lastInsertRowid);
      syncContentFtsIndex(db, newId);
      dedupePool.push({
        id: newId,
        title: normalized.title,
        contentType: normalized.contentType,
        canonicalUrl: normalized.canonicalUrl,
        doi: normalized.doi,
        externalId: normalized.externalId,
        publishedAt: normalized.publishedAt,
      });
      if (!seenIds.has(newId)) {
        seenIds.add(newId);
        itemIds.push(newId);
      }
    }
  }

  return {itemIds, totalFound: itemIds.length, errors};
}

