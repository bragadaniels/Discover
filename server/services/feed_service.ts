import {normalizeLanguageList, normalizeRegionList} from '../../shared/locale';
import type {
  CategorySelection,
  ContentItem,
  ContentTagBadge,
  FeedFilterType,
  FeedResponse,
  FeedbackType,
  FilmCategory,
  SearchMatchPreview,
  SortOption,
} from '../../shared/types';
import {doesItemMatchActivePreferences, type SyncTagLink} from '../core/feed_sync';
import {classifyFilmContent, isEntertainmentCategoryName} from '../core/film_classifier';
import {
  buildSearchMatchSegments,
  searchContentFts,
  type ContentFtsMatch,
} from '../core/fts_search';
import {computeRelevanceScore} from '../core/relevance';
import {getDb} from '../db/database';
import {getNotesMapForUrls} from './note_service';
import {getPreferences} from './preference_service';

export interface FeedQueryParams {
  categoryId?: CategorySelection;
  filter?: FeedFilterType;
  sort?: SortOption;
  search?: string;
  language?: string | 'all';
  luckySeed?: number;
  page?: number;
  pageSize?: number;
}

interface JoinedContentRow {
  id: number;
  title: string;
  description: string | null;
  content_type: 'news' | 'article' | 'video';
  film_category: FilmCategory;
  original_url: string;
  canonical_url: string;
  doi: string | null;
  external_id: string | null;
  source_name: string;
  source_domain: string;
  author: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  discovered_at: string;
  language: string;
  publication_region: string | null;
  publisher_country: string | null;
  duration: string | null;
  open_access_url: string | null;
  metadata_quality: number;
  base_score: number;
  provider_name: string;
  feedback_type: FeedbackType;
  is_read: number | null;
  is_saved: number | null;
  is_hidden: number | null;
}

interface TagJoinRow {
  content_id: number;
  tag_id: number;
  tag_name: string;
  tag_is_enabled: number;
  category_id: number;
  category_name: string;
  category_is_enabled: number;
  category_languages: string | null;
  category_regions: string | null;
  priority: number;
  match_type: 'direct' | 'expanded';
  matched_term: string;
}

function getEnabledProviderSet(): Set<string> {
  const db = getDb();
  const rows = db
    .prepare('SELECT provider_name FROM provider_status WHERE is_enabled = 1 AND is_configured = 1')
    .all() as Array<{provider_name: string}>;
  return new Set(rows.map((r) => r.provider_name));
}

function loadTagMapForContentIds(
  ids: number[],
  customLangCodes: string[],
  customRegCodes: string[]
): {
  badgesByContent: Map<number, ContentTagBadge[]>;
  syncLinksByContent: Map<number, SyncTagLink[]>;
} {
  const db = getDb();
  const badgesByContent = new Map<number, ContentTagBadge[]>();
  const syncLinksByContent = new Map<number, SyncTagLink[]>();
  if (ids.length === 0) {
    return {badgesByContent, syncLinksByContent};
  }

  const placeholders = ids.map(() => '?').join(',');
  const tagRows = db
    .prepare(
      `SELECT ct.content_id,
              ct.tag_id,
              t.name AS tag_name,
              t.is_enabled AS tag_is_enabled,
              c.id AS category_id,
              c.name AS category_name,
              c.is_enabled AS category_is_enabled,
              c.languages AS category_languages,
              c.regions AS category_regions,
              t.priority,
              ct.match_type,
              ct.matched_term
       FROM content_tags ct
       JOIN tags t ON t.id = ct.tag_id
       JOIN categories c ON c.id = t.category_id
       WHERE ct.content_id IN (${placeholders})
       ORDER BY t.priority DESC, ct.match_type ASC`
    )
    .all(...ids) as unknown as TagJoinRow[];

  for (const tr of tagRows) {
    const badgeList = badgesByContent.get(tr.content_id) || [];
    badgeList.push({
      tagId: tr.tag_id,
      tagName: tr.tag_name,
      categoryId: tr.category_id,
      categoryName: tr.category_name,
      priority: tr.priority,
      matchType: tr.match_type,
      matchedTerm: tr.matched_term,
    });
    badgesByContent.set(tr.content_id, badgeList);

    let catLangs: string[] | null = null;
    let catRegs: string[] | null = null;
    if (tr.category_languages) {
      try {
        const parsed = JSON.parse(tr.category_languages);
        if (Array.isArray(parsed) && parsed.length > 0) {
          catLangs = normalizeLanguageList(parsed, [], customLangCodes);
        }
      } catch {
        // Ignore
      }
    }
    if (tr.category_regions) {
      try {
        const parsed = JSON.parse(tr.category_regions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          catRegs = normalizeRegionList(parsed, [], customRegCodes);
        }
      } catch {
        // Ignore
      }
    }

    const syncList = syncLinksByContent.get(tr.content_id) || [];
    syncList.push({
      categoryId: tr.category_id,
      categoryIsEnabled: tr.category_is_enabled === 1,
      tagIsEnabled: tr.tag_is_enabled === 1,
      categoryLanguages: catLangs,
      categoryRegions: catRegs,
    });
    syncLinksByContent.set(tr.content_id, syncList);
  }

  return {badgesByContent, syncLinksByContent};
}

