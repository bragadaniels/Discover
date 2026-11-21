import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {APP_CONFIG} from '../config';
import {classifyFilmContent} from '../core/film_classifier';
import {backfillFtsIndexes} from '../core/fts_search';
import {sanitizePlainText} from '../core/normalizer';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const targetPath = customPath || APP_CONFIG.dbPath;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  initializeSchema(db);
  applySchemaMigrations(db);
  backfillFtsIndexes(db);
  seedDefaultPreferences(db);
  seedDefaultProviders(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT NOT NULL DEFAULT 'bookmark',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      languages TEXT,
      regions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE (category_id, name)
    );

    CREATE TABLE IF NOT EXISTS tag_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('expanded', 'exclusion')),
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_user_defined INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE (tag_id, term, relation_type)
    );

    CREATE TABLE IF NOT EXISTS content_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      content_type TEXT NOT NULL CHECK (content_type IN ('news', 'article', 'video')),
      film_category TEXT CHECK (film_category IN ('about_film', 'to_watch')),
      original_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL UNIQUE,
      doi TEXT UNIQUE,
      external_id TEXT,
      source_name TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      author TEXT,
      thumbnail_url TEXT,
      published_at TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      language TEXT NOT NULL DEFAULT 'en',
      publication_region TEXT,
      publisher_country TEXT,
      duration TEXT,
      open_access_url TEXT,
      metadata_quality REAL NOT NULL DEFAULT 0.5,
      base_score REAL NOT NULL DEFAULT 0.5,
      provider_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_tags (
      content_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('direct', 'expanded')),
      matched_term TEXT NOT NULL,
      PRIMARY KEY (content_id, tag_id),
      FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_feedback (
      content_id INTEGER PRIMARY KEY,
      feedback_type TEXT CHECK (feedback_type IN ('like', 'dislike')),
      is_read INTEGER NOT NULL DEFAULT 0,
      is_saved INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      saved_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS discovery_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL,
      query_text TEXT NOT NULL,
      language TEXT,
      region TEXT,
      tag_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'rate_limited')),
      items_found INTEGER NOT NULL DEFAULT 0,
      items_added INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      error_message TEXT,
      executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS provider_status (
      provider_name TEXT PRIMARY KEY,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_configured INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      rate_limit_reset_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_uid TEXT NOT NULL UNIQUE,
      version_number INTEGER NOT NULL DEFAULT 1,
      parent_archive_uid TEXT,
      content_item_id INTEGER,
      original_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      publisher TEXT,
      published_at TEXT,
      archived_at TEXT NOT NULL DEFAULT (datetime('now')),
      content_type TEXT NOT NULL CHECK (content_type IN ('news', 'article', 'video')),
      category_name TEXT,
      tag_names_json TEXT NOT NULL DEFAULT '[]',
      doi TEXT,
      language TEXT,
      html_path TEXT,
      warc_path TEXT,
      pdf_path TEXT,
      metadata_path TEXT,
      thumbnail_path TEXT,
      file_sizes_json TEXT NOT NULL DEFAULT '{}',
      checksums_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'text_only', 'failed')),
      completeness INTEGER NOT NULL DEFAULT 0,
      available_formats_json TEXT NOT NULL DEFAULT '[]',
      capture_details_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS item_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_url TEXT NOT NULL UNIQUE,
      content_item_id INTEGER,
      archive_uid TEXT,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS archive_fulltext (
      archive_uid TEXT PRIMARY KEY,
      extracted_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (archive_uid) REFERENCES archives(archive_uid) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
      content_id UNINDEXED,
      title,
      description,
      author,
      source_name,
      tags_text,
      note_text,
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_archives USING fts5(
      archive_uid UNINDEXED,
      title,
      author,
      publisher,
      original_url,
      category_name,
      tag_names,
      note_text,
      extracted_text,
      tokenize='porter unicode61'
    );

    CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category_id);
    CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(content_type);
    CREATE INDEX IF NOT EXISTS idx_content_published ON content_items(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_discovered ON content_items(discovered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_external_id ON content_items(external_id);
    CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_saved ON user_feedback(is_saved, is_hidden);
    CREATE INDEX IF NOT EXISTS idx_discovery_queries_executed ON discovery_queries(executed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archives_uid ON archives(archive_uid);
    CREATE INDEX IF NOT EXISTS idx_archives_content_item ON archives(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_archives_archived_at ON archives(archived_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archives_published_at ON archives(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_archives_status ON archives(status);
    CREATE INDEX IF NOT EXISTS idx_archives_category ON archives(category_name);
    CREATE INDEX IF NOT EXISTS idx_archives_canonical_url ON archives(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_item_notes_content_id ON item_notes(content_item_id);
    CREATE INDEX IF NOT EXISTS idx_item_notes_archive_uid ON item_notes(archive_uid);
  `);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function applySchemaMigrations(db: DatabaseSync): void {
  ensureColumn(db, 'categories', 'languages', 'TEXT');
  ensureColumn(db, 'categories', 'regions', 'TEXT');

  ensureColumn(
    db,
    'content_items',
    'film_category',
    "TEXT CHECK (film_category IN ('about_film', 'to_watch'))"
  );
  ensureColumn(db, 'content_items', 'publication_region', 'TEXT');
  ensureColumn(db, 'content_items', 'publisher_country', 'TEXT');

  ensureColumn(db, 'discovery_queries', 'language', 'TEXT');
  ensureColumn(db, 'discovery_queries', 'region', 'TEXT');
  ensureColumn(db, 'discovery_queries', 'duration_ms', 'INTEGER');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_content_film_category ON content_items(film_category);`);
  db.exec(
    `UPDATE content_items SET film_category = NULL WHERE provider_name IN ('arxiv', 'crossref') AND film_category IS NOT NULL;`
  );
  const encodedRows = db
    .prepare(
      `SELECT id, title, description, source_name FROM content_items
       WHERE title LIKE '%&#%' OR description LIKE '%&#%' OR source_name LIKE '%&#%'`
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    source_name: string;
  }>;
  if (encodedRows.length > 0) {
    const fixStmt = db.prepare(
      'UPDATE content_items SET title = ?, description = ?, source_name = ? WHERE id = ?'
    );
    for (const row of encodedRows) {
      fixStmt.run(
        sanitizePlainText(row.title, 280),
        row.description ? sanitizePlainText(row.description, 520) : null,
        sanitizePlainText(row.source_name, 120),
        row.id
      );
    }
  }

  const filmRows = db
    .prepare(
      `SELECT id, title, description, source_name, source_domain, content_type, film_category
       FROM content_items
       WHERE film_category IS NOT NULL`
    )
    .all() as Array<{
    id: number;
    title: string;
    description: string | null;
    source_name: string;
    source_domain: string;
    content_type: 'news' | 'article' | 'video';
    film_category: 'about_film' | 'to_watch';
  }>;
  if (filmRows.length > 0) {
    const tagLinkStmt = db.prepare(
      `SELECT c.name AS category_name, t.name AS tag_name, ct.matched_term
       FROM content_tags ct
       JOIN tags t ON t.id = ct.tag_id
       JOIN categories c ON c.id = t.category_id
       WHERE ct.content_id = ?`
    );
    const updateFilmStmt = db.prepare('UPDATE content_items SET film_category = ? WHERE id = ?');
    for (const row of filmRows) {
      const links = tagLinkStmt.all(row.id) as Array<{
        category_name: string;
        tag_name: string;
        matched_term: string;
      }>;
      const nextCat = classifyFilmContent({
        title: row.title,
        description: row.description,
        sourceName: row.source_name,
        sourceDomain: row.source_domain,
        contentType: row.content_type,
        categoryNames: links.map((l) => l.category_name),
        tagNames: links.map((l) => l.tag_name),
        matchedTerms: links.map((l) => l.matched_term),
      });
      if (nextCat !== row.film_category) {
        updateFilmStmt.run(nextCat, row.id);
      }
    }
  }
}

function seedDefaultPreferences(db: DatabaseSync): void {
  const defaults: Record<string, unknown> = {
    theme: 'light',
    language: APP_CONFIG.defaultLanguage,
    region: APP_CONFIG.defaultRegion,
    languages: APP_CONFIG.defaultLanguages,
    regions: APP_CONFIG.defaultRegions,
    customLanguages: [],
    customRegions: [],
    activeCategoryId: 'all',
    onboardingCompleted: false,
    intervals: APP_CONFIG.defaultIntervals,
    scoringWeights: APP_CONFIG.defaultScoringWeights,
  };

  const stmt = db.prepare('INSERT OR IGNORE INTO user_preferences (key, value) VALUES (?, ?)');
  for (const [key, val] of Object.entries(defaults)) {
    stmt.run(key, JSON.stringify(val));
  }
}

function seedDefaultProviders(db: DatabaseSync): void {
  const youtubeConfigured = APP_CONFIG.youtubeApiKey.length > 0 ? 1 : 0;
  const providers = [
    {name: 'google_news', enabled: 1, configured: 1},
    {name: 'rss_publishers', enabled: 1, configured: 1},
    {name: 'crossref', enabled: 1, configured: 1},
    {name: 'arxiv', enabled: 1, configured: 1},
    {name: 'openalex', enabled: 1, configured: 1},
    {name: 'semantic_scholar', enabled: 1, configured: 1},
    {name: 'hacker_news', enabled: 1, configured: 1},
    {name: 'youtube', enabled: youtubeConfigured, configured: youtubeConfigured},
  ];

  const insert = db.prepare(
    'INSERT OR IGNORE INTO provider_status (provider_name, is_enabled, is_configured) VALUES (?, ?, ?)'
  );
  for (const p of providers) {
    insert.run(p.name, p.enabled, p.configured);
  }
  db.prepare('UPDATE provider_status SET is_configured = ? WHERE provider_name = ?').run(
    youtubeConfigured,
    'youtube'
  );
}
