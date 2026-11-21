import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {SearchHighlightSegment, SearchMatchPreview} from '../../shared/types';
import {APP_CONFIG} from '../config';
import {resolveSafeArchiveFilePath} from './archive_security';

const MARK_START = '[[M]]';
const MARK_END = '[[/M]]';

export function extractReadableTextFromHtml(rawHtml: string, maxChars = 250_000): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  try {
    const $ = cheerio.load(rawHtml);
    $(
      'script, style, noscript, svg, template, iframe, nav, footer, [data-discover-archive-banner], .discover-archive-banner'
    ).remove();

    const title = $('title').first().text().replace(/\s+/g, ' ').trim();
    const metaDesc =
      $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim() || '';

    const primaryContainer = $('main, article, [role="main"]').first();
    const primaryText = primaryContainer.length
      ? primaryContainer.text().replace(/\s+/g, ' ').trim()
      : '';
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

    const mainBody = primaryText.length >= 200 ? primaryText : bodyText || primaryText;
    const combined = [title, metaDesc, mainBody].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return combined.length > maxChars ? combined.slice(0, maxChars) : combined;
  } catch {
    return rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
  }
}

export function tokenizeSearchTerms(rawQuery: string): string[] {
  const cleaned = rawQuery
    .normalize('NFKC')
    .replace(/["'*:^()[\]{}~+\-\\/.,;!?@#$%&=<>\u2013\u2014]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return Array.from(
    new Set(
      cleaned
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    )
  ).slice(0, 10);
}

export function buildFtsMatchQuery(rawQuery: string): string {
  const tokens = tokenizeSearchTerms(rawQuery);
  if (tokens.length === 0) return '';
  return tokens.map((token) => `"${token.replace(/"/g, '')}"*`).join(' ');
}

export function parseMarkedSnippetToSegments(markedText: string | null | undefined): SearchHighlightSegment[] {
  if (!markedText) return [];
  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;

  while (cursor < markedText.length) {
    const startIdx = markedText.indexOf(MARK_START, cursor);
    if (startIdx === -1) {
      const tail = markedText.slice(cursor);
      if (tail) segments.push({text: tail, match: false});
      break;
    }
    if (startIdx > cursor) {
      segments.push({text: markedText.slice(cursor, startIdx), match: false});
    }
    const afterStart = startIdx + MARK_START.length;
    const endIdx = markedText.indexOf(MARK_END, afterStart);
    if (endIdx === -1) {
      const rest = markedText.slice(afterStart);
      if (rest) segments.push({text: rest, match: false});
      break;
    }
    const matched = markedText.slice(afterStart, endIdx);
    if (matched) {
      segments.push({text: matched, match: true});
    }
    cursor = endIdx + MARK_END.length;
  }

  return segments;
}

export function buildSearchMatchSegments(
  text: string,
  rawQuery: string,
  maxLength = 190
): SearchHighlightSegment[] {
  const cleanText = text.replace(/\s+/g, ' ').trim();
  if (!cleanText) return [];
  const tokens = tokenizeSearchTerms(rawQuery).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) {
    return [{text: cleanText.slice(0, maxLength), match: false}];
  }

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');

  const firstMatch = regex.exec(cleanText);
  let windowText = cleanText;
  if (cleanText.length > maxLength) {
    const center = firstMatch ? firstMatch.index : 0;
    const half = Math.floor(maxLength / 2);
    const start = Math.max(0, center - half);
    const end = Math.min(cleanText.length, start + maxLength);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < cleanText.length ? '…' : '';
    windowText = `${prefix}${cleanText.slice(start, end).trim()}${suffix}`;
  }

  regex.lastIndex = 0;
  const segments: SearchHighlightSegment[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(windowText)) !== null) {
    if (match.index > lastIdx) {
      segments.push({text: windowText.slice(lastIdx, match.index), match: false});
    }
    if (match[0]) {
      segments.push({text: match[0], match: true});
    }
    lastIdx = match.index + match[0].length;
    if (match[0].length === 0) break;
  }
  if (lastIdx < windowText.length) {
    segments.push({text: windowText.slice(lastIdx), match: false});
  }
  return segments;
}