function isEntertainmentCategoryById(categoryId: CategorySelection | undefined): boolean {
  if (typeof categoryId !== 'number') return false;
  const db = getDb();
  const row = db
    .prepare('SELECT name, icon FROM categories WHERE id = ?')
    .get(categoryId) as {name: string; icon: string} | undefined;
  if (!row) return false;
  return row.icon === 'film' || isEntertainmentCategoryName(row.name);
}

function seededLuckyHash(id: number, seed: number): number {
  let x = (id * 2654435761) ^ ((seed + 1) * 1597334677);
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = (x >>> 16) ^ x;
  return (x >>> 0) / 0xffffffff;
}

function sortLuckyDiversified(items: ContentItem[], seed: number): ContentItem[] {
  const scored = items.map((item) => {
    const unreadBoost = item.isRead ? 0 : 0.35;
    const ageMs = Math.max(0, Date.now() - (Date.parse(item.publishedAt || item.discoveredAt) || 0));
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0, 0.45 * Math.pow(0.5, ageDays / 14));
    const jitter = seededLuckyHash(item.id, seed) * 0.85;
    const base = Math.min(1.5, item.relevanceScore) * 0.25;
    return {
      item,
      luckyScore: unreadBoost + recencyBoost + jitter + base,
      catKey: item.associatedTags[0]?.categoryId ?? 0,
    };
  });

  scored.sort((a, b) => b.luckyScore - a.luckyScore);

  // Interleave across categories so I'm Feeling Lucky mixes topics serendipitously
  const buckets = new Map<number, ContentItem[]>();
  for (const entry of scored) {
    const list = buckets.get(entry.catKey) || [];
    list.push(entry.item);
    buckets.set(entry.catKey, list);
  }

  const bucketList = Array.from(buckets.values());
  const offset = bucketList.length > 0 ? Math.abs(seed) % bucketList.length : 0;
  const rotated = [...bucketList.slice(offset), ...bucketList.slice(0, offset)];

  const interleaved: ContentItem[] = [];
  let active = true;
  while (active) {
    active = false;
    for (const q of rotated) {
      const next = q.shift();
      if (next) {
        interleaved.push(next);
        active = true;
      }
    }
  }
  return interleaved;
}

