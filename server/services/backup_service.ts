import type {FilmCategory} from '../../shared/types';
import {getDb} from '../db/database';
import {listCategories} from './category_service';
import {upsertItemNote} from './note_service';
import {getPreferences, updatePreferences} from './preference_service';

export interface WorkspaceBackup {
  version: number;
  exportedAt: string;
  preferences: ReturnType<typeof getPreferences>;
  categories: ReturnType<typeof listCategories>;
  savedAndFeedbackItems: Array<{
    canonicalUrl: string;
    title: string;
    description: string | null;
    contentType: 'news' | 'article' | 'video';
    filmCategory?: FilmCategory;
    originalUrl: string;
    doi: string | null;
    externalId: string | null;
    sourceName: string;
    sourceDomain: string;
    author: string | null;
    thumbnailUrl: string | null;
    publishedAt: string | null;
    discoveredAt: string;
    language: string;
    publicationRegion?: string | null;
    publisherCountry?: string | null;
    duration: string | null;
    openAccessUrl: string | null;
    metadataQuality: number;
    baseScore: number;
    providerName: string;
    feedbackType: 'like' | 'dislike' | null;
    isRead: boolean;
    isSaved: boolean;
    isHidden: boolean;
  }>;
  itemNotes?: Array<{
    canonicalUrl: string;
    noteText: string;
  }>;
}

