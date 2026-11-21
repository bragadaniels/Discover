import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {reconstructOpenAlexAbstract} from '../providers/openalex';
import {findDuplicateCandidate, type ExistingDedupeCandidate} from './deduplicator';
import {
  buildFtsMatchQuery,
  buildSearchMatchSegments,
  extractReadableTextFromHtml,
  parseMarkedSnippetToSegments,
  searchArchivesFts,
  searchContentFts,
  syncArchiveFtsIndex,
  syncContentFtsIndex,
  upsertArchiveExtractedText,
} from './fts_search';
import {buildDiscoveryQueries} from './query_builder';

test('reconstructOpenAlexAbstract restores word order from inverted index', () => {
  const abstract = reconstructOpenAlexAbstract({
    Catalytic: [0],
    hydrogenation: [1],
    of: [2],
    cardanol: [3],
    under: [4],
    mild: [5],
    'conditions.': [6],
  });
  assert.equal(abstract, 'Catalytic hydrogenation of cardanol under mild conditions.');
  assert.equal(reconstructOpenAlexAbstract(null), null);
  assert.equal(reconstructOpenAlexAbstract({}), null);
});

test('extractReadableTextFromHtml strips scripts/nav/banner and keeps main article prose', () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Perovskite Photovoltaics Review</title>
        <meta name="description" content="Tandem efficiency benchmarks">
        <style>.banner { color: red; }</style>
      </head>
      <body>
        <nav>Home | Categories | Login</nav>
        <div data-discover-archive-banner>Archived by Discover</div>
        <main>
          <article>
            <h1>Perovskite Photovoltaics</h1>
            <p>${'Halide perovskite tandem cells reached certified stability under damp-heat testing. '.repeat(5)}</p>
          </article>
        </main>
        <footer>Copyright 2026</footer>
        <script>console.log('should be stripped');</script>
      </body>
    </html>
  `;
  const text = extractReadableTextFromHtml(html);
  assert.ok(text.includes('Perovskite Photovoltaics Review'));
  assert.ok(text.includes('Halide perovskite tandem cells'));
  assert.equal(text.includes('should be stripped'), false);
  assert.equal(text.includes('Archived by Discover'), false);
  assert.equal(text.includes('Home | Categories'), false);
});

test('buildFtsMatchQuery sanitizes operators and supports prefix matching', () => {
  assert.equal(buildFtsMatchQuery('  "cardanol" + synthesis: (2025)? '), '"cardanol"* "synthesis"* "2025"*');
  assert.equal(buildFtsMatchQuery('   ***   '), '');
});

test('parseMarkedSnippetToSegments and buildSearchMatchSegments highlight safely', () => {
  const ftsSegments = parseMarkedSnippetToSegments('Novel [[M]]cardanol[[/M]] resin [[M]]coatings[[/M]].');
  assert.deepEqual(ftsSegments, [
    {text: 'Novel ', match: false},
    {text: 'cardanol', match: true},
    {text: ' resin ', match: false},
    {text: 'coatings', match: true},
    {text: '.', match: false},
  ]);

  const fallbackSegments = buildSearchMatchSegments(
    'This paper studies cashew nutshell liquid and cardanol derivatives in biopolymers.',
    'cardanol'
  );
  assert.ok(fallbackSegments.some((s) => s.match && s.text.toLowerCase() === 'cardanol'));
});

test('findDuplicateCandidate deduplicates arXiv papers across arXiv, OpenAlex, and Semantic Scholar', () => {
  const existing: ExistingDedupeCandidate[] = [
    {
      id: 42,
      title: 'Attention Is All You Need',
      contentType: 'article',
      canonicalUrl: 'https://arxiv.org/abs/1706.03762',
      doi: null,
      externalId: 'arxiv:1706.03762',
      publishedAt: '2017-06-12T00:00:00.000Z',
    },
  ];

  const fromOpenAlexPdf = findDuplicateCandidate(
    {
      title: 'Attention Is All You Need (Preprint)',
      contentType: 'article',
      canonicalUrl: 'https://arxiv.org/pdf/1706.03762v5',
      doi: null,
      externalId: 'openalex:W2963403868',
      publishedAt: '2017-06-12T00:00:00.000Z',
    },
    existing
  );
  assert.equal(fromOpenAlexPdf?.id, 42);

  const fromSemanticScholar = findDuplicateCandidate(
    {
      title: 'Different Mirror Record',
      contentType: 'article',
      canonicalUrl: 'https://semanticscholar.org/paper/xyz',
      doi: null,
      externalId: 'arxiv:1706.03762v7',
      publishedAt: '2017-06-12T00:00:00.000Z',
    },
    existing
  );
  assert.equal(fromSemanticScholar?.id, 42);
});

test('buildDiscoveryQueries routes OpenAlex, Semantic Scholar, and Hacker News by domain', () => {
  const queries = buildDiscoveryQueries(
    [
      {
        id: 1,
        categoryId: 1,
        categoryName: 'Cinema',
        name: 'Psychological Thriller',
        priority: 4,
        expandedTerms: [],
        exclusions: [],
      },
      {
        id: 2,
        categoryId: 2,
        categoryName: 'News / Current Affairs',
        name: 'Brazilian Politics',
        priority: 4,
        expandedTerms: [],
        exclusions: [],
      },
      {
        id: 3,
        categoryId: 2,
        categoryName: 'News / Current Affairs',
        name: 'Military Technology',
        priority: 4,
        expandedTerms: [],
        exclusions: [],
      },
      {
        id: 4,
        categoryId: 3,
        categoryName: 'Chemistry',
        name: 'Cardanol',
        priority: 4,
        expandedTerms: [],
        exclusions: [],
      },
    ],
    ['google_news', 'openalex', 'semantic_scholar', 'hacker_news'],
    60
  );

  // Entertainment skips scholarly & HN providers
  assert.equal(
    queries.some(
      (q) =>
        q.tagId === 1 &&
        (q.provider === 'openalex' || q.provider === 'semantic_scholar' || q.provider === 'hacker_news')
    ),
    false
  );

  // Non-tech geopolitics skips HN
  assert.equal(queries.some((q) => q.tagId === 2 && q.provider === 'hacker_news'), false);
  // Tech geopolitics allows HN
  assert.equal(queries.some((q) => q.tagId === 3 && q.provider === 'hacker_news'), true);

  // Science hits OpenAlex, Semantic Scholar, and HN
  assert.equal(queries.some((q) => q.tagId === 4 && q.provider === 'openalex'), true);
  assert.equal(queries.some((q) => q.tagId === 4 && q.provider === 'semantic_scholar'), true);
  assert.equal(queries.some((q) => q.tagId === 4 && q.provider === 'hacker_news'), true);
});

test('Item notes, FTS5 feed/archive full-text search, and provider health metrics work end-to-end', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-fts-notes-'));
  const dbPath = path.join(tempRoot, 'test-fts.db');
  const archivesDir = path.join(tempRoot, 'archives');

  process.env.DISCOVER_DB_PATH = dbPath;
  process.env.DISCOVER_ARCHIVES_DIR = archivesDir;

  const {APP_CONFIG} = await import('../config');
  APP_CONFIG.dbPath = dbPath;
  APP_CONFIG.archivesDir = archivesDir;

  const {closeDb, getDb} = await import('../db/database');
  const {upsertItemNote, deleteItemNote} = await import('../services/note_service');
  const {queryFeed, getFeedCounts} = await import('../services/feed_service');
  const {listArchives} = await import('../services/archive_service');
  const {getProviderHealthMetrics} = await import('./discovery_engine');

  t.after(async () => {
    closeDb();
    await fs.rm(tempRoot, {recursive: true, force: true});
  });

  const db = getDb();

  // Seed category, tag, content item, and an archive sharing canonical_url
  const catId = Number(
    db
      .prepare(`INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Chemistry', 'chemistry', 'flask', 0)`)
      .run().lastInsertRowid
  );
  const tagId = Number(
    db.prepare(`INSERT INTO tags (category_id, name, priority) VALUES (?, 'Cardanol', 4)`).run(catId).lastInsertRowid
  );

  const canonical = 'https://example.org/papers/cardanol-resin';
  const contentId = Number(
    db
      .prepare(
        `INSERT INTO content_items (
           title, description, content_type, original_url, canonical_url,
           source_name, source_domain, language, provider_name, metadata_quality, base_score
         ) VALUES (
           'Bio-based Cardanol Polymers',
           'Overview of renewable phenolic monomers',
           'article',
           ?, ?,
           'OpenAlex Journal', 'example.org', 'en', 'openalex', 0.85, 0.85
         )`
      )
      .run(canonical, canonical).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO content_tags (content_id, tag_id, match_type, matched_term) VALUES (?, ?, 'direct', 'Cardanol')`
  ).run(contentId, tagId);
  syncContentFtsIndex(db, contentId);

  const archiveUid = 'arc_20261121_test1';
  db.prepare(
    `INSERT INTO archives (
       archive_uid, version_number, content_item_id, original_url, canonical_url,
       title, publisher, content_type, category_name, tag_names_json,
       language, status, completeness, available_formats_json
     ) VALUES (
       ?, 1, ?, ?, ?,
       'Bio-based Cardanol Polymers', 'OpenAlex Journal', 'article', 'Chemistry', '["Cardanol"]',
       'en', 'complete', 100, '["html"]'
     )`
  ).run(archiveUid, contentId, canonical, canonical);
  upsertArchiveExtractedText(
    db,
    archiveUid,
    'Detailed experimental synthesis using benzoxazine crosslinking at 180 degrees Celsius.'
  );
  syncArchiveFtsIndex(db, archiveUid);

  // 1. Add a personal research note via contentItemId and verify it links to both Feed & Archive
  const savedNote = upsertItemNote({
    contentItemId: contentId,
    noteText: 'Key reference for epoxidized linseed blending ratio',
  });
  assert.ok(savedNote);
  assert.equal(savedNote.canonicalUrl, canonical);

  // Feed search matches inside note and returns highlighted note snippet
  const feedNoteSearch = queryFeed({
    categoryId: 'all',
    filter: 'all',
    search: 'epoxidized',
  });
  assert.equal(feedNoteSearch.items.length, 1);
  assert.equal(feedNoteSearch.items[0].note, 'Key reference for epoxidized linseed blending ratio');
  assert.equal(feedNoteSearch.items[0].searchMatch?.source, 'note');
  assert.ok(feedNoteSearch.items[0].searchMatch?.segments.some((s) => s.match && s.text.toLowerCase().includes('epoxidized')));

  // Feed 'notes' filter + counts.notes
  const feedHasNotes = queryFeed({
    categoryId: 'all',
    filter: 'notes',
  });
  assert.equal(getFeedCounts('all').notes, 1);
  assert.equal(feedHasNotes.items.length, 1);

  // Archive search matches inside archived full-text body ('benzoxazine') and highlights it
  const archiveBodySearch = listArchives({search: 'benzoxazine'});
  assert.equal(archiveBodySearch.archives.length, 1);
  assert.equal(archiveBodySearch.archives[0].archiveUid, archiveUid);
  assert.equal(archiveBodySearch.archives[0].searchMatch?.source, 'archive_text');
  assert.ok(
    archiveBodySearch.archives[0].searchMatch?.segments.some(
      (s) => s.match && s.text.toLowerCase().includes('benzoxazine')
    )
  );

  // Archive 'hasNotes' inherits note created on the feed item via canonical_url
  const archivedWithNotes = listArchives({hasNotes: true});
  assert.equal(archivedWithNotes.archives.length, 1);
  assert.equal(
    archivedWithNotes.archives[0].note,
    'Key reference for epoxidized linseed blending ratio'
  );

  // Direct FTS helper checks
  const contentFtsMap = searchContentFts(db, 'renewable');
  assert.ok(contentFtsMap.has(contentId));
  const archiveFtsMap = searchArchivesFts(db, 'linseed');
  assert.equal(archiveFtsMap.get(archiveUid)?.preview.source, 'note');

  // Clear note & confirm FTS / counts update cleanly
  const deleted = deleteItemNote({archiveUid});
  assert.equal(deleted, true);
  const afterClearFeed = queryFeed({categoryId: 'all', filter: 'notes'});
  assert.equal(getFeedCounts('all').notes, 0);
  assert.equal(afterClearFeed.items.length, 0);
  assert.equal(listArchives({hasNotes: true}).archives.length, 0);

  // 2. Provider Health Matrix telemetry aggregation
  db.prepare(
    `INSERT INTO discovery_queries (provider_name, query_text, language, region, status, items_found, items_added, duration_ms)
     VALUES
       ('openalex', 'cardanol', 'en', 'GLOBAL', 'success', 20, 8, 420),
       ('openalex', 'linseed', 'en', 'GLOBAL', 'success', 15, 5, 580),
       ('semantic_scholar', 'cardanol', 'en', 'GLOBAL', 'rate_limited', 0, 0, 120)`
  ).run();

  const metrics = getProviderHealthMetrics();
  const oaMetric = metrics.find((m) => m.providerName === 'openalex');
  const s2Metric = metrics.find((m) => m.providerName === 'semantic_scholar');
  assert.ok(oaMetric);
  assert.equal(oaMetric.totalRuns, 2);
  assert.equal(oaMetric.successRuns, 2);
  assert.equal(oaMetric.successRatePct, 100);
  assert.equal(oaMetric.avgLatencyMs, 500);
  assert.equal(oaMetric.totalFound, 35);
  assert.equal(oaMetric.totalAdded, 13);

  assert.ok(s2Metric);
  assert.equal(s2Metric.totalRuns, 1);
  assert.equal(s2Metric.rateLimitedRuns, 1);
  assert.equal(s2Metric.successRatePct, 0);
  assert.equal(s2Metric.avgLatencyMs, 120);
});