export function syncContentFtsIndex(db: DatabaseSync, contentId: number): void {
  const row = db
    .prepare(
      `SELECT ci.id, ci.title, ci.description, ci.author, ci.source_name, ci.canonical_url,
              COALESCE((
                SELECT GROUP_CONCAT(t.name, ' ')
                FROM content_tags ct
                JOIN tags t ON t.id = ct.tag_id
                WHERE ct.content_id = ci.id
              ), '') AS tags_text,
              COALESCE((
                SELECT n.note_text
                FROM item_notes n
                WHERE n.content_item_id = ci.id OR n.canonical_url = ci.canonical_url
                ORDER BY n.updated_at DESC
                LIMIT 1
              ), '') AS note_text
       FROM content_items ci
       WHERE ci.id = ?`
    )
    .get(contentId) as
    | {
        id: number;
        title: string;
        description: string | null;
        author: string | null;
        source_name: string;
        tags_text: string;
        note_text: string;
      }
    | undefined;

  db.prepare('DELETE FROM fts_content WHERE content_id = ?').run(contentId);
  if (!row) return;

  db.prepare(
    `INSERT INTO fts_content (content_id, title, description, author, source_name, tags_text, note_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.title || '',
    row.description || '',
    row.author || '',
    row.source_name || '',
    row.tags_text || '',
    row.note_text || ''
  );
}

export function removeContentFtsIndex(db: DatabaseSync, contentId: number): void {
  db.prepare('DELETE FROM fts_content WHERE content_id = ?').run(contentId);
}

export function upsertArchiveExtractedText(
  db: DatabaseSync,
  archiveUid: string,
  extractedText: string
): void {
  db.prepare(
    `INSERT INTO archive_fulltext (archive_uid, extracted_text, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(archive_uid) DO UPDATE SET
       extracted_text = excluded.extracted_text,
       updated_at = datetime('now')`
  ).run(archiveUid, extractedText);
}

export function syncArchiveFtsIndex(db: DatabaseSync, archiveUid: string): void {
  const row = db
    .prepare(
      `SELECT a.archive_uid, a.title, a.author, a.publisher, a.original_url, a.category_name,
              a.tag_names_json, a.canonical_url,
              COALESCE((
                SELECT n.note_text
                FROM item_notes n
                WHERE n.archive_uid = a.archive_uid OR n.canonical_url = a.canonical_url
                ORDER BY n.updated_at DESC
                LIMIT 1
              ), '') AS note_text,
              COALESCE(af.extracted_text, '') AS extracted_text
       FROM archives a
       LEFT JOIN archive_fulltext af ON af.archive_uid = a.archive_uid
       WHERE a.archive_uid = ?`
    )
    .get(archiveUid) as
    | {
        archive_uid: string;
        title: string;
        author: string | null;
        publisher: string | null;
        original_url: string;
        category_name: string | null;
        tag_names_json: string;
        note_text: string;
        extracted_text: string;
      }
    | undefined;

  db.prepare('DELETE FROM fts_archives WHERE archive_uid = ?').run(archiveUid);
  if (!row) return;

  let tagsText = '';
  try {
    const parsed = JSON.parse(row.tag_names_json);
    if (Array.isArray(parsed)) {
      tagsText = parsed.filter((t) => typeof t === 'string').join(' ');
    }
  } catch {
    tagsText = row.tag_names_json || '';
  }

  db.prepare(
    `INSERT INTO fts_archives (
       archive_uid, title, author, publisher, original_url, category_name, tag_names, note_text, extracted_text
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.archive_uid,
    row.title || '',
    row.author || '',
    row.publisher || '',
    row.original_url || '',
    row.category_name || '',
    tagsText,
    row.note_text || '',
    row.extracted_text || ''
  );
}

export function removeArchiveFtsIndex(db: DatabaseSync, archiveUid: string): void {
  db.prepare('DELETE FROM fts_archives WHERE archive_uid = ?').run(archiveUid);
}

export function syncFtsByCanonicalUrl(db: DatabaseSync, canonicalUrl: string): void {
  const contentRows = db
    .prepare('SELECT id FROM content_items WHERE canonical_url = ?')
    .all(canonicalUrl) as Array<{id: number}>;
  for (const r of contentRows) {
    syncContentFtsIndex(db, r.id);
  }

  const archiveRows = db
    .prepare('SELECT archive_uid FROM archives WHERE canonical_url = ?')
    .all(canonicalUrl) as Array<{archive_uid: string}>;
  for (const r of archiveRows) {
    syncArchiveFtsIndex(db, r.archive_uid);
  }
}

export function backfillFtsIndexes(db: DatabaseSync, archivesDir?: string): void {
  // 1. Backfill missing archive_fulltext from local HTML snapshots
  const missingFulltext = db
    .prepare(
      `SELECT a.archive_uid, a.html_path
       FROM archives a
       LEFT JOIN archive_fulltext af ON af.archive_uid = a.archive_uid
       WHERE a.html_path IS NOT NULL AND af.archive_uid IS NULL`
    )
    .all() as Array<{archive_uid: string; html_path: string}>;

  if (missingFulltext.length > 0) {
    const root = path.resolve(archivesDir || APP_CONFIG.archivesDir);
    for (const row of missingFulltext) {
      try {
        const absPath = resolveSafeArchiveFilePath(root, row.html_path);
        if (fs.existsSync(absPath)) {
          const html = fs.readFileSync(absPath, 'utf8');
          const extracted = extractReadableTextFromHtml(html);
          upsertArchiveExtractedText(db, row.archive_uid, extracted);
        }
      } catch {
        // Ignore missing/unreadable archive files on startup
      }
    }
  }

  // 2. Backfill missing fts_content rows
  const missingContent = db
    .prepare(
      `SELECT ci.id
       FROM content_items ci
       WHERE NOT EXISTS (SELECT 1 FROM fts_content fc WHERE fc.content_id = ci.id)`
    )
    .all() as Array<{id: number}>;
  for (const row of missingContent) {
    syncContentFtsIndex(db, row.id);
  }

  // 3. Backfill missing fts_archives rows
  const missingArchives = db
    .prepare(
      `SELECT a.archive_uid
       FROM archives a
       WHERE NOT EXISTS (SELECT 1 FROM fts_archives fa WHERE fa.archive_uid = a.archive_uid)`
    )
    .all() as Array<{archive_uid: string}>;
  for (const row of missingArchives) {
    syncArchiveFtsIndex(db, row.archive_uid);
  }
}

export interface ContentFtsMatch {
  rank: number;
  preview: SearchMatchPreview;
}

export function searchContentFts(
  db: DatabaseSync,
  rawQuery: string,
  limit = 500
): Map<number, ContentFtsMatch> {
  const results = new Map<number, ContentFtsMatch>();
  const ftsQuery = buildFtsMatchQuery(rawQuery);
  if (!ftsQuery) return results;

  try {
    const rows = db
      .prepare(
        `SELECT content_id,
                bm25(fts_content) AS rank_score,
                snippet(fts_content, 6, '${MARK_START}', '${MARK_END}', '…', 20) AS note_snip,
                snippet(fts_content, -1, '${MARK_START}', '${MARK_END}', '…', 22) AS best_snip
         FROM fts_content
         WHERE fts_content MATCH ?
         ORDER BY rank_score ASC
         LIMIT ?`
      )
      .all(ftsQuery, limit) as Array<{
      content_id: number;
      rank_score: number;
      note_snip: string | null;
      best_snip: string | null;
    }>;

    for (const row of rows) {
      const noteMatched = Boolean(row.note_snip && row.note_snip.includes(MARK_START));
      const chosenSnippet = noteMatched ? row.note_snip : row.best_snip;
      const segments = parseMarkedSnippetToSegments(chosenSnippet);
      results.set(row.content_id, {
        rank: row.rank_score,
        preview: {
          source: noteMatched ? 'note' : 'metadata',
          segments,
        },
      });
    }
  } catch {
    // Fallback gracefully if an unusual query cannot be parsed by FTS5
  }

  return results;
}

export interface ArchiveFtsMatch {
  rank: number;
  preview: SearchMatchPreview;
}

export function searchArchivesFts(
  db: DatabaseSync,
  rawQuery: string,
  limit = 500
): Map<string, ArchiveFtsMatch> {
  const results = new Map<string, ArchiveFtsMatch>();
  const ftsQuery = buildFtsMatchQuery(rawQuery);
  if (!ftsQuery) return results;

  try {
    const rows = db
      .prepare(
        `SELECT archive_uid,
                bm25(fts_archives) AS rank_score,
                snippet(fts_archives, 7, '${MARK_START}', '${MARK_END}', '…', 20) AS note_snip,
                snippet(fts_archives, 8, '${MARK_START}', '${MARK_END}', '…', 24) AS body_snip,
                snippet(fts_archives, -1, '${MARK_START}', '${MARK_END}', '…', 22) AS best_snip
         FROM fts_archives
         WHERE fts_archives MATCH ?
         ORDER BY rank_score ASC
         LIMIT ?`
      )
      .all(ftsQuery, limit) as Array<{
      archive_uid: string;
      rank_score: number;
      note_snip: string | null;
      body_snip: string | null;
      best_snip: string | null;
    }>;

    for (const row of rows) {
      const noteMatched = Boolean(row.note_snip && row.note_snip.includes(MARK_START));
      const bodyMatched = Boolean(row.body_snip && row.body_snip.includes(MARK_START));
      const bestMatched = Boolean(row.best_snip && row.best_snip.includes(MARK_START));

      let source: SearchMatchPreview['source'] = 'metadata';
      let chosen = row.best_snip;

      if (noteMatched) {
        source = 'note';
        chosen = row.note_snip;
      } else if (bodyMatched && (!bestMatched || row.best_snip === row.body_snip)) {
        source = 'archive_text';
        chosen = row.body_snip;
      } else if (bodyMatched && !bestMatched) {
        source = 'archive_text';
        chosen = row.body_snip;
      }

      results.set(row.archive_uid, {
        rank: row.rank_score,
        preview: {
          source,
          segments: parseMarkedSnippetToSegments(chosen),
        },
      });
    }
  } catch {
    // Fallback gracefully
  }

  return results;
}