export function queryFeed(params: FeedQueryParams): FeedResponse {
  const db = getDb();
  const prefs = getPreferences();
  const filter = params.filter || 'all';
  const sort = params.sort || 'relevant';
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.max(5, Math.min(60, Number(params.pageSize) || 24));
  const rawSearch = (params.search || '').trim();
  const search = rawSearch.toLowerCase();
  const langFilter = params.language && params.language !== 'all' ? params.language.toLowerCase() : null;
  const isLucky = params.categoryId === 'lucky';
  const effectiveScope: number | 'all' =
    typeof params.categoryId === 'number' ? params.categoryId : 'all';
  const isScopedEntCat =
    typeof params.categoryId === 'number' ? isEntertainmentCategoryById(params.categoryId) : true;

  let ftsMatches = new Map<number, ContentFtsMatch>();
  if (rawSearch) {
    ftsMatches = searchContentFts(db, rawSearch, 800);
  }

  const affinityRows = db
    .prepare(
      `SELECT ci.source_domain,
              SUM(CASE WHEN uf.feedback_type = 'like' THEN 1 WHEN uf.feedback_type = 'dislike' THEN -1 ELSE 0 END) AS net
       FROM user_feedback uf
       JOIN content_items ci ON ci.id = uf.content_id
       WHERE uf.feedback_type IS NOT NULL
       GROUP BY ci.source_domain`
    )
    .all() as Array<{source_domain: string; net: number}>;

  const affinityMap = new Map<string, number>();
  for (const row of affinityRows) {
    affinityMap.set(row.source_domain, Math.max(-0.25, Math.min(0.25, row.net * 0.08)));
  }

  const whereClauses: string[] = ['COALESCE(uf.is_hidden, 0) = 0'];
  const sqlArgs: Array<string | number> = [];

  if (filter === 'saved') {
    // Saved reading list keeps all saved/favorited items even when active feed preferences change
    whereClauses.push('COALESCE(uf.is_saved, 0) = 1');
  } else if (typeof params.categoryId === 'number') {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM content_tags ct
      JOIN tags t ON t.id = ct.tag_id
      JOIN categories c ON c.id = t.category_id
      WHERE ct.content_id = ci.id AND c.id = ? AND t.is_enabled = 1 AND c.is_enabled = 1
    )`);
    sqlArgs.push(params.categoryId);
  } else {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM content_tags ct
      JOIN tags t ON t.id = ct.tag_id
      JOIN categories c ON c.id = t.category_id
      WHERE ct.content_id = ci.id AND t.is_enabled = 1 AND c.is_enabled = 1
    )`);
  }

  if (filter === 'news' || filter === 'article' || filter === 'video') {
    whereClauses.push('ci.content_type = ?');
    sqlArgs.push(filter);
  } else if ((filter === 'to_watch' || filter === 'about_film') && isScopedEntCat) {
    whereClauses.push('ci.film_category = ?');
    sqlArgs.push(filter);
  } else if (filter === 'unread') {
    whereClauses.push('COALESCE(uf.is_read, 0) = 0');
  } else if (filter === 'notes') {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM item_notes n
      WHERE n.canonical_url = ci.canonical_url OR n.content_item_id = ci.id
    )`);
  }

  if (langFilter) {
    whereClauses.push('LOWER(ci.language) = ?');
    sqlArgs.push(langFilter);
  }

  if (search) {
    const like = `%${search}%`;
    const ftsIds = Array.from(ftsMatches.keys());
    const ftsOrClause =
      ftsIds.length > 0 ? `ci.id IN (${ftsIds.map(() => '?').join(',')}) OR ` : '';
    whereClauses.push(`(${ftsOrClause}
      LOWER(ci.title) LIKE ? OR
      LOWER(COALESCE(ci.description, '')) LIKE ? OR
      LOWER(COALESCE(ci.author, '')) LIKE ? OR
      LOWER(ci.source_name) LIKE ? OR
      LOWER(ci.source_domain) LIKE ? OR
      EXISTS (
        SELECT 1 FROM content_tags ct2
        JOIN tags t2 ON t2.id = ct2.tag_id
        WHERE ct2.content_id = ci.id AND LOWER(t2.name) LIKE ?
      ) OR
      EXISTS (
        SELECT 1 FROM item_notes n2
        WHERE (n2.canonical_url = ci.canonical_url OR n2.content_item_id = ci.id)
          AND LOWER(n2.note_text) LIKE ?
      )
    )`);
    if (ftsIds.length > 0) {
      sqlArgs.push(...ftsIds);
    }
    sqlArgs.push(like, like, like, like, like, like, like);
  }

  const sql = `
    SELECT ci.*,
           uf.feedback_type,
           uf.is_read,
           uf.is_saved,
           uf.is_hidden
    FROM content_items ci
    LEFT JOIN user_feedback uf ON uf.content_id = ci.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY COALESCE(ci.published_at, ci.discovered_at) DESC
    LIMIT 1500
  `;

  const rows = db.prepare(sql).all(...sqlArgs) as unknown as JoinedContentRow[];
  if (rows.length === 0) {
    return {items: [], total: 0, page, pageSize, hasMore: false};
  }

  const {badgesByContent, syncLinksByContent} = loadTagMapForContentIds(
    rows.map((r) => r.id),
    prefs.customLanguages.map((l) => l.code),
    prefs.customRegions.map((r) => r.code)
  );
  const enabledProviders = getEnabledProviderSet();

  const matchingRows =
    filter === 'saved'
      ? rows
      : rows.filter((row) =>
          doesItemMatchActivePreferences(
            {
              id: row.id,
              contentType: row.content_type,
              language: row.language,
              publicationRegion: row.publication_region,
              publisherCountry: row.publisher_country,
              providerName: row.provider_name,
              isSaved: row.is_saved === 1,
            },
            syncLinksByContent.get(row.id) || [],
            {
              languages: prefs.languages,
              regions: prefs.regions,
              customRegions: prefs.customRegions,
              enabledProviders,
            },
            effectiveScope
          )
        );

  if (matchingRows.length === 0) {
    return {items: [], total: 0, page, pageSize, hasMore: false};
  }

  const nowMs = Date.now();
  const mapped: ContentItem[] = matchingRows.map((row) => {
    const associatedTags = badgesByContent.get(row.id) || [];
    const relevantTags =
      typeof params.categoryId === 'number'
        ? associatedTags.filter((t) => t.categoryId === params.categoryId)
        : associatedTags;

    const hasEntTag = associatedTags.some((t) => isEntertainmentCategoryName(t.categoryName));
    const resolvedFilmCategory: FilmCategory =
      !isScopedEntCat || (!hasEntTag && typeof params.categoryId !== 'number')
        ? null
        : row.film_category ??
          classifyFilmContent({
            title: row.title,
            description: row.description,
            sourceName: row.source_name,
            sourceDomain: row.source_domain,
            contentType: row.content_type,
            categoryNames: associatedTags.map((t) => t.categoryName),
            tagNames: associatedTags.map((t) => t.tagName),
            matchedTerms: associatedTags.map((t) => t.matchedTerm),
          });

    const relevanceScore = computeRelevanceScore(
      {
        contentType: row.content_type,
        publishedAt: row.published_at,
        discoveredAt: row.discovered_at,
        metadataQuality: row.metadata_quality,
        matches: (relevantTags.length > 0 ? relevantTags : associatedTags).map((t) => ({
          priority: t.priority,
          matchType: t.matchType,
        })),
        feedbackType: row.feedback_type ?? null,
        isRead: row.is_read === 1,
        sourceAffinityBoost: affinityMap.get(row.source_domain) || 0,
      },
      prefs.scoringWeights,
      nowMs
    );

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
      filmCategory: resolvedFilmCategory,
      originalUrl: row.original_url,
      canonicalUrl: row.canonical_url,
      doi: row.doi,
      externalId: row.external_id,
      sourceName: row.source_name,
      sourceDomain: row.source_domain,
      author: row.author,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: row.published_at,
      discoveredAt: row.discovered_at,
      language: row.language,
      publicationRegion: row.publication_region,
      publisherCountry: row.publisher_country,
      duration: row.duration,
      openAccessUrl: row.open_access_url,
      metadataQuality: row.metadata_quality,
      baseScore: row.base_score,
      relevanceScore,
      providerName: row.provider_name,
      associatedTags,
      feedbackType: row.feedback_type ?? null,
      isRead: row.is_read === 1,
      isSaved: row.is_saved === 1,
      isHidden: row.is_hidden === 1,
    };
  });

  let orderedItems = mapped;
  if (isLucky && sort === 'relevant' && !rawSearch) {
    orderedItems = sortLuckyDiversified(mapped, Number(params.luckySeed) || 0);
  } else if (sort === 'relevant') {
    orderedItems.sort((a, b) => {
      if (rawSearch) {
        const rankA = ftsMatches.get(a.id)?.rank ?? 999;
        const rankB = ftsMatches.get(b.id)?.rank ?? 999;
        if (Math.abs(rankA - rankB) > 0.25) return rankA - rankB;
      }
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      const tA = Date.parse(a.publishedAt || a.discoveredAt) || 0;
      const tB = Date.parse(b.publishedAt || b.discoveredAt) || 0;
      return tB - tA;
    });
  } else if (sort === 'newest') {
    orderedItems.sort((a, b) => {
      const tA = Date.parse(a.publishedAt || a.discoveredAt) || 0;
      const tB = Date.parse(b.publishedAt || b.discoveredAt) || 0;
      return tB - tA;
    });
  } else if (sort === 'oldest') {
    orderedItems.sort((a, b) => {
      const tA = Date.parse(a.publishedAt || a.discoveredAt) || 0;
      const tB = Date.parse(b.publishedAt || b.discoveredAt) || 0;
      return tA - tB;
    });
  }

  const total = orderedItems.length;
  const start = (page - 1) * pageSize;
  const paginated = orderedItems.slice(start, start + pageSize);

  const notesMap = getNotesMapForUrls(paginated.map((it) => it.canonicalUrl));
  for (const item of paginated) {
    const noteEntry = notesMap.get(item.canonicalUrl);
    item.note = noteEntry?.noteText ?? null;
    item.noteUpdatedAt = noteEntry?.updatedAt ?? null;

    if (rawSearch) {
      const ftsPreview = ftsMatches.get(item.id)?.preview;
      if (ftsPreview && ftsPreview.segments.some((s) => s.match)) {
        item.searchMatch = {
          source: ftsPreview.source === 'note' ? 'note' : 'metadata',
          segments: ftsPreview.segments,
        };
      } else if (noteEntry && noteEntry.noteText.toLowerCase().includes(search)) {
        item.searchMatch = {
          source: 'note',
          segments: buildSearchMatchSegments(noteEntry.noteText, rawSearch),
        };
      } else {
        const metaText = [item.title, item.description, item.author, item.sourceName]
          .filter(Boolean)
          .join(' — ');
        item.searchMatch = {
          source: 'metadata',
          segments: buildSearchMatchSegments(metaText, rawSearch),
        };
      }
    }
  }

  return {
    items: paginated,
    total,
    page,
    pageSize,
    hasMore: start + paginated.length < total,
  };
}

export function getItemsByIds(
  ids: number[],
  options?: {sort?: SortOption; filter?: FeedFilterType; language?: string | 'all'}
): ContentItem[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const prefs = getPreferences();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ci.*,
              uf.feedback_type,
              uf.is_read,
              uf.is_saved,
              uf.is_hidden
       FROM content_items ci
       LEFT JOIN user_feedback uf ON uf.content_id = ci.id
       WHERE ci.id IN (${placeholders}) AND COALESCE(uf.is_hidden, 0) = 0`
    )
    .all(...ids) as unknown as JoinedContentRow[];

  const {badgesByContent} = loadTagMapForContentIds(
    rows.map((r) => r.id),
    prefs.customLanguages.map((l) => l.code),
    prefs.customRegions.map((r) => r.code)
  );

  const langFilter =
    options?.language && options.language !== 'all' ? options.language.toLowerCase() : null;
  const filter = options?.filter || 'all';
  const sort = options?.sort || 'newest';

  const mapped: ContentItem[] = rows
    .filter((row) => {
      if (langFilter && (row.language || 'en').toLowerCase() !== langFilter) return false;
      if (filter === 'news' || filter === 'article' || filter === 'video') {
        return row.content_type === filter;
      }
      if (filter === 'unread') return row.is_read !== 1;
      if (filter === 'saved') return row.is_saved === 1;
      return true;
    })
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      contentType: row.content_type,
      filmCategory: null,
      originalUrl: row.original_url,
      canonicalUrl: row.canonical_url,
      doi: row.doi,
      externalId: row.external_id,
      sourceName: row.source_name,
      sourceDomain: row.source_domain,
      author: row.author,
      thumbnailUrl: row.thumbnail_url,
      publishedAt: row.published_at,
      discoveredAt: row.discovered_at,
      language: row.language,
      publicationRegion: row.publication_region,
      publisherCountry: row.publisher_country,
      duration: row.duration,
      openAccessUrl: row.open_access_url,
      metadataQuality: row.metadata_quality,
      baseScore: row.base_score,
      relevanceScore: row.base_score,
      providerName: row.provider_name,
      associatedTags: badgesByContent.get(row.id) || [],
      feedbackType: row.feedback_type ?? null,
      isRead: row.is_read === 1,
      isSaved: row.is_saved === 1,
      isHidden: row.is_hidden === 1,
    }));

  if (sort === 'oldest') {
    mapped.sort((a, b) => {
      const tA = Date.parse(a.publishedAt || a.discoveredAt) || 0;
      const tB = Date.parse(b.publishedAt || b.discoveredAt) || 0;
      return tA - tB;
    });
  } else {
    mapped.sort((a, b) => {
      const tA = Date.parse(a.publishedAt || a.discoveredAt) || 0;
      const tB = Date.parse(b.publishedAt || b.discoveredAt) || 0;
      return tB - tA;
    });
  }

  const notesMap = getNotesMapForUrls(mapped.map((it) => it.canonicalUrl));
  for (const item of mapped) {
    const noteEntry = notesMap.get(item.canonicalUrl);
    item.note = noteEntry?.noteText ?? null;
    item.noteUpdatedAt = noteEntry?.updatedAt ?? null;
  }

  return mapped;
}