export function exportWorkspaceBackup(): WorkspaceBackup {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ci.*, uf.feedback_type, uf.is_read, uf.is_saved, uf.is_hidden
       FROM content_items ci
       JOIN user_feedback uf ON uf.content_id = ci.id
       WHERE uf.is_saved = 1 OR uf.feedback_type IS NOT NULL OR uf.is_read = 1`
    )
    .all() as Array<{
    canonical_url: string;
    title: string;
    description: string | null;
    content_type: 'news' | 'article' | 'video';
    film_category: FilmCategory;
    original_url: string;
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
    feedback_type: 'like' | 'dislike' | null;
    is_read: number;
    is_saved: number;
    is_hidden: number;
  }>;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences: getPreferences(),
    categories: listCategories(),
    savedAndFeedbackItems: rows.map((r) => ({
      canonicalUrl: r.canonical_url,
      title: r.title,
      description: r.description,
      contentType: r.content_type,
      filmCategory: r.film_category ?? null,
      originalUrl: r.original_url,
      doi: r.doi,
      externalId: r.external_id,
      sourceName: r.source_name,
      sourceDomain: r.source_domain,
      author: r.author,
      thumbnailUrl: r.thumbnail_url,
      publishedAt: r.published_at,
      discoveredAt: r.discovered_at,
      language: r.language,
      publicationRegion: r.publication_region ?? null,
      publisherCountry: r.publisher_country ?? null,
      duration: r.duration,
      openAccessUrl: r.open_access_url,
      metadataQuality: r.metadata_quality,
      baseScore: r.base_score,
      providerName: r.provider_name,
      feedbackType: r.feedback_type,
      isRead: r.is_read === 1,
      isSaved: r.is_saved === 1,
      isHidden: r.is_hidden === 1,
    })),
    itemNotes: (
      db
        .prepare('SELECT canonical_url, note_text FROM item_notes ORDER BY updated_at DESC')
        .all() as Array<{canonical_url: string; note_text: string}>
    ).map((n) => ({canonicalUrl: n.canonical_url, noteText: n.note_text})),
  };
}

export function importWorkspaceBackup(backup: WorkspaceBackup): {
  categoriesImported: number;
  tagsImported: number;
  itemsImported: number;
} {
  if (!backup || backup.version !== 1 || !Array.isArray(backup.categories)) {
    throw new Error('Invalid Discover backup payload');
  }

  const db = getDb();
  let categoriesImported = 0;
  let tagsImported = 0;
  let itemsImported = 0;

  if (backup.preferences) {
    updatePreferences(backup.preferences);
  }

  const insertCat = db.prepare(
    `INSERT OR IGNORE INTO categories (name, slug, icon, sort_order, is_enabled, languages, regions) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const findCat = db.prepare(`SELECT id FROM categories WHERE slug = ?`);
  const insertTag = db.prepare(
    `INSERT OR IGNORE INTO tags (category_id, name, description, priority, is_enabled) VALUES (?, ?, ?, ?, ?)`
  );
  const findTag = db.prepare(`SELECT id FROM tags WHERE category_id = ? AND name = ?`);
  const insertRel = db.prepare(
    `INSERT OR IGNORE INTO tag_relations (tag_id, term, relation_type, is_enabled, is_user_defined) VALUES (?, ?, ?, ?, ?)`
  );

  for (const cat of backup.categories) {
    const langs = cat.languages ? JSON.stringify(cat.languages) : null;
    const regs = cat.regions ? JSON.stringify(cat.regions) : null;
    const res = insertCat.run(
      cat.name,
      cat.slug,
      cat.icon || 'bookmark',
      cat.sortOrder ?? 0,
      cat.isEnabled ? 1 : 0,
      langs,
      regs
    );
    if (res.changes > 0) categoriesImported++;
    const catRow = findCat.get(cat.slug) as {id: number} | undefined;
    if (!catRow) continue;

    for (const tag of cat.tags || []) {
      const tRes = insertTag.run(catRow.id, tag.name, tag.description, tag.priority ?? 3, tag.isEnabled ? 1 : 0);
      if (tRes.changes > 0) tagsImported++;
      const tagRow = findTag.get(catRow.id, tag.name) as {id: number} | undefined;
      if (!tagRow) continue;

      for (const rel of tag.relations || []) {
        insertRel.run(tagRow.id, rel.term, rel.relationType, rel.isEnabled ? 1 : 0, rel.isUserDefined ? 1 : 0);
      }
    }
  }

  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO content_items (
      title, description, content_type, film_category, original_url, canonical_url, doi, external_id,
      source_name, source_domain, author, thumbnail_url, published_at, discovered_at,
      language, publication_region, publisher_country, duration, open_access_url, metadata_quality, base_score, provider_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findItem = db.prepare(`SELECT id FROM content_items WHERE canonical_url = ?`);
  const upsertFeedback = db.prepare(
    `INSERT OR REPLACE INTO user_feedback (content_id, feedback_type, is_read, is_saved, is_hidden) VALUES (?, ?, ?, ?, ?)`
  );

  for (const item of backup.savedAndFeedbackItems || []) {
    const iRes = insertItem.run(
      item.title,
      item.description,
      item.contentType,
      item.filmCategory ?? null,
      item.originalUrl,
      item.canonicalUrl,
      item.doi,
      item.externalId,
      item.sourceName,
      item.sourceDomain,
      item.author,
      item.thumbnailUrl,
      item.publishedAt,
      item.discoveredAt,
      item.language,
      item.publicationRegion ?? null,
      item.publisherCountry ?? null,
      item.duration,
      item.openAccessUrl,
      item.metadataQuality,
      item.baseScore,
      item.providerName
    );
    if (iRes.changes > 0) itemsImported++;
    const row = findItem.get(item.canonicalUrl) as {id: number} | undefined;
    if (row) {
      upsertFeedback.run(
        row.id,
        item.feedbackType,
        item.isRead ? 1 : 0,
        item.isSaved ? 1 : 0,
        item.isHidden ? 1 : 0
      );
    }
  }

  if (Array.isArray(backup.itemNotes)) {
    for (const note of backup.itemNotes) {
      if (note?.canonicalUrl && typeof note.noteText === 'string' && note.noteText.trim()) {
        upsertItemNote({canonicalUrl: note.canonicalUrl, noteText: note.noteText});
      }
    }
  }

  return {categoriesImported, tagsImported, itemsImported};
}