export function updateContentFeedback(
  contentId: number,
  input: {
    feedbackType?: FeedbackType;
    isRead?: boolean;
    isSaved?: boolean;
    isHidden?: boolean;
  }
): {
  contentId: number;
  feedbackType: FeedbackType;
  isRead: boolean;
  isSaved: boolean;
  isHidden: boolean;
} {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM content_items WHERE id = ?').get(contentId);
  if (!exists) {
    throw new Error('Content item not found');
  }

  const current = db
    .prepare('SELECT * FROM user_feedback WHERE content_id = ?')
    .get(contentId) as
    | {
        feedback_type: FeedbackType;
        is_read: number;
        is_saved: number;
        is_hidden: number;
        read_at: string | null;
        saved_at: string | null;
      }
    | undefined;

  const nextFeedback =
    input.feedbackType !== undefined ? input.feedbackType : (current?.feedback_type ?? null);
  const nextRead = input.isRead !== undefined ? (input.isRead ? 1 : 0) : (current?.is_read ?? 0);
  const nextSaved = input.isSaved !== undefined ? (input.isSaved ? 1 : 0) : (current?.is_saved ?? 0);
  const nextHidden =
    input.isHidden !== undefined ? (input.isHidden ? 1 : 0) : (current?.is_hidden ?? 0);

  const now = new Date().toISOString();
  const readAt = nextRead === 1 ? (current?.read_at || now) : null;
  const savedAt = nextSaved === 1 ? (current?.saved_at || now) : null;

  db.prepare(
    `INSERT INTO user_feedback (content_id, feedback_type, is_read, is_saved, is_hidden, read_at, saved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(content_id) DO UPDATE SET
       feedback_type = excluded.feedback_type,
       is_read = excluded.is_read,
       is_saved = excluded.is_saved,
       is_hidden = excluded.is_hidden,
       read_at = excluded.read_at,
       saved_at = excluded.saved_at,
       updated_at = datetime('now')`
  ).run(contentId, nextFeedback, nextRead, nextSaved, nextHidden, readAt, savedAt);

  return {
    contentId,
    feedbackType: nextFeedback,
    isRead: nextRead === 1,
    isSaved: nextSaved === 1,
    isHidden: nextHidden === 1,
  };
}

export function getFeedCounts(categoryId?: CategorySelection): {
  all: number;
  news: number;
  article: number;
  video: number;
  toWatch: number;
  aboutFilm: number;
  unread: number;
  saved: number;
  notes: number;
  languages: string[];
} {
  const db = getDb();
  const prefs = getPreferences();
  const scope: number | 'all' = typeof categoryId === 'number' ? categoryId : 'all';
  const allowFilmCounts =
    categoryId === 'all' ||
    (typeof categoryId === 'number' && isEntertainmentCategoryById(categoryId));

  const rows = db
    .prepare(
      `SELECT ci.id, ci.canonical_url, ci.content_type, ci.film_category, ci.language,
              ci.publication_region, ci.publisher_country, ci.provider_name,
              COALESCE(uf.is_read, 0) AS is_read,
              COALESCE(uf.is_saved, 0) AS is_saved
       FROM content_items ci
       LEFT JOIN user_feedback uf ON uf.content_id = ci.id
       WHERE COALESCE(uf.is_hidden, 0) = 0`
    )
    .all() as Array<{
    id: number;
    canonical_url: string;
    content_type: 'news' | 'article' | 'video';
    film_category: FilmCategory;
    language: string;
    publication_region: string | null;
    publisher_country: string | null;
    provider_name: string;
    is_read: number;
    is_saved: number;
  }>;

  const totalSavedRow = rows.filter((r) => r.is_saved === 1).length;
  if (rows.length === 0) {
    return {
      all: 0,
      news: 0,
      article: 0,
      video: 0,
      toWatch: 0,
      aboutFilm: 0,
      unread: 0,
      saved: 0,
      notes: 0,
      languages: [],
    };
  }

  const {syncLinksByContent} = loadTagMapForContentIds(
    rows.map((r) => r.id),
    prefs.customLanguages.map((l) => l.code),
    prefs.customRegions.map((r) => r.code)
  );
  const enabledProviders = getEnabledProviderSet();

  const activeItems = rows.filter((r) =>
    doesItemMatchActivePreferences(
      {
        id: r.id,
        contentType: r.content_type,
        language: r.language,
        publicationRegion: r.publication_region,
        publisherCountry: r.publisher_country,
        providerName: r.provider_name,
        isSaved: r.is_saved === 1,
      },
      syncLinksByContent.get(r.id) || [],
      {
        languages: prefs.languages,
        regions: prefs.regions,
        customRegions: prefs.customRegions,
        enabledProviders,
      },
      scope
    )
  );

  const notedUrls = new Set(
    (
      db.prepare('SELECT canonical_url FROM item_notes').all() as Array<{canonical_url: string}>
    ).map((r) => r.canonical_url)
  );

  let news = 0;
  let article = 0;
  let video = 0;
  let toWatch = 0;
  let aboutFilm = 0;
  let unread = 0;
  let notes = 0;
  const langSet = new Set<string>();

  for (const r of activeItems) {
    if (r.content_type === 'news') news++;
    else if (r.content_type === 'article') article++;
    else if (r.content_type === 'video') video++;

    if (allowFilmCounts) {
      if (r.film_category === 'to_watch') toWatch++;
      else if (r.film_category === 'about_film') aboutFilm++;
    }

    if (r.is_read === 0) unread++;
    if (notedUrls.has(r.canonical_url)) notes++;
    if (r.language) langSet.add(r.language.toLowerCase());
  }

  return {
    all: activeItems.length,
    news,
    article,
    video,
    toWatch,
    aboutFilm,
    unread,
    saved: totalSavedRow,
    notes,
    languages: Array.from(langSet).sort(),
  };
}
